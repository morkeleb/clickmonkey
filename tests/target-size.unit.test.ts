import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseVisualReply, VISUAL_PROMPT, VISUAL_RULES } from "../src/surveyor/vision.js";
import {
  circle24,
  circleHitsRect,
  dropSpacedHits,
  issuesFromTargetHits,
  targetSizeEvidence,
  isUndersizedTarget,
  isUserAgentInputType,
  spacingExceptionHolds,
  TARGET_PAINTED_MIN_PX,
  TARGET_SIZE_CAP,
  targetSizeConfidence,
  targetSizeIssue,
  isTabStripCloseWhere,
  type TargetRect,
  type TargetSizeHit,
  type TargetSizeSample,
} from "../src/surveyor/target-size.js";
import { whyRule } from "../src/reports/why.js";

function hit(partial: Partial<TargetSizeHit> & Pick<TargetSizeHit, "width" | "height">): TargetSizeHit {
  return { kind: "Button", where: 'button[data-testid="icon-btn"]', ...partial };
}

describe("targetSize rule", () => {
  it("is a visual rule for undersized controls, not inline text links", () => {
    assert.ok(VISUAL_RULES.includes("targetSize"));
    assert.doesNotMatch(VISUAL_PROMPT, /targetSize:/);
    assert.match(whyRule("targetSize") ?? "", /24px-clear circle|24×24/);
    assert.match(whyRule("targetSize") ?? "", /mis|tap|neighbor/i);
  });

  it("drops targetSize from a vision reply — DOM owns the rule", () => {
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
          {
            rule: "contrast",
            severity: "warning",
            confidence: "high",
            message: "Hint is unreadable",
          },
        ],
      }),
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.issues.length, 1);
    assert.equal(out.issues[0]?.rule, "contrast");
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

  it("keeps Close {tab title} on the ledger, not as a high-confidence finding", () => {
    assert.equal(isTabStripCloseWhere('button "Close Vendors"'), true);
    assert.equal(isTabStripCloseWhere('button "Close"'), false);
    const issue = targetSizeIssue(
      hit({ width: 18, height: 18, where: 'button "Close Vendors"' }),
    );
    assert.ok(issue);
    assert.equal(issue.confidence, "medium");
    const dialog = targetSizeIssue(hit({ width: 18, height: 18, where: 'button "Close"' }));
    assert.ok(dialog);
    assert.equal(dialog.confidence, "high");
  });

  it("does not flag a 1×1 sr-only control (hidden native select / tiny Close)", () => {
    assert.equal(TARGET_PAINTED_MIN_PX, 4);
    assert.equal(isUndersizedTarget(1, 1), false);
    assert.equal(isUndersizedTarget(3, 3), false);
    assert.equal(targetSizeIssue(hit({ width: 1, height: 1, kind: "Select", where: "select" })), undefined);
    assert.equal(isUndersizedTarget(4, 4), true);
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

  it("keeps a viewport crop for a high-confidence 16×16 control", () => {
    const { issues, clips } = targetSizeEvidence(
      [
        {
          kind: "Button",
          width: 16,
          height: 16,
          where: 'button[data-testid="icon-btn"]',
          clip: { x: 10, y: 10, width: 16, height: 16 },
        },
      ],
      { width: 1280, height: 720 },
    );
    assert.equal(issues.length, 1);
    assert.equal(clips.length, 1);
    assert.equal(clips[0]?.where, 'button[data-testid="icon-btn"]');
    assert.ok((clips[0]?.clip.width ?? 0) >= 16);
  });
});

function box(left: number, top: number, width: number, height: number): TargetRect {
  return { left, top, right: left + width, bottom: top + height };
}

function sample(
  partial: Partial<TargetSizeSample> & Pick<TargetSizeSample, "left" | "top" | "right" | "bottom" | "width" | "height">,
): TargetSizeSample {
  return { kind: "Button", where: 'button[data-testid="icon-btn"]', ...partial };
}

describe("WCAG 2.5.8 spacing exception", () => {
  it("circle24 is a 24px-diameter disk", () => {
    assert.deepEqual(circle24(8, 8), { cx: 8, cy: 8, r: 12 });
  });

  it("circleHitsRect overlaps the box but treats tangent as a miss", () => {
    assert.equal(circleHitsRect(0, 0, 12, box(-4, -4, 8, 8)), true);
    assert.equal(circleHitsRect(0, 0, 12, box(12, -4, 8, 8)), false);
    assert.equal(circleHitsRect(0, 0, 12, box(100, 100, 8, 8)), false);
  });

  it("holds for two 16×16 targets whose centers are 40px apart", () => {
    const a = box(0, 0, 16, 16);
    const b = box(40, 0, 16, 16);
    assert.equal(spacingExceptionHolds(a, [b]), true);
    assert.equal(spacingExceptionHolds(b, [a]), true);
    const issues = issuesFromTargetHits(
      dropSpacedHits([
        sample({ width: 16, height: 16, ...a, where: 'button[data-testid="a"]' }),
        sample({ width: 16, height: 16, ...b, where: 'button[data-testid="b"]' }),
      ]),
    );
    assert.equal(issues.length, 0);
  });

  it("fails for two 16×16 targets whose centers are 20px apart", () => {
    const a = box(0, 0, 16, 16);
    const b = box(20, 0, 16, 16);
    assert.equal(spacingExceptionHolds(a, [b]), false);
    assert.equal(spacingExceptionHolds(b, [a]), false);
    const issues = issuesFromTargetHits(
      dropSpacedHits([
        sample({ width: 16, height: 16, ...a, where: 'button[data-testid="a"]' }),
        sample({ width: 16, height: 16, ...b, where: 'button[data-testid="b"]' }),
      ]),
    );
    assert.equal(issues.length, 2);
  });

  it("counts an exempt neighbor (checkbox, inline link) toward spacing, not as a hit", () => {
    const icon = box(0, 0, 16, 16);
    const check = box(8, 0, 12, 12);
    const far = box(200, 0, 12, 12);
    const packed = dropSpacedHits([
      sample({ width: 16, height: 16, ...icon, where: 'button[data-testid="icon"]' }),
      sample({
        width: 12,
        height: 12,
        ...check,
        where: 'input[data-testid="agree"]',
        exempt: true,
      }),
    ]);
    assert.equal(packed.length, 1);
    assert.equal(packed[0]?.where, 'button[data-testid="icon"]');
    const isolated = dropSpacedHits([
      sample({ width: 16, height: 16, ...icon, where: 'button[data-testid="icon"]' }),
      sample({
        width: 12,
        height: 12,
        ...far,
        where: 'input[data-testid="agree"]',
        exempt: true,
      }),
    ]);
    assert.equal(isolated.length, 0);
  });
});
