import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHROME_COVER_MESSAGE,
  CHROME_OVERLAP_MESSAGE,
  clipRectByClips,
  expectedOverlay,
  isStackedSelectPair,
  issuesFromWidgets,
  MAX_OVERLAP_HITS,
  overlapConfidence,
  rectContains,
  intersectRects,
  zIndexSeverity,
  type WidgetSample,
} from "../src/surveyor/overlap.js";

const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

function widget(partial: Partial<WidgetSample> & Pick<WidgetSample, "name" | "kind" | "rect">): WidgetSample {
  return partial;
}

describe("overlap helpers", () => {
  it("requires 8px on both axes and is high only at 16px on both", () => {
    const tiny = intersectRects(box(0, 0, 20, 20), box(14, 14, 20, 20));
    assert.ok(tiny);
    assert.equal(tiny.right - tiny.left, 6);
    assert.equal(overlapConfidence(8, 8), "medium");
    assert.equal(overlapConfidence(16, 8), "medium");
    assert.equal(overlapConfidence(16, 16), "high");
  });

  it("drops a tab chip scrolled out of an overflow-hidden strip (does not pin it onto the sidebar)", () => {
    const tab = box(-180, 48, 160, 32);
    const strip = box(240, 40, 900, 48);
    const viewport = box(0, 0, 1280, 720);
    assert.equal(clipRectByClips(tab, [strip, viewport]), undefined);
    const visibleClose = box(1100, 48, 24, 24);
    const clipped = clipRectByClips(visibleClose, [strip, viewport]);
    assert.ok(clipped);
    assert.equal(clipped.left, 1100);
  });

  it("treats equal rects as overlap, not containment", () => {
    const a = box(0, 0, 40, 40);
    assert.equal(rectContains(a, a), false);
    assert.equal(rectContains(box(0, 0, 80, 80), box(8, 8, 20, 20)), true);
  });

  it("zIndex is an error on submit/button/input and a warning on links", () => {
    assert.equal(zIndexSeverity("button"), "error");
    assert.equal(zIndexSeverity("submit"), "error");
    assert.equal(zIndexSeverity("input"), "error");
    assert.equal(zIndexSeverity("link"), "warning");
  });

  it("names listbox/menu/dialog/popover as expected overlays", () => {
    assert.equal(expectedOverlay("listbox"), true);
    assert.equal(expectedOverlay("menu"), true);
    assert.equal(expectedOverlay("dialog"), true);
    assert.equal(expectedOverlay("popover"), true);
    assert.equal(expectedOverlay("header"), false);
  });
});

