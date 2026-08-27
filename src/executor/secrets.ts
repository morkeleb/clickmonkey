const TOKEN = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;
const BRACED = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
const SKIP_ENV_VALUES = new Set(["true", "false", "yes", "no", "null", "undefined"]);
/** OS/path vars. Redacting TMPDIR/HOME smashes finding paths. */
const SKIP_ENV_NAMES =
  /^(PATH|HOME|PWD|OLDPWD|TMPDIR|TMP|TEMP|USER|LOGNAME|SHELL|TERM|LANG|LANGUAGE|LC_.*|XDG_.*|SSH_.*|DISPLAY|EDITOR|VISUAL|PAGER|NODE.*|npm_.*|PNPM_.*|COLORTERM|TERM_PROGRAM|ITERM_.*|VSCODE_.*|__CF.*|XPC_.*|COMMAND_MODE|INFOPATH|MANPATH|CDPATH|SHLVL|_)$/i;

/** Env values too short to redact (would smash logs). Names that look like secrets still redact. */
const ENV_REDACT_MIN = 4;
const SECRET_ENV_NAME = /password|secret|token|key|auth|credential|clickmonkey/i;

function isFilesystemValue(value: string): boolean {
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return true;
  return false;
}

function envRedactions(env: NodeJS.Dict<string | undefined>): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const [name, raw] of Object.entries(env)) {
    const value = raw ?? "";
    if (!value) continue;
    const secretName = SECRET_ENV_NAME.test(name);
    if (!secretName && SKIP_ENV_NAMES.test(name)) continue;
    if (value.length < ENV_REDACT_MIN && !secretName) continue;
    if (!secretName && SKIP_ENV_VALUES.has(value.toLowerCase())) continue;
    if (!secretName && isFilesystemValue(value)) continue;
    out.push({ name, value });
  }
  out.sort((a, b) => b.value.length - a.value.length);
  return out;
}

/** Replace every process.env value in text with `$NAME`. Longest first. */
export function redactEnvInText(
  text: string,
  env: NodeJS.Dict<string | undefined> = process.env,
): string {
  let s = text;
  for (const { name, value } of envRedactions(env)) {
    if (!s.includes(value)) continue;
    s = s.split(value).join(`$${name}`);
  }
  return s;
}

/**
 * What the tape/live log may record for a fill.
 * Keep `$TOKEN`. Never persist a value that equals any env var.
 */
export function tapeFillValue(
  planned: string,
  applied: string,
  field?: { type?: string; id?: string },
  env: NodeJS.Dict<string | undefined> = process.env,
): string {
  if (isSecretToken(planned)) return planned;
  const id = (field?.id ?? "").toLowerCase();
  if ((field?.type ?? "").toLowerCase() === "password" || id === "password" || id.endsWith("_password")) {
    return "••••";
  }
  for (const { name, value } of envRedactions(env)) {
    if (applied === value || planned === value) return `$${name}`;
  }
  return applied;
}

function secretName(value: string): string | undefined {
  return TOKEN.exec(value)?.[1] ?? BRACED.exec(value)?.[1];
}

/** True when the whole string is `$NAME` or `${NAME}`. */
export function isSecretToken(value: string): boolean {
  return secretName(value) !== undefined;
}

export function resolveSecret(
  value: string,
  env: NodeJS.Dict<string | undefined> = process.env,
): string {
  const name = secretName(value);
  if (!name) return value;
  const found = env[name];
  if (found !== undefined) return found;
  throw new Error(`$${name} is not set`);
}

export async function resolveSecretAsync(
  value: string,
  opts?: {
    prompt?: (name: string) => Promise<string>;
    env?: NodeJS.Dict<string | undefined>;
  },
): Promise<string> {
  const name = secretName(value);
  if (!name) return value;
  const env = opts?.env ?? process.env;
  const found = env[name];
  if (found !== undefined) return found;
  if (opts?.prompt) return opts.prompt(name);
  if (!process.stdin.isTTY) {
    throw new Error(`$${name} is not set`);
  }
  return readHiddenLine(name);
}

async function readHiddenLine(name: string): Promise<string> {
  const { createInterface } = await import("node:readline");
  const stdin = process.stdin;
  const rl = createInterface({ input: stdin, output: process.stderr });
  const wasRaw = stdin.isRaw;
  stdin.setRawMode?.(true);
  process.stderr.write(`$${name} is not set. Enter value: `);
  try {
    return await new Promise<string>((resolve, reject) => {
      let acc = "";
      const onData = (buf: Buffer | string) => {
        const s = typeof buf === "string" ? buf : buf.toString("utf8");
        for (const ch of s) {
          if (ch === "\n" || ch === "\r") {
            cleanup();
            process.stderr.write("\n");
            resolve(acc);
            return;
          }
          if (ch === "\u0003") {
            cleanup();
            reject(new Error(`$${name} is not set`));
            return;
          }
          if (ch === "\u007f" || ch === "\b") {
            acc = acc.slice(0, -1);
            continue;
          }
          acc += ch;
        }
      };
      const cleanup = () => {
        stdin.off("data", onData);
        stdin.setRawMode?.(wasRaw ?? false);
        rl.close();
      };
      stdin.on("data", onData);
    });
  } catch (err) {
    stdin.setRawMode?.(wasRaw ?? false);
    rl.close();
    throw err;
  }
}
