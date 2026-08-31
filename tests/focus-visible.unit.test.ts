import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTABLE_SEL, MAX_ACTABLES } from "../src/surveyor/focus-obscured.js";
import {
  FOCUS_VISIBLE_CLIP_MIN_H,
  FOCUS_VISIBLE_CLIP_MIN_W,
  FOCUS_VISIBLE_CLIP_PAD,
  MAX_FOCUS_VISIBLE_HITS,
  evidenceClipFromRect,
  fitShotClip,
  focusIndicatorChanged,
  focusShotClip,
  focusVisibleClipsFromHits,
  focusVisibleIssue,
  isFocusClipWrapper,
  issuesFromHits,
  modestFocusWrapper,
  parseShotClip,
  type FocusStyle,
  type FocusVisibleHit,
} from "../src/surveyor/focus-visible.js";

const rest: FocusStyle = {
  outlineStyle: "none",
  outlineWidth: "0px",
  outlineColor: "rgb(0, 0, 0)",
  outlineOffset: "0px",
  boxShadow: "none",
  borderTopWidth: "1px",
  borderTopColor: "rgb(51, 51, 51)",
  borderBottomWidth: "1px",
  borderBottomColor: "rgb(51, 51, 51)",
  backgroundColor: "rgb(238, 238, 238)",
  color: "rgb(17, 17, 17)",
  textDecorationLine: "none",
};

function style(partial: Partial<FocusStyle> = {}): FocusStyle {
  return { ...rest, ...partial };
}

function hit(
  partial: Partial<FocusVisibleHit> & Pick<FocusVisibleHit, "name" | "where">,
): FocusVisibleHit {
  return { before: rest, after: rest, ...partial };
}

describe("focusVisible helpers", () => {
  it("reuses the 2.4.11 actable set and caps hits at 8", () => {
    assert.match(ACTABLE_SEL, /\bbutton\b/);
    assert.match(ACTABLE_SEL, /a\[href\]/);
    assert.equal(MAX_ACTABLES, 24);
    assert.equal(MAX_FOCUS_VISIBLE_HITS, 8);
  });

  it("treats a visible outline, including UA auto, as an indicator", () => {
    assert.equal(focusIndicatorChanged(rest, rest), false);
    assert.equal(
      focusIndicatorChanged(rest, style({ outlineStyle: "solid", outlineWidth: "2px" })),
      true,
    );
    assert.equal(
      focusIndicatorChanged(
        rest,
        style({ outlineStyle: "auto", outlineWidth: "1px", outlineColor: rest.outlineColor }),
      ),
      true,
    );
    assert.equal(
      focusIndicatorChanged(rest, style({ outlineStyle: "auto", outlineWidth: "0px" })),
      false,
    );
    assert.equal(
      focusIndicatorChanged(rest, style({ outlineStyle: "none", outlineWidth: "2px" })),
      false,
    );
    const already = style({ outlineStyle: "auto", outlineWidth: "1px" });
    assert.equal(focusIndicatorChanged(already, already), false);
  });

  it("accepts box-shadow, border, fill, and underline stand-ins", () => {
    assert.equal(
      focusIndicatorChanged(rest, style({ boxShadow: "rgb(0, 102, 255) 0px 0px 0px 3px" })),
      true,
    );
    assert.equal(focusIndicatorChanged(style({ boxShadow: "rgb(0, 0, 0) 0px 1px 2px 0px" }), rest), false);
    assert.equal(focusIndicatorChanged(rest, style({ borderTopWidth: "3px" })), true);
    assert.equal(focusIndicatorChanged(rest, style({ borderTopColor: "rgb(0, 0, 255)" })), true);
    assert.equal(focusIndicatorChanged(rest, style({ borderBottomWidth: "3px" })), true);
    assert.equal(focusIndicatorChanged(rest, style({ borderBottomColor: "rgb(0, 0, 255)" })), true);
    assert.equal(focusIndicatorChanged(rest, style({ backgroundColor: "rgb(255, 255, 0)" })), true);
    assert.equal(focusIndicatorChanged(rest, style({ color: "rgb(0, 0, 255)" })), true);
    assert.equal(
      focusIndicatorChanged(rest, style({ textDecorationLine: "underline" })),
      true,
    );
    assert.equal(
      focusIndicatorChanged(
        style({ textDecorationLine: undefined, textDecoration: "none" }),
        style({ textDecorationLine: undefined, textDecoration: "underline solid rgb(0, 0, 0)" }),
      ),
      true,
    );
    assert.equal(
      focusIndicatorChanged(
        style({ textDecorationLine: "underline" }),
        style({ textDecorationLine: "underline" }),
      ),
      false,
    );
  });
});

