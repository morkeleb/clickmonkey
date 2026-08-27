import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchFirstJson, loadLiveOrFrozenJson, parseJsonBody, UiHttpError } from "../web/src/lib/paths.ts";

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

describe("loadLiveOrFrozenJson", () => {
  function withFetch(impl: typeof fetch, fn: () => Promise<void>): Promise<void> {
    const prevDoc = (globalThis as { document?: { baseURI: string } }).document;
    (globalThis as { document: { baseURI: string } }).document = { baseURI: "http://127.0.0.1/" };
    const orig = globalThis.fetch;
    globalThis.fetch = impl;
    return fn().finally(() => {
      globalThis.fetch = orig;
      if (prevDoc) (globalThis as { document: { baseURI: string } }).document = prevDoc;
      else delete (globalThis as { document?: unknown }).document;
    });
  }

  it("uses api/snapshot and never probes snapshot.json on a live server", async () => {
    const urls: string[] = [];
    await withFetch(async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ schemaVersion: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }, async () => {
      const got = await loadLiveOrFrozenJson<{ schemaVersion: number }>("api/snapshot", "snapshot.json");
      assert.equal(got.frozen, false);
      assert.equal(got.data.schemaVersion, 1);
    });
    assert.equal(urls.length, 1);
    assert.match(urls[0] ?? "", /api\/snapshot/);
    assert.equal(urls.some((u) => u.includes("snapshot.json")), false);
  });

  it("falls back to snapshot.json only when api/snapshot is 404", async () => {
    const urls: string[] = [];
    await withFetch(async (input) => {
      urls.push(String(input));
      if (String(input).includes("api/snapshot")) return new Response("Not found", { status: 404 });
      return new Response(JSON.stringify({ schemaVersion: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }, async () => {
      const got = await loadLiveOrFrozenJson<{ schemaVersion: number }>("api/snapshot", "snapshot.json");
      assert.equal(got.frozen, true);
    });
    assert.equal(urls.length, 2);
    assert.match(urls[1] ?? "", /snapshot\.json/);
  });
});
