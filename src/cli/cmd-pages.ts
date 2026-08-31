import { dropMapPages, formatPagesStatus, loadBrokenForGc, pageGcRows } from "../persist/pages.js";
import { mapPath } from "../persist/workspace.js";
import { EXIT_OK, EXIT_USAGE, errMessage, fail, loadConfigOrExit, resolveConfigPath } from "./common.js";

export function parseDropIds(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).map((id) => id.trim()).filter(Boolean))];
}

function printDropped(configPath: string, dropped: string[]): void {
  if (dropped.length === 0) {
    process.stdout.write("no pages dropped\n");
    return;
  }
  const noun = dropped.length === 1 ? "page" : "pages";
  process.stdout.write(`dropped ${dropped.length} ${noun} from ${mapPath(configPath)}: ${dropped.join(", ")}\n`);
}

export async function cmdPages(opts: { config?: string; drop?: string }): Promise<number> {
  const configPath = resolveConfigPath(opts.config);
  const config = loadConfigOrExit(configPath);
  if (opts.drop !== undefined) {
    const ids = parseDropIds(opts.drop);
    if (ids.length === 0) fail(EXIT_USAGE, "--drop needs page ids (comma-separated)");
    try {
      const { dropped } = dropMapPages(configPath, ids);
      printDropped(configPath, dropped);
    } catch (err) {
      fail(EXIT_USAGE, errMessage(err));
    }
    return EXIT_OK;
  }
  const broken = loadBrokenForGc(configPath);
  process.stdout.write(formatPagesStatus(config.map, broken));
  const rows = pageGcRows(config.map, broken);
  if (rows.length === 0) return EXIT_OK;
  let ids: string[] = [];
  try {
    const { promptDropPages } = await import("./prompt-pages.js");
    ids = await promptDropPages(rows);
  } catch (err) {
    if (err instanceof Error && err.name === "ExitPromptError") return 130;
    fail(EXIT_USAGE, errMessage(err));
  }
  if (ids.length === 0) {
    if (process.stdin.isTTY && process.stdout.isTTY) printDropped(configPath, []);
    return EXIT_OK;
  }
  try {
    const { dropped } = dropMapPages(configPath, ids);
    printDropped(configPath, dropped);
  } catch (err) {
    fail(EXIT_USAGE, errMessage(err));
  }
  return EXIT_OK;
}
