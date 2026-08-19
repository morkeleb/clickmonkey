import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseJsonBody } from "../web/src/lib/paths.ts";

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