describe("focusVisibleIssue", () => {
  it("accepts a ring on a wrapping field (`:focus-within`)", () => {
    const issue = focusVisibleIssue({
      name: "Email address",
      where: "#username",
      before: rest,
      after: rest,
      beforeParents: [rest],
      afterParents: [style({ borderTopColor: "rgb(0, 0, 255)" })],
    });
    assert.equal(issue, undefined);
  });

  it("does not treat a sibling's unchanged UA outline as the field's ring", () => {
    const ua = style({ outlineStyle: "auto", outlineWidth: "1px" });
    const issue = focusVisibleIssue({
      name: "Search",
      where: 'input "Search"',
      before: rest,
      after: rest,
      beforeChrome: [ua],
      afterChrome: [ua],
    });
    assert.ok(issue, "pre-existing outline on a neighbor is not WCAG 2.4.7 coverage");
  });

  it("accepts a ring on a sibling notched outline (MUI OutlinedInput)", () => {
    const issue = focusVisibleIssue({
      name: "Search or Talk to LOIS",
      where: 'input "Search or Talk to LOIS"',
      before: rest,
      after: rest,
      beforeParents: [rest],
      afterParents: [rest],
      beforeChrome: [rest],
      afterChrome: [style({ borderTopColor: "rgb(0, 0, 255)", borderTopWidth: "2px" })],
    });
    assert.equal(issue, undefined);
  });

  it("emits a high-confidence visual warning when nothing changed", () => {
    const issue = focusVisibleIssue(hit({ name: "Save", where: 'button[data-testid="bare"]' }));
    assert.ok(issue);
    assert.equal(issue.source, "visual");
    assert.equal(issue.rule, "focusVisible");
    assert.equal(issue.severity, "warning");
    assert.equal(issue.confidence, "high");
    assert.equal(issue.count, 1);
    assert.equal(issue.where, 'button[data-testid="bare"]');
    assert.equal(issue.message, "Save has no visible focus indicator (WCAG 2.4.7)");
    assert.equal(issue.via, undefined);
  });

  it("skips a control that grew a focus ring", () => {
    assert.equal(
      focusVisibleIssue(
        hit({
          name: "Continue",
          where: 'button[data-testid="ok"]',
          after: style({ outlineStyle: "solid", outlineWidth: "2px" }),
        }),
      ),
      undefined,
    );
  });

  it("skips incomplete hits", () => {
    assert.equal(focusVisibleIssue(hit({ name: "", where: "#bare" })), undefined);
    assert.equal(focusVisibleIssue(hit({ name: "Save", where: "  " })), undefined);
  });

  it("caps at 8 and drops duplicate where+message", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      hit({ name: `B${i}`, where: `button[data-testid="b${i}"]` }),
    );
    const issues = issuesFromHits(many);
    assert.equal(issues.length, MAX_FOCUS_VISIBLE_HITS);
    const duped = issuesFromHits([
      hit({ name: "Save", where: "#bare" }),
      hit({ name: "Save", where: "#bare" }),
    ]);
    assert.equal(duped.length, 1);
  });

  it("keeps a high-confidence miss even when no clip was attached", () => {
    const issue = focusVisibleIssue(hit({ name: "Save", where: 'button[data-testid="bare"]' }));
    assert.equal(issue?.confidence, "high");
    assert.deepEqual(focusVisibleClipsFromHits([hit({ name: "Save", where: 'button[data-testid="bare"]' })]), []);
  });

  it("emits a viewport clip only for misses that recorded one while focused", () => {
    assert.equal(FOCUS_VISIBLE_CLIP_PAD, 48);
    assert.equal(FOCUS_VISIBLE_CLIP_MIN_W, 320);
    assert.equal(FOCUS_VISIBLE_CLIP_MIN_H, 80);
    const miss = hit({
      name: "Save",
      where: 'button[data-testid="bare"]',
      clip: { x: 10.2, y: 4, width: 80.1, height: 32 },
    });
    const ring = hit({
      name: "Continue",
      where: 'button[data-testid="ok"]',
      after: style({ outlineStyle: "solid", outlineWidth: "2px" }),
      clip: { x: 0, y: 0, width: 40, height: 20 },
    });
    const clips = focusVisibleClipsFromHits([miss, ring]);
    assert.deepEqual(clips, [
      { where: 'button[data-testid="bare"]', clip: { x: 10, y: 4, width: 81, height: 32 } },
    ]);
  });
});

