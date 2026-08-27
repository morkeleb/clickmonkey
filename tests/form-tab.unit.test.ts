import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  focusOrderIssue,
  isFocusWrap,
  isStuckTabs,
  isVerticalInversion,
  issuesFromTabSeq,
  keyboardTrapIssue,
  type TabStop,
} from "../src/surveyor/form-tab.js";

function stop(where: string, y: number, name = where): TabStop {
  return { name, where, x: 0, y, w: 120, h: 32 };
}

describe("form tab", () => {
  it("flags three consecutive Tabs that do not move focus", () => {
    const seq = [stop("name", 0), stop("stuck", 40), stop("stuck", 40), stop("stuck", 40)];
    assert.equal(isStuckTabs(seq), true);
    const issues = issuesFromTabSeq(seq);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.rule, "keyboardTrap");
    assert.match(issues[0]?.message ?? "", /2\.1\.2/);
    assert.equal(keyboardTrapIssue(seq[3]!).where, "stuck");
  });

  it("does not flag a normal top-to-bottom form", () => {
    const seq = [stop("name", 0), stop("email", 48), stop("save", 96)];
    assert.equal(isStuckTabs(seq), false);
    assert.deepEqual(issuesFromTabSeq(seq), []);
  });

  it("flags a consecutive Tab that jumps up a row", () => {
    const save = stop("save", 160, "Save");
    const email = stop("email", 80, "Email");
    const name = stop("name", 0, "Name");
    assert.equal(isVerticalInversion(save, email, save), true);
    assert.equal(isFocusWrap(save, name, save), false);
    const issues = issuesFromTabSeq([save, email, name]);
    assert.ok(issues.some((i) => i.rule === "focusOrder"));
    assert.match(focusOrderIssue(email, save).message, /2\.4\.3/);
  });

  it("does not treat wrap from last field back to first as an inversion", () => {
    const name = stop("name", 0);
    const email = stop("email", 48);
    const save = stop("save", 96);
    assert.equal(isFocusWrap(save, name, name), true);
    assert.equal(isVerticalInversion(save, name, name), false);
    assert.deepEqual(issuesFromTabSeq([name, email, save, name]), []);
  });
});
