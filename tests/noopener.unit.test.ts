import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_NOOPENER_HITS,
  noopenerIssue,
  relHasNoopener,
  type NoopenerHit,
} from "../src/surveyor/noopener.js";

function hit(partial: Partial<NoopenerHit> = {}): NoopenerHit {
  return { where: 'a[data-testid="bare"]', rel: "", ...partial };
}

describe("relHasNoopener", () => {
  it("passes when rel has noopener or noreferrer tokens", () => {
    assert.equal(relHasNoopener("noopener"), true);
    assert.equal(relHasNoopener("noreferrer"), true);
    assert.equal(relHasNoopener("noopener noreferrer"), true);
    assert.equal(relHasNoopener("noreferrer noopener"), true);
    assert.equal(relHasNoopener("nofollow noopener"), true);
    assert.equal(relHasNoopener("  NOOPENER  "), true);
    assert.equal(relHasNoopener("NoReferrer"), true);
    assert.equal(relHasNoopener("noopener\tnoreferrer"), true);
  });

  it("fails when neither token is present", () => {
    assert.equal(relHasNoopener(""), false);
    assert.equal(relHasNoopener("   "), false);
    assert.equal(relHasNoopener("nofollow"), false);
    assert.equal(relHasNoopener("external nofollow"), false);
    assert.equal(relHasNoopener("noopenernoreferrer"), false);
    assert.equal(relHasNoopener("noopener-noreferrer"), false);
  });
});

describe("noopenerIssue", () => {
  it("flags a shown _blank link without rel as a high-confidence warning", () => {
    const issue = noopenerIssue(hit());
    assert.ok(issue);
    assert.equal(issue.source, "visual");
    assert.equal(issue.rule, "noopener");
    assert.equal(issue.severity, "warning");
    assert.equal(issue.confidence, "high");
    assert.equal(issue.count, 1);
    assert.equal(issue.where, 'a[data-testid="bare"]');
    assert.equal(issue.message, `Link opens a new tab without rel="noopener"`);
    assert.equal(issue.via, undefined);
  });

  it("skips noopener and noreferrer, and incomplete hits", () => {
    assert.equal(noopenerIssue(hit({ rel: "noopener" })), undefined);
    assert.equal(noopenerIssue(hit({ rel: "noreferrer" })), undefined);
    assert.equal(noopenerIssue(hit({ rel: "noopener noreferrer" })), undefined);
    assert.equal(noopenerIssue(hit({ where: "  " })), undefined);
    assert.equal(MAX_NOOPENER_HITS, 8);
  });
});
