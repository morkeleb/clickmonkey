import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeShotHref } from "../web/src/lib/shot.ts";

describe("looksLikeShotHref", () => {
  it("matches run file screenshots and image paths", () => {
    assert.equal(looksLikeShotHref("/files/runs/abc/shots/step-000.png"), true);
    assert.equal(looksLikeShotHref("http://127.0.0.1:4174/files/runs/abc/findings/fnd/screenshot.png"), true);
    assert.equal(looksLikeShotHref("../runs/abc/shots/step-001.jpg"), true);
    assert.equal(looksLikeShotHref("https://example.com/docs"), false);
    assert.equal(looksLikeShotHref("#appendix"), false);
  });
});
