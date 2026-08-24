import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACTABLE_SEL,
  MAX_ACTABLES,
  MAX_FOCUS_OBSCURED_HITS,
  coverPhrase,
  focusObscuredIssue,
  focusObscuredMessage,
  isEntirelyObscured,
  issuesFromHits,
  pointInRect,
  probeGrid,
  selectActables,
  skipAriaHidden,
  skipCoveringDialog,
  skipDisabled,
  type FocusObscuredHit,
  type ProbeHit,
} from "../src/surveyor/focus-obscured.js";

const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

function probe(partial: Partial<ProbeHit> & Pick<ProbeHit, "inRect" | "self">): ProbeHit {
  return { x: 0, y: 0, ...partial };
}

function hit(
  partial: Partial<FocusObscuredHit> & Pick<FocusObscuredHit, "name" | "where" | "by">,
): FocusObscuredHit {
  return partial;
}

describe("focusObscured helpers", () => {
  it("collects the 2.4.11 actable set, preferring main, cap 24", () => {
    assert.match(ACTABLE_SEL, /\bbutton\b/);
    assert.match(ACTABLE_SEL, /a\[href\]/);
    assert.match(ACTABLE_SEL, /input:not\(\[type='hidden'\]\)/);
    assert.match(ACTABLE_SEL, /\bselect\b/);
    assert.match(ACTABLE_SEL, /\btextarea\b/);
    assert.match(ACTABLE_SEL, /role='button'/);
    assert.match(ACTABLE_SEL, /role='link'/);
    assert.match(ACTABLE_SEL, /role='tab'/);
    assert.doesNotMatch(ACTABLE_SEL, /menuitem/);
    assert.equal(MAX_ACTABLES, 24);
    assert.equal(MAX_FOCUS_OBSCURED_HITS, 8);

    const items = [
      { name: "Nav", inMain: false },
      { name: "Save", inMain: true },
      { name: "Footer", inMain: false },
      { name: "Email", inMain: true },
    ];
    const picked = selectActables(items, 3);
    assert.deepEqual(
      picked.map((i) => i.name),
      ["Save", "Email", "Nav"],
    );
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `A${i}`, inMain: true }));
    assert.equal(selectActables(many).length, MAX_ACTABLES);
  });

  it("probes a 3×3 grid inside the focused rect (center + mid-edges)", () => {
    const r = box(10, 20, 100, 40);
    const pts = probeGrid(r);
    assert.equal(pts.length, 9);
    for (const p of pts) {
      assert.equal(pointInRect(p, r), true, `probe ${p.x},${p.y} must sit in the rect`);
    }
    const xs = [...new Set(pts.map((p) => p.x))].sort((a, b) => a - b);
    const ys = [...new Set(pts.map((p) => p.y))].sort((a, b) => a - b);
    assert.equal(xs.length, 3);
    assert.equal(ys.length, 3);
    assert.equal(xs[1], 60);
    assert.equal(ys[1], 40);
    assert.ok((xs[0] ?? 0) > r.left);
    assert.ok((xs[2] ?? 0) < r.right);
    assert.equal(probeGrid(box(0, 0, 0, 40)).length, 0);
  });

  it("fails only when every in-rect probe hits a non-descendant", () => {
    const covered = Array.from({ length: 9 }, () => probe({ inRect: true, self: false }));
    assert.equal(isEntirelyObscured(covered), true);

    const partial = covered.slice();
    partial[4] = probe({ inRect: true, self: true });
    assert.equal(isEntirelyObscured(partial), false);

    const noneLanded = Array.from({ length: 9 }, () => probe({ inRect: false, self: false }));
    assert.equal(isEntirelyObscured(noneLanded), false);
    assert.equal(isEntirelyObscured([]), false);

    const fiveCovered = [
      ...Array.from({ length: 5 }, () => probe({ inRect: true, self: false })),
      ...Array.from({ length: 4 }, () => probe({ inRect: false, self: false })),
    ];
    assert.equal(isEntirelyObscured(fiveCovered), true);
  });

  it("skips aria-hidden, disabled, and a page-covering dialog", () => {
    assert.equal(skipAriaHidden("true"), true);
    assert.equal(skipAriaHidden("false"), false);
    assert.equal(skipAriaHidden(null), false);
    assert.equal(skipDisabled({ disabled: true }), true);
    assert.equal(skipDisabled({ ariaDisabled: "true" }), true);
    assert.equal(skipDisabled({ disabled: false, ariaDisabled: "false" }), false);
    assert.equal(
      skipCoveringDialog({ controlInsideDialog: false, coverInsideDialog: true }),
      true,
    );
    assert.equal(
      skipCoveringDialog({ controlInsideDialog: true, coverInsideDialog: true }),
      false,
    );
    assert.equal(
      skipCoveringDialog({ controlInsideDialog: false, coverInsideDialog: false }),
      false,
    );
  });

  it("names sticky header, cookie banner, and chat widget covers", () => {
    assert.equal(
      coverPhrase({ tag: "header", position: "fixed", name: "App header" }),
      "the sticky header",
    );
    assert.equal(
      coverPhrase({ tag: "header", role: "banner", position: "sticky" }),
      "the sticky header",
    );
    assert.equal(
      coverPhrase({ tag: "div", id: "cookie-banner", name: "Cookies" }),
      "the cookie banner",
    );
    assert.equal(
      coverPhrase({ tag: "div", className: "intercom-chat", name: "Help" }),
      "the chat widget",
    );
    assert.equal(coverPhrase({ tag: "div" }), "an overlay");
    assert.equal(
      focusObscuredMessage("Save", "the sticky header"),
      "Save is entirely hidden by the sticky header when focused",
    );
  });
});

describe("focusObscuredIssue", () => {
  it("emits a high-confidence visual error when fully covered", () => {
    const issue = focusObscuredIssue(
      hit({
        name: "Save",
        where: 'button[data-testid="save"]',
        by: "the sticky header",
      }),
    );
    assert.ok(issue);
    assert.equal(issue.source, "visual");
    assert.equal(issue.rule, "focusObscured");
    assert.equal(issue.severity, "error");
    assert.equal(issue.confidence, "high");
    assert.equal(issue.count, 1);
    assert.equal(issue.where, 'button[data-testid="save"]');
    assert.equal(issue.message, "Save is entirely hidden by the sticky header when focused");
  });

  it("skips incomplete hits", () => {
    assert.equal(
      focusObscuredIssue(hit({ name: "", where: "#save", by: "the sticky header" })),
      undefined,
    );
    assert.equal(
      focusObscuredIssue(hit({ name: "Save", where: "  ", by: "the sticky header" })),
      undefined,
    );
    assert.equal(
      focusObscuredIssue(hit({ name: "Save", where: "#save", by: "" })),
      undefined,
    );
  });

  it("caps at 8 and drops duplicate where+message", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      hit({ name: `B${i}`, where: `button[data-testid="b${i}"]`, by: "the sticky header" }),
    );
    const issues = issuesFromHits(many);
    assert.equal(issues.length, MAX_FOCUS_OBSCURED_HITS);
    const duped = issuesFromHits([
      hit({ name: "Save", where: "#save", by: "the sticky header" }),
      hit({ name: "Save", where: "#save", by: "the sticky header" }),
    ]);
    assert.equal(duped.length, 1);
  });
});
