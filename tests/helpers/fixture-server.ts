import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serveDirectory } from "../../src/fixtures/server.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export async function serveSite(
  name: string,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return serveDirectory(join(repoRoot, "fixtures", "sites", name));
}
