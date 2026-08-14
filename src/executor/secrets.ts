const TOKEN = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;
const BRACED = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

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
