import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchFirstJson, parseJsonBody, UiHttpError } from "../web/src/lib/paths.ts";

describe("parseJsonBody", () => {
  it("parses JSON", () => {
    assert.deepEqual(parseJsonBody("application/json", '{"ok":true}'), { ok: true });
  });

  it("rejects HTML so the SPA fallback is not treated as a snapshot", () => {
    assert.throws(
      () => parseJsonBody("text/html; charset=utf-8", "<!doctype html><title>ClickMonkey</title>"),
      /not json/,
    );
    assert.throws(() => parseJsonBody(null, "<!doctype html>"), /not json/);
  });
});

describe("fetchFirstJson", () => {
  it("does not fall through a 503 snapshot fault to snapshot.json", async () => {
    const prevDoc = (globalThis as { document?: { baseURI: string } }).document;
    (globalThis as { document: { baseURI: string } }).document = { baseURI: "http://127.0.0.1/" };
    const orig = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          JSON.stringify({
            error: true,
            title: "UI snapshot failed",
            message: "where",
            hint: "restart",
            copy: "COPYME",
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;
    try {
      await assert.rejects(
        () => fetchFirstJson(["api/snapshot", "snapshot.json"]),
        (e: unknown) => e instanceof UiHttpError && e.status === 503 && e.body.includes("COPYME"),
      );
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = orig;
      if (prevDoc) (globalThis as { document: { baseURI: string } }).document = prevDoc;
      else delete (globalThis as { document?: unknown }).document;
    }
  });
});
