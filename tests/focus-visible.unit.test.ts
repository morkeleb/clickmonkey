import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTABLE_SEL, MAX_ACTABLES } from "../src/surveyor/focus-obscured.js";
import {
  MAX_FOCUS_VISIBLE_HITS,
  focusIndicatorChanged,
  focusVisibleIssue,
  issuesFromHits,
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
});
