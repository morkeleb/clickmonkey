import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, it } from "node:test";
import { chat } from "../src/brains/chat.js";

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      handler(req, res, Buffer.concat(chunks).toString("utf8"));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected TCP address");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe("chat client", () => {
  it("posts OpenAI-shaped chat completions with model and messages", async () => {
    let captured: { url?: string; body?: unknown; auth?: string } = {};
    const { baseUrl, close } = await listen((req, res, raw) => {
      captured = {
        url: req.url,
        body: JSON.parse(raw) as unknown,
        auth: req.headers.authorization,
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
      );
    });
    try {
      const text = await chat({
        baseUrl: `${baseUrl}/`,
        model: "test-model",
        apiKey: "sk-test",
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "hello" },
        ],
      });
      assert.equal(text, "ok");
      assert.equal(captured.url, "/chat/completions");
      assert.equal(captured.auth, "Bearer sk-test");
      const body = captured.body as { model: string; messages: unknown; temperature: number };
      assert.equal(body.model, "test-model");
      assert.equal(body.temperature, 0.2);
      assert.deepEqual(body.messages, [
        { role: "system", content: "sys" },
        { role: "user", content: "hello" },
      ]);
    } finally {
      await close();
    }
  });
});
