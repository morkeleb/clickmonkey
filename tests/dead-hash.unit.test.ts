import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_DEAD_HASH_HITS,
  deadHashIssue,
  deadHashMessage,
  decodeHashFragment,
  issuesFromDeadHashHits,
  skipDeadHashHref,
  type DeadHashHit,
} from "../src/surveyor/dead-hash.js";

function hit(partial: Partial<DeadHashHit> = {}): DeadHashHit {
  return { hash: "#missing", where: 'a[data-testid="dead"]', ...partial };
}

describe("deadHashIssue", () => {
  it("emits a high-confidence visual warning", () => {
    const issue = deadHashIssue(hit());
    assert.ok(issue);
    assert.equal(issue.source, "visual");
    assert.equal(issue.rule, "deadHash");
    assert.equal(issue.severity, "warning");
    assert.equal(issue.confidence, "high");
    assert.equal(issue.count, 1);
    assert.equal(issue.where, 'a[data-testid="dead"]');
    assert.equal(issue.message, "Link points at #missing which is not on the page");
    assert.equal(issue.via, undefined);
  });

  it("skips incomplete hits", () => {
    assert.equal(deadHashIssue(hit({ hash: "" })), undefined);
    assert.equal(deadHashIssue(hit({ hash: "  " })), undefined);
    assert.equal(deadHashIssue(hit({ where: "  " })), undefined);
  });

  it("skips empty, top, javascript:, and SPA hash routes/state", () => {
    const where = 'a[data-testid="x"]';
    assert.equal(deadHashIssue({ hash: "#", where }), undefined);
    assert.equal(deadHashIssue({ hash: "#/", where }), undefined);
    assert.equal(deadHashIssue({ hash: "#!", where }), undefined);
    assert.equal(deadHashIssue({ hash: "#top", where }), undefined);
    assert.equal(deadHashIssue({ hash: "#TOP", where }), undefined);
    assert.equal(deadHashIssue({ hash: "javascript:void(0)", where }), undefined);
    assert.equal(skipDeadHashHref("#"), true);
    assert.equal(skipDeadHashHref("#/"), true);
    assert.equal(skipDeadHashHref("#/users/123"), true);
    assert.equal(skipDeadHashHref("#!/app/inbox"), true);
    assert.equal(skipDeadHashHref("#tab=billing"), true);
    assert.equal(skipDeadHashHref("#foo&bar"), true);
    assert.equal(skipDeadHashHref("#top"), true);
    assert.equal(skipDeadHashHref("#nope"), false);
    assert.equal(skipDeadHashHref("#main-content"), false);
  });

  it("keeps the example message shape", () => {
    assert.equal(deadHashMessage("#missing"), "Link points at #missing which is not on the page");
    assert.equal(MAX_DEAD_HASH_HITS, 8);
  });
});

describe("decodeHashFragment", () => {
  it("decodes %20 and keeps malformed sequences", () => {
    assert.equal(decodeHashFragment("foo%20bar"), "foo bar");
    assert.equal(decodeHashFragment("%"), "%");
  });
});

describe("issuesFromDeadHashHits", () => {
  it("caps at 8 unique where+message", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      hit({ hash: `#gone${i}`, where: `a[data-testid="d${i}"]` }),
    );
    const issues = issuesFromDeadHashHits(many);
    assert.equal(issues.length, MAX_DEAD_HASH_HITS);
    const duped = issuesFromDeadHashHits([hit(), hit()]);
    assert.equal(duped.length, 1);
  });
});
