import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BUTTON_SELECTOR,
  MAX_IMPLICIT_SUBMIT_HITS,
  hasExplicitButtonType,
  implicitSubmitIssue,
  implicitSubmitMessage,
  isFormAssociated,
  issuesFromImplicitSubmitHits,
  missingButtonType,
  skipImplicitSubmit,
  type ImplicitSubmitHit,
} from "../src/surveyor/implicit-submit.js";

function hit(partial: Partial<ImplicitSubmitHit> = {}): ImplicitSubmitHit {
  return { name: "Cancel", where: 'button[data-testid="cancel"]', ...partial };
}

describe("implicitSubmit helpers", () => {
  it("only queries button elements and caps at 8", () => {
    assert.equal(BUTTON_SELECTOR, "button");
    assert.doesNotMatch(BUTTON_SELECTOR, /input/);
    assert.equal(MAX_IMPLICIT_SUBMIT_HITS, 8);
  });

  it("treats missing or empty type as implicit submit", () => {
    assert.equal(missingButtonType(undefined), true);
    assert.equal(missingButtonType(null), true);
    assert.equal(missingButtonType(""), true);
    assert.equal(missingButtonType("  "), true);
    assert.equal(missingButtonType("button"), false);
    assert.equal(missingButtonType("submit"), false);
    assert.equal(missingButtonType("btn"), true);
  });

  it("treats button, submit, and reset as explicit", () => {
    assert.equal(hasExplicitButtonType("button"), true);
    assert.equal(hasExplicitButtonType("submit"), true);
    assert.equal(hasExplicitButtonType("reset"), true);
    assert.equal(hasExplicitButtonType("Submit"), true);
    assert.equal(hasExplicitButtonType(""), false);
    assert.equal(hasExplicitButtonType(undefined), false);
  });

  it("associates a button inside a form or via form= pointing at a form", () => {
    assert.equal(isFormAssociated({ inForm: true }), true);
    assert.equal(isFormAssociated({ formAttr: "edit-form", formExists: true }), true);
    assert.equal(isFormAssociated({ formAttr: "missing", formExists: false }), false);
    assert.equal(isFormAssociated({ formAttr: "", formExists: true }), false);
    assert.equal(isFormAssociated({}), false);
  });
});

describe("skipImplicitSubmit", () => {
  it("flags a shown typeless button that owns a form", () => {
    assert.equal(skipImplicitSubmit({ inForm: true }), false);
    assert.equal(skipImplicitSubmit({ formAttr: "edit-form", formExists: true }), false);
    assert.equal(skipImplicitSubmit({ inForm: true, type: "" }), false);
  });

  it("skips explicit types, non-buttons, and buttons with no form", () => {
    assert.equal(skipImplicitSubmit({ inForm: true, type: "button" }), true);
    assert.equal(skipImplicitSubmit({ inForm: true, type: "submit" }), true);
    assert.equal(skipImplicitSubmit({ inForm: true, type: "reset" }), true);
    assert.equal(skipImplicitSubmit({ inForm: true, type: "btn" }), false);
    assert.equal(skipImplicitSubmit({ tag: "input", inForm: true }), true);
    assert.equal(skipImplicitSubmit({}), true);
    assert.equal(skipImplicitSubmit({ formAttr: "missing", formExists: false }), true);
  });

  it("skips disabled, aria-hidden, toolbar chrome, and hidden boxes", () => {
    assert.equal(skipImplicitSubmit({ inForm: true, disabled: true }), true);
    assert.equal(skipImplicitSubmit({ inForm: true, ariaDisabled: "true" }), true);
    assert.equal(skipImplicitSubmit({ inForm: true, ariaHidden: true }), true);
    assert.equal(skipImplicitSubmit({ inForm: true, inToolbar: true }), true);
    assert.equal(skipImplicitSubmit({ inForm: true, inListPopup: true }), true);
    assert.equal(skipImplicitSubmit({ inForm: true, hidden: true }), true);
    assert.equal(skipImplicitSubmit({ inForm: true, zeroBox: true }), true);
  });
});

describe("implicitSubmitIssue", () => {
  it("flags a typeless Cancel as a high-confidence visual warning", () => {
    const issue = implicitSubmitIssue(hit());
    assert.ok(issue);
    assert.equal(issue.source, "visual");
    assert.equal(issue.rule, "implicitSubmit");
    assert.equal(issue.severity, "warning");
    assert.equal(issue.confidence, "high");
    assert.equal(issue.count, 1);
    assert.equal(issue.where, 'button[data-testid="cancel"]');
    assert.equal(issue.message, "Button Cancel has no type and will submit the form");
    assert.equal(issue.via, undefined);
  });

  it("skips incomplete hits", () => {
    assert.equal(implicitSubmitIssue(hit({ name: "" })), undefined);
    assert.equal(implicitSubmitIssue(hit({ where: "  " })), undefined);
  });

  it("caps at 8 and drops duplicate where+message", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      hit({ name: `B${i}`, where: `button[data-testid="b${i}"]` }),
    );
    const issues = issuesFromImplicitSubmitHits(many);
    assert.equal(issues.length, MAX_IMPLICIT_SUBMIT_HITS);
    const duped = issuesFromImplicitSubmitHits([hit(), hit()]);
    assert.equal(duped.length, 1);
  });

  it("keeps the example message shape", () => {
    assert.equal(implicitSubmitMessage("Cancel"), "Button Cancel has no type and will submit the form");
  });
});
