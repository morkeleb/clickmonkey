import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  createMcpHost,
  registerMcpPrompts,
  registerMcpResources,
  registerMcpTools,
  type McpHost,
} from "./tools.js";

export function createServer(host: McpHost = createMcpHost()): McpServer {
  const server = new McpServer({ name: "clickmonkey", version: "2.0.0-alpha.0" });
  registerMcpTools(server, host);
  registerMcpPrompts(server);
  registerMcpResources(server, host);
  return server;
}

/** Stdio MCP. Never returns until stdin closes / SIGINT. Finishes a live run on disconnect. */
export async function runMcp(opts?: { config?: string }): Promise<void> {
  const host = createMcpHost(opts);
  const handle = serveStdio(() => createServer(host), {
    onerror: (error) => console.error(error),
  });
  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    process.stdin.once("end", stop);
    process.stdin.once("close", stop);
  });
  if (host.session) {
    try {
      await host.session.abort();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
    }
  }
  await handle.close();
}