describe("issuesFromWidgets overlap", () => {
  it("uses one chrome message for header/nav pairs so pages do not mint unique names", () => {
    const issues = issuesFromWidgets([
      widget({
        name: "folder_open Clients & Matters",
        kind: "link",
        rect: box(0, 0, 120, 40),
        inChrome: true,
      }),
      widget({
        name: "Your account",
        kind: "button",
        rect: box(80, 0, 80, 40),
        inChrome: true,
      }),
      widget({
        name: "group Employees expand_more",
        kind: "button",
        rect: box(40, 8, 80, 32),
        inChrome: true,
      }),
    ]);
    const overlaps = issues.filter((i) => i.rule === "overlap");
    assert.ok(overlaps.length >= 1);
    assert.ok(overlaps.every((i) => i.message === CHROME_OVERLAP_MESSAGE));
  });

  it("keeps page-local overlap names when either control is not chrome", () => {
    const issues = issuesFromWidgets([
      widget({ name: "Save", kind: "button", rect: box(0, 200, 80, 40) }),
      widget({ name: "Cancel", kind: "button", rect: box(40, 200, 80, 40) }),
    ]);
    const hit = issues.find((i) => i.rule === "overlap");
    assert.ok(hit);
    assert.match(hit.message, /Save and Cancel occupy the same pixels/);
  });

  it("does not flag a select stacked on its visible value / option list", () => {
    const closed = box(80, 400, 280, 40);
    const selectEl = widget({
      name: "Select address type Mailing Remittance …",
      kind: "select",
      rect: closed,
      hit: { covered: true, by: "Remittance", byNamedControl: true },
    });
    const value = widget({ name: "Remittance", kind: "button", rect: closed });
    assert.equal(isStackedSelectPair(selectEl, value), true);
    const issues = issuesFromWidgets([selectEl, value]);
    assert.equal(
      issues.some((i) => i.rule === "overlap" || i.rule === "zIndex"),
      false,
      `closed address-type select is one control, got ${JSON.stringify(issues)}`,
    );
  });

  it("flags two buttons sharing at least 8×8 px", () => {
    const issues = issuesFromWidgets([
      widget({ name: "Alpha", kind: "button", rect: box(0, 0, 100, 40) }),
      widget({ name: "Beta", kind: "button", rect: box(60, 0, 100, 40) }),
    ]);
    const hit = issues.find((i) => i.rule === "overlap");
    assert.ok(hit, `expected overlap, got ${JSON.stringify(issues)}`);
    assert.equal(hit.source, "visual");
    assert.equal(hit.severity, "warning");
    assert.equal(hit.confidence, "high");
    assert.match(hit.where ?? "", /Alpha/);
    assert.match(hit.where ?? "", /Beta/);
  });

  it("uses medium confidence when the intersection is under 16px on an axis", () => {
    const issues = issuesFromWidgets([
      widget({ name: "Alpha", kind: "button", rect: box(0, 0, 40, 40) }),
      widget({ name: "Beta", kind: "button", rect: box(32, 32, 40, 40) }),
    ]);
    const hit = issues.find((i) => i.rule === "overlap");
    assert.ok(hit);
    assert.equal(hit.confidence, "medium");
  });

  it("skips parent/child, contained rects, zero-opacity, and 0-size", () => {
    const nested = issuesFromWidgets([
      widget({ name: "Outer", kind: "button", rect: box(0, 0, 120, 40) }),
      widget({ name: "Inner", kind: "button", rect: box(8, 4, 40, 24), parentIds: [0] }),
    ]);
    assert.equal(nested.some((i) => i.rule === "overlap"), false);

    const contained = issuesFromWidgets([
      widget({ name: "CardBtn", kind: "button", rect: box(0, 0, 200, 80) }),
      widget({ name: "Chip", kind: "button", rect: box(20, 20, 40, 24) }),
    ]);
    assert.equal(contained.some((i) => i.rule === "overlap"), false);

    const ghost = issuesFromWidgets([
      widget({ name: "A", kind: "button", rect: box(0, 0, 40, 40), opacity: 0 }),
      widget({ name: "B", kind: "button", rect: box(8, 8, 40, 40) }),
    ]);
    assert.equal(ghost.some((i) => i.rule === "overlap"), false);

    const empty = issuesFromWidgets([
      widget({ name: "A", kind: "button", rect: box(0, 0, 0, 40) }),
      widget({ name: "B", kind: "button", rect: box(0, 0, 40, 40) }),
    ]);
    assert.equal(empty.some((i) => i.rule === "overlap"), false);
  });

  it("does not pair a control with an open menu overlay covering it", () => {
    const issues = issuesFromWidgets([
      widget({ name: "Edit", kind: "button", rect: box(0, 0, 80, 32) }),
      widget({
        name: "New",
        kind: "menuitem",
        rect: box(0, 0, 120, 40),
        overlay: "menu",
        overlayId: 0,
        inOpenMenu: true,
      }),
      widget({
        name: "Open…",
        kind: "button",
        rect: box(8, 8, 80, 32),
        overlay: "menu",
        overlayId: 0,
      }),
    ]);
    assert.equal(
      issues.some((i) => i.rule === "overlap"),
      false,
      `open menu over a table must not overlap-flag, got ${JSON.stringify(issues)}`,
    );
  });

  it("caps at 8 issues", () => {
    const widgets: WidgetSample[] = [];
    for (let i = 0; i < 10; i++) {
      widgets.push(widget({ name: `A${i}`, kind: "button", rect: box(i * 4, 0, 40, 40) }));
    }
    const issues = issuesFromWidgets(widgets);
    assert.ok(issues.length <= MAX_OVERLAP_HITS);
    assert.equal(issues.length, MAX_OVERLAP_HITS);
  });
});

