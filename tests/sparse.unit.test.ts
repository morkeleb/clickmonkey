import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VISUAL_PROMPT, VISUAL_RULES } from "../src/surveyor/vision.js";
import { sparseLayoutIssue, sparseMetrics, type SparseSample } from "../src/surveyor/sparse.js";

const pane = { left: 0, right: 1280 };

function sample(boxes: SparseSample["boxes"], extra?: Partial<SparseSample>): SparseSample {
  return { pane, boxes, where: "New vendor", ...extra };
}

describe("sparse layout", () => {
  it("is a visual rule defined as left-locked empty-right, not centered", () => {
    assert.ok(VISUAL_RULES.includes("sparse"));
    assert.match(VISUAL_PROMPT, /sparse:/);
    assert.match(VISUAL_PROMPT, /more than half the pane/);
    assert.match(VISUAL_PROMPT, /Centered cards\/login/);
  });

  it("flags a 30% left-locked column as high confidence", () => {
    const issue = sparseLayoutIssue(sample([{ left: 24, right: 400 }]));
    assert.ok(issue);
    assert.equal(issue.rule, "sparse");
    assert.equal(issue.confidence, "high");
    assert.equal(issue.severity, "warning");
    assert.match(issue.message, /uses 29% of the pane/);
    assert.match(issue.message, /empty on the right/);
    const m = sparseMetrics(sample([{ left: 24, right: 400 }]))!;
    assert.equal(m.leftLocked, true);
    assert.equal(m.centered, false);
    assert.ok(m.rightGap >= 0.5);
  });

  it("flags a 50% left-locked column", () => {
    const issue = sparseLayoutIssue(sample([{ left: 24, right: 640 }]));
    assert.ok(issue);
    assert.equal(issue.rule, "sparse");
    assert.equal(issue.confidence, "medium");
    const m = sparseMetrics(sample([{ left: 24, right: 640 }]))!;
    assert.ok(m.used <= 0.5);
    assert.ok(m.rightGap >= 0.48);
  });

  it("does not flag centered content", () => {
    const issue = sparseLayoutIssue(sample([{ left: 440, right: 840 }]));
    assert.equal(issue, undefined);
    const m = sparseMetrics(sample([{ left: 440, right: 840 }]))!;
    assert.equal(m.centered, true);
  });

  it("does not flag a full-width table", () => {
    assert.equal(sparseLayoutIssue(sample([{ left: 24, right: 1256 }])), undefined);
  });

  it("does not flag a two-column pane", () => {
    assert.equal(
      sparseLayoutIssue(
        sample([
          { left: 24, right: 400 },
          { left: 720, right: 1200 },
        ]),
      ),
      undefined,
    );
  });

  it("skips a pane that is already a single column", () => {
    assert.equal(
      sparseLayoutIssue({
        pane: { left: 0, right: 720 },
        boxes: [{ left: 16, right: 200 }],
      }),
      undefined,
    );
  });
});
