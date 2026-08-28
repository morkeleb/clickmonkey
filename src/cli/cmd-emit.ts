import { writeGeneratedTs } from "../ts/emit.js";
import { EXIT_OK, EXIT_USAGE, errMessage, fail, loadConfigOrExit, resolveConfigPath } from "./common.js";

export async function cmdEmit(opts: { config?: string }): Promise<number> {
  const configPath = resolveConfigPath(opts.config);
  const config = loadConfigOrExit(configPath);
  if (config.map.pages.length === 0) fail(EXIT_USAGE, "map has no pages (run inspect / map)");
  try {
    const out = writeGeneratedTs(configPath, config.map, config.intro);
    process.stdout.write(`${out}\n`);
  } catch (err) {
    fail(EXIT_USAGE, errMessage(err));
  }
  return EXIT_OK;
}