describe("focusShotClip", () => {
  it("clips the wrapping field, not a postage stamp around the input", () => {
    assert.equal(isFocusClipWrapper({ role: "combobox" }), true);
    assert.equal(isFocusClipWrapper({ className: "fvs-text-field" }), true);
    assert.equal(isFocusClipWrapper({ tag: "header" }), false);
    const input = { left: 400, top: 8, right: 520, bottom: 40 };
    const wrap = { left: 360, top: 4, right: 900, bottom: 48 };
    assert.equal(modestFocusWrapper(wrap, input, 1280, 720), true);
    assert.equal(modestFocusWrapper({ left: 0, top: 0, right: 1280, bottom: 64 }, input, 1280, 720), false);
    const shot = focusShotClip(wrap, 1280, 720);
    assert.ok(shot);
    assert.ok(shot.x <= wrap.left);
    assert.ok(shot.x + shot.width >= wrap.right);
    assert.ok(shot.width >= wrap.right - wrap.left);
    assert.ok(shot.height >= FOCUS_VISIBLE_CLIP_MIN_H);
  });

  it("pads a tiny target to the minimum clip so neighbors stay in frame", () => {
    const shot = focusShotClip({ left: 10, top: 10, right: 28, bottom: 28 }, 1280, 720);
    assert.ok(shot);
    assert.ok(shot.width >= FOCUS_VISIBLE_CLIP_MIN_W);
    assert.ok(shot.height >= FOCUS_VISIBLE_CLIP_MIN_H);
  });
});

describe("parseShotClip", () => {
  it("rejects empty or off-viewport boxes and clamps to integers", () => {
    assert.equal(parseShotClip(undefined), undefined);
    assert.equal(parseShotClip({ x: -1, y: 0, width: 10, height: 10 }), undefined);
    assert.equal(parseShotClip({ x: 0, y: 0, width: 0, height: 10 }), undefined);
    assert.deepEqual(parseShotClip({ x: 1.2, y: 3.9, width: 10.1, height: 8.2 }), {
      x: 1,
      y: 3,
      width: 11,
      height: 9,
    });
    assert.deepEqual(fitShotClip({ x: 1270, y: 0, width: 40, height: 20 }, { width: 1280, height: 720 }), {
      x: 1270,
      y: 0,
      width: 10,
      height: 20,
    });
    assert.equal(fitShotClip({ x: 1280, y: 0, width: 40, height: 20 }, { width: 1280, height: 720 }), undefined);
  });
});

describe("evidenceClipFromRect", () => {
  it("pads a tiny Close to at least 320×80 inside the viewport", () => {
    const clip = evidenceClipFromRect({ left: 1200, top: 8, right: 1216, bottom: 24 }, 1280, 720);
    assert.ok(clip);
    assert.ok(clip.width >= FOCUS_VISIBLE_CLIP_MIN_W || clip.x + clip.width === 1280);
    assert.ok(clip.height >= FOCUS_VISIBLE_CLIP_MIN_H);
    assert.ok(clip.x >= 0 && clip.y >= 0);
    assert.ok(clip.x + clip.width <= 1280);
  });
});
