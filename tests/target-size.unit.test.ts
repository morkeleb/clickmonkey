import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseVisualReply, VISUAL_PROMPT, VISUAL_RULES } from "../src/surveyor/vision.js";
import {
  issuesFromTargetHits,
  isUndersizedTarget,
  isUserAgentInputType,
  TARGET_SIZE_CAP,
  targetSizeConfidence,
  targetSizeIssue,
  type TargetSizeHit,
} from "../src/surveyor/target-size.js";
import { whyRule } from "../src/reports/why.js";

function hit(partial: Partial<TargetSizeHit> & Pick<TargetSizeHit, "width" | "height">): TargetSizeHit {
  return { kind: "Button", where: 'button[data-testid="icon-btn"]', ...partial };
}

describe("targetSize rule", () => {
  it("is a visual rule for undersized controls, not inline text links", () => {
    assert.ok(VISUAL_RULES.includes("targetSize"));
    assert.doesNotMatch(VISUAL_PROMPT, /targetSize:/);
    assert.match(whyRule("targetSize") ?? "", /WCAG 2\.5\.8/);
    assert.match(whyRule("targetSize") ?? "", /mis|tap|neighbor/i);
  });

  it("parses targetSize from a vision reply", () => {
    const out = parseVisualReply(
      JSON.stringify({
        issues: [
          {
            rule: "targetSize",
            severity: "warning",
            confidence: "high",
            where: "toolbar Close",
            message: "Close is 16×16px",
          },
        ],
      }),
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.issues[0]?.rule, "targetSize");
    assert.equal(out.issues[0]?.source, "visual");
  });
});

describe("targetSizeIssue", () => {
  it("flags a 16×16 control as high confidence", () => {
    const issue = targetSizeIssue(hit({ width: 16, height: 16 }));
    assert.ok(issue);
    assert.equal(issue.rule, "targetSize");
    assert.equal(issue.source, "visual");
    assert.equal(issue.severity, "warning");
    assert.equal(issue.confidence, "high");
    assert.equal(issue.count, 1);
    assert.equal(issue.where, 'button[data-testid="icon-btn"]');
    assert.equal(issue.message, "Button is 16×16px; WCAG 2.5.8 minimum is 24×24");
  });

  it("does not flag a 40×40 control", () => {
    assert.equal(targetSizeIssue(hit({ width: 40, height: 40 })), undefined);
    assert.equal(isUndersizedTarget(40, 40), false);
  });

  it("treats native checkbox/radio/file as user-agent controls", () => {
    assert.equal(isUserAgentInputType("checkbox"), true);
    assert.equal(isUserAgentInputType("radio"), true);
    assert.equal(isUserAgentInputType("file"), true);
    assert.equal(isUserAgentInputType("text"), false);
  });

  it("does not flag when only one axis is under 24", () => {
    assert.equal(targetSizeIssue(hit({ width: 40, height: 16 })), undefined);
    assert.equal(targetSizeIssue(hit({ width: 16, height: 40 })), undefined);
    assert.equal(isUndersizedTarget(24, 16), false);
  });

  it("uses medium confidence when both axes are under 24 but not both under 20", () => {
    const issue = targetSizeIssue(hit({ width: 22, height: 22 }));
    assert.ok(issue);
    assert.equal(issue.confidence, "medium");
    assert.equal(targetSizeConfidence(19, 19), "high");
    assert.equal(targetSizeConfidence(20, 20), "medium");
    assert.match(issue.message, /22×22px/);
  });

  it("skips 0-size and incomplete hits", () => {
    assert.equal(targetSizeIssue(hit({ width: 0, height: 16 })), undefined);
    assert.equal(targetSizeIssue(hit({ kind: "", width: 16, height: 16 })), undefined);
    assert.equal(targetSizeIssue(hit({ where: "  ", width: 16, height: 16 })), undefined);
  });

  it("caps at 8 and drops duplicate where+message", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      hit({ width: 16, height: 16, where: `button[data-testid="i${i}"]` }),
    );
    const issues = issuesFromTargetHits(many);
    assert.equal(issues.length, TARGET_SIZE_CAP);
    const duped = issuesFromTargetHits([
      hit({ width: 16, height: 16 }),
      hit({ width: 16, height: 16 }),
    ]);
    assert.equal(duped.length, 1);
  });
});
