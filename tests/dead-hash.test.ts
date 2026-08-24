import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanDeadHash } from "../src/surveyor/dead-hash.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/dead-hash/index.html", import.meta.url));

function blob(issues: Array<{ where?: string; message: string }>): string {
  return JSON.stringify(issues);
}

describe("scanDeadHash", () => {
  it("flags a visible hash link with no target, not live ids, names, empty hashes, or hidden links", async () => {
    await withPage(html, async (page) => {
      const issues = await scanDeadHash(page);
      const hits = issues.filter((i) => i.rule === "deadHash");
      const dump = blob(hits);

      const dead = hits.find((i) => /dead/.test(i.where ?? ""));
      assert.ok(dead, `expected #nope, got ${dump}`);
      const emailHash = hits.find((i) => /email-hash/.test(i.where ?? ""));
      assert.ok(emailHash, `input name=email is not a fragment target, got ${dump}`);
      assert.equal(dead.source, "visual");
      assert.equal(dead.severity, "warning");
      assert.equal(dead.confidence, "high");
      assert.equal(dead.count, 1);
      assert.equal(dead.via, undefined);
      assert.equal(dead.where, 'a[data-testid="dead"]');
      assert.match(dead.message, /Link points at #nope which is not on the page/);

      assert.equal(
        hits.some((i) =>
          /ok|empty-hash|named|hidden-gone|top|spa-slash|bang|encoded|spa-route|spa-state/.test(i.where ?? ""),
        ),
        false,
        `live id/name, empty hash, hidden, #top, SPA hash routes/state, and decoded id must not be deadHash, got ${dump}`,
      );
      assert.ok(hits.length <= 8);
    });
  });
});
