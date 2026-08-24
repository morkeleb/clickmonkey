import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACTABLE_SEL,
  MAX_POINTER_EVENTS_HITS,
  isPointerEventsNone,
  issuesFromHits,
  pointerEventsIssue,
  pointerEventsMessage,
  skipAriaHidden,
  skipDisabled,
  skipPointerEventsControl,
  type PointerEventsHit,
} from "../src/surveyor/pointer-events.js";

function hit(
  partial: Partial<PointerEventsHit> & Pick<PointerEventsHit, "name" | "where">,
): PointerEventsHit {
  return partial;
}

describe("pointerEvents helpers", () => {
  it("collects shown actables and caps hits at 8", () => {
    assert.match(ACTABLE_SEL, /\bbutton\b/);
    assert.match(ACTABLE_SEL, /a\[href\]/);
    assert.match(ACTABLE_SEL, /input:not\(\[type='hidden'\]\)/);
    assert.match(ACTABLE_SEL, /\bselect\b/);
    assert.match(ACTABLE_SEL, /\btextarea\b/);
    assert.match(ACTABLE_SEL, /role='button'/);
    assert.match(ACTABLE_SEL, /role='link'/);
    assert.match(ACTABLE_SEL, /role='tab'/);
    assert.doesNotMatch(ACTABLE_SEL, /menuitem/);
    assert.equal(MAX_POINTER_EVENTS_HITS, 8);
  });

  it("flags only the control's own computed pointer-events", () => {
    assert.equal(isPointerEventsNone("none"), true);
    assert.equal(isPointerEventsNone("  NONE  "), true);
    assert.equal(isPointerEventsNone("auto"), false);
    assert.equal(isPointerEventsNone("visiblePainted"), false);
    assert.equal(isPointerEventsNone(""), false);
    assert.equal(isPointerEventsNone(undefined), false);
  });

  it("skips disabled, aria-hidden, inert, and unshown controls", () => {
    assert.equal(skipDisabled({ disabled: true }), true);
    assert.equal(skipDisabled({ ariaDisabled: "true" }), true);
    assert.equal(skipDisabled({ disabled: false, ariaDisabled: "false" }), false);
    assert.equal(skipAriaHidden("true"), true);
    assert.equal(skipAriaHidden("false"), false);
    assert.equal(skipAriaHidden(null), false);
    assert.equal(skipPointerEventsControl({ shown: false }), true);
    assert.equal(skipPointerEventsControl({ inertAncestor: true }), true);
    assert.equal(skipPointerEventsControl({ ariaHidden: "true" }), true);
    assert.equal(skipPointerEventsControl({}), false);
  });
});

describe("pointerEventsIssue", () => {
  it("emits a high-confidence visual error and does not stamp via", () => {
    const issue = pointerEventsIssue(
      hit({ name: "Save", where: 'button[data-testid="dead"]' }),
    );
    assert.ok(issue);
    assert.equal(issue.source, "visual");
    assert.equal(issue.rule, "pointerEvents");
    assert.equal(issue.severity, "error");
    assert.equal(issue.confidence, "high");
    assert.equal(issue.count, 1);
    assert.equal(issue.where, 'button[data-testid="dead"]');
    assert.equal(issue.message, "Save ignores pointer events (pointer-events: none)");
    assert.equal(issue.via, undefined);
    assert.equal("via" in issue, false);
  });

  it("skips incomplete hits", () => {
    assert.equal(pointerEventsIssue(hit({ name: "", where: "#dead" })), undefined);
    assert.equal(pointerEventsIssue(hit({ name: "Save", where: "  " })), undefined);
  });

  it("caps at 8 and drops duplicate where+message", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      hit({ name: `B${i}`, where: `button[data-testid="b${i}"]` }),
    );
    const issues = issuesFromHits(many);
    assert.equal(issues.length, MAX_POINTER_EVENTS_HITS);
    const duped = issuesFromHits([
      hit({ name: "Save", where: "#dead" }),
      hit({ name: "Save", where: "#dead" }),
    ]);
    assert.equal(duped.length, 1);
  });

  it("keeps the example message shape", () => {
    assert.equal(
      pointerEventsMessage("Save"),
      "Save ignores pointer events (pointer-events: none)",
    );
  });
});
