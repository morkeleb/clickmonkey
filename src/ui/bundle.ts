import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { listReports, readReport } from "../persist/reports.js";
import { listRuns } from "../persist/runs.js";
import { runsDir } from "../persist/workspace.js";
import { buildRunDetail } from "./run-detail.js";
import { resolveUiRoot } from "./server.js";
import { buildUiSnapshot } from "./snapshot.js";

const SKIP_DIR = new Set(["verbose", "node_modules", ".git"]);
const COPY_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export function freezeSnapshot<T extends { runs: Array<{ live: boolean }>; notice?: unknown }>(
  snapshot: T,
): T {
  const { notice: _notice, ...rest } = snapshot;
  return {
    ...(rest as T),
    runs: snapshot.runs.map((run) => ({ ...run, live: false })),
  };
}

function copyTree(from: string, to: string, filter: (abs: string) => boolean): number {
  let n = 0;
  if (!existsSync(from)) return 0;
  const info = statSync(from);
  if (info.isDirectory()) {
    if (SKIP_DIR.has(from.split(/[/\\]/).pop() ?? "")) return 0;
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) {
      n += copyTree(join(from, name), join(to, name), filter);
    }
    return n;
  }
  if (!filter(from)) return 0;
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  return 1;
}

function isShot(abs: string): boolean {
  const lower = abs.toLowerCase();
  return [...COPY_EXT].some((ext) => lower.endsWith(ext));
}

export function writeBundle(
  configPath: string,
  outDir: string,
  opts?: { uiRoot?: string },
): { outDir: string; files: number } {
  const uiRoot = opts?.uiRoot ?? resolveUiRoot();
  if (!uiRoot) {
    throw new Error("ui not built — run `npm run build` so web/dist exists");
  }
  mkdirSync(outDir, { recursive: true });
  cpSync(uiRoot, outDir, { recursive: true });

  const snapshot = freezeSnapshot(buildUiSnapshot(configPath));
  writeFileSync(join(outDir, "snapshot.json"), `${JSON.stringify(snapshot)}\n`, "utf8");

  mkdirSync(join(outDir, "api", "runs"), { recursive: true });
  mkdirSync(join(outDir, "api", "reports"), { recursive: true });

  const listed = listRuns(configPath);
  for (const run of listed) {
    const detail = buildRunDetail(configPath, run.id);
    if (detail) {
      writeFileSync(
        join(outDir, "api", "runs", `${run.id}.json`),
        `${JSON.stringify({ ...detail, live: false })}\n`,
        "utf8",
      );
    }
  }
  for (const report of listReports(configPath)) {
    const loaded = readReport(configPath, report.id);
    if (!loaded) continue;
    writeFileSync(
      join(outDir, "api", "reports", `${report.id}.json`),
      `${JSON.stringify({ ...loaded.meta, markdown: loaded.markdown })}\n`,
      "utf8",
    );
  }

  const runsRoot = runsDir(configPath);
  let shots = 0;
  if (existsSync(runsRoot)) {
    shots = copyTree(runsRoot, join(outDir, "files", "runs"), isShot);
  }

  writeFileSync(
    join(outDir, "README.txt"),
    [
      "ClickMonkey static bundle",
      "",
      "Do not open index.html as a file:// URL — the browser blocks fetch.",
      "Serve this folder, then open the printed URL:",
      "",
      "  python3 -m http.server 4174",
      "  # http://127.0.0.1:4174/",
      "",
      "Or upload the folder to GitLab Pages / any static host.",
      "",
    ].join("\n"),
    "utf8",
  );

  return { outDir, files: shots };
}