describe("issuesFromWidgets zIndex", () => {
  it("does not zIndex a closed dropdown whose innerText still lists the options", () => {
    const closed = box(980, 120, 220, 40);
    const list = widget({
      name: "All statuses Draft Active Closed",
      kind: "button",
      rect: closed,
      hit: { covered: true, by: "All statuses", byNamedControl: true },
    });
    const value = widget({ name: "All statuses", kind: "button", rect: closed });
    const issues = issuesFromWidgets([list, value]);
    assert.equal(
      issues.some((i) => i.rule === "overlap" || i.rule === "zIndex"),
      false,
      `closed status filter is not an open menu, got ${JSON.stringify(issues)}`,
    );
    const solo = issuesFromWidgets([list]);
    assert.equal(
      solo.some((i) => i.rule === "zIndex"),
      false,
      `option-list name covered by visible value must skip, got ${JSON.stringify(solo)}`,
    );
  });

  it("does not also zIndex a page-local pair that already overlapped", () => {
    const issues = issuesFromWidgets([
      widget({
        name: "Save",
        kind: "button",
        rect: box(0, 200, 80, 40),
        hit: { covered: true, by: "Cancel", byNamedControl: true },
      }),
      widget({ name: "Cancel", kind: "button", rect: box(40, 200, 80, 40) }),
    ]);
    assert.equal(issues.filter((i) => i.rule === "overlap").length, 1);
    assert.equal(issues.some((i) => i.rule === "zIndex"), false);
  });

  it("does not also zIndex a chrome pair that already overlapped", () => {
    const issues = issuesFromWidgets([
      widget({
        name: "folder_open Clients & Matters",
        kind: "link",
        rect: box(0, 400, 200, 40),
        inChrome: true,
        hit: { covered: true, by: "Your account", byNamedControl: true },
      }),
      widget({
        name: "Your account",
        kind: "button",
        rect: box(0, 420, 200, 48),
        inChrome: true,
      }),
    ]);
    assert.equal(issues.filter((i) => i.rule === "overlap").length, 1);
    assert.equal(
      issues.some((i) => i.rule === "zIndex"),
      false,
      `overlap already has the pair, got ${JSON.stringify(issues)}`,
    );
  });

  it("uses one chrome cover message for header/nav controls", () => {
    const issues = issuesFromWidgets([
      widget({
        name: "folder_open Clients & Matters",
        kind: "link",
        rect: box(0, 0, 120, 40),
        inChrome: true,
        hit: { covered: true, by: "Your account", byNamedControl: true },
      }),
    ]);
    const hit = issues.find((i) => i.rule === "zIndex");
    assert.ok(hit);
    assert.equal(hit.message, CHROME_COVER_MESSAGE);
    assert.match(hit.where ?? "", /Clients/);
  });

  it("skips sticky header/nav chrome covering a button", () => {
    const issues = issuesFromWidgets([
      widget({
        name: "Save",
        kind: "button",
        rect: box(16, 16, 80, 32),
        hit: { covered: true, by: "header", byNamedControl: false },
      }),
    ]);
    assert.equal(
      issues.some((i) => i.rule === "zIndex"),
      false,
      `sticky header must not zIndex, got ${JSON.stringify(issues)}`,
    );
  });

  it("is high confidence when the cover is a different named control", () => {
    const issues = issuesFromWidgets([
      widget({
        name: "Save",
        kind: "button",
        rect: box(0, 80, 80, 32),
        hit: { covered: true, by: "Card action", byNamedControl: true },
      }),
    ]);
    assert.equal(issues[0]?.confidence, "high");
    assert.equal(issues[0]?.where, "Save covered by Card action");
  });

  it("warns when a link is covered and errors when an input is", () => {
    const link = issuesFromWidgets([
      widget({
        name: "Docs",
        kind: "link",
        rect: box(0, 0, 40, 20),
        hit: { covered: true, by: "Toast" },
      }),
    ]);
    assert.equal(link[0]?.severity, "warning");
    const field = issuesFromWidgets([
      widget({
        name: "Email",
        kind: "input",
        rect: box(0, 0, 120, 32),
        hit: { covered: true, by: "Toast" },
      }),
    ]);
    assert.equal(field[0]?.severity, "error");
  });

  it("skips an open dialog/menu/listbox covering the page behind it", () => {
    const behindDialog = issuesFromWidgets([
      widget({
        name: "Behind",
        kind: "button",
        rect: box(0, 0, 80, 32),
        hit: {
          covered: true,
          by: "Confirm",
          byNamedControl: true,
          coverOverlay: "dialog",
          coverOverlayId: 0,
        },
      }),
    ]);
    assert.equal(behindDialog.some((i) => i.rule === "zIndex"), false);

    const behindMenu = issuesFromWidgets([
      widget({
        name: "Edit",
        kind: "button",
        rect: box(0, 0, 80, 32),
        hit: {
          covered: true,
          by: "File",
          coverOverlay: "menu",
          coverOverlayId: 0,
        },
      }),
    ]);
    assert.equal(behindMenu.some((i) => i.rule === "zIndex"), false);
  });

  it("still flags a sibling card covering a control inside the same stack", () => {
    const issues = issuesFromWidgets([
      widget({
        name: "Save",
        kind: "button",
        rect: box(0, 0, 80, 32),
        overlay: "dialog",
        overlayId: 0,
        hit: {
          covered: true,
          by: "card",
          byNamedControl: false,
          coverOverlay: "dialog",
          coverOverlayId: 0,
        },
      }),
    ]);
    assert.ok(issues.some((i) => i.rule === "zIndex"));
  });
});
