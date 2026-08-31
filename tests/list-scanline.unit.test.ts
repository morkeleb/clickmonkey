import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HIGH_PX,
  MAX_HITS,
  SCAN_PX,
  edgeSpread,
  isHorizontalRow,
  isStaggeredGrid,
  listScanlineIssue,
  listScanlineIssues,
  looksLikeAutoStartMargin,
  looksLikeShortcutChrome,
  looksLikeShortcutText,
  similarHeightBoxes,
  type ListScanBox,
  type ListScanSample,
} from "../src/surveyor/list-scanline.js";

function box(left: number, top: number, extra?: Partial<ListScanBox>): ListScanBox {
  return { left, right: left + 180, top, height: 24, ...extra };
}

function titles(boxes: ListScanBox[], where = "Threads"): ListScanSample {
  return { kind: "titles", where, boxes };
}

describe("shortcut chrome is not a row value", () => {
  it("matches kbd, ⌘K / Ctrl+K with ml-auto, not amounts or labels", () => {
    assert.equal(looksLikeShortcutText("⌘K"), true);
    assert.equal(looksLikeShortcutText("Ctrl+K"), true);
    assert.equal(looksLikeShortcutText("ctrl+k"), true);
    assert.equal(looksLikeShortcutText("$12.00"), false);
    assert.equal(looksLikeShortcutText("Overview"), false);
    assert.equal(looksLikeAutoStartMargin({ className: "pointer-events-none ml-auto hidden h-5" }), true);
    assert.equal(looksLikeAutoStartMargin({ className: "px-2" }), false);
    assert.equal(looksLikeAutoStartMargin({ style: "margin-left: auto" }), true);
    assert.equal(looksLikeShortcutChrome({ tag: "kbd", text: "⌘K" }), true);
    assert.equal(looksLikeShortcutChrome({ tag: "span", className: "ml-auto", text: "⌘K" }), true);
    assert.equal(looksLikeShortcutChrome({ tag: "span", className: "ml-auto", text: "$12.00" }), false);
    assert.equal(looksLikeShortcutChrome({ tag: "span", text: "⌘K" }), false);
  });
});

describe("list scanline geometry", () => {
  it("treats 16px as aligned and 28px as high", () => {
    assert.equal(SCAN_PX, 16);
    assert.equal(HIGH_PX, 28);
    assert.equal(edgeSpread([20, 36, 24]), 16);
    assert.equal(edgeSpread([20, 60, 20]), 40);
  });

  it("keeps a height band of 12px and drops the rest", () => {
    const group = similarHeightBoxes([
      box(20, 10, { height: 24 }),
      box(20, 40, { height: 24 }),
      box(20, 70, { height: 26 }),
      box(20, 100, { height: 48 }),
    ]);
    assert.equal(group.length, 3);
    assert.ok(group.every((b) => b.height <= 26));
  });

  it("detects a horizontal menubar by shared tops", () => {
    assert.equal(
      isHorizontalRow([box(0, 10), box(80, 12), box(160, 10), box(240, 11)]),
      true,
    );
    assert.equal(
      isHorizontalRow([box(20, 10), box(20, 40), box(20, 70), box(20, 100)]),
      false,
    );
  });

  it("detects a 3-column grid and masonry, not a single drifted column", () => {
    assert.equal(
      isStaggeredGrid([20, 220, 420, 20, 220, 420]),
      true,
    );
    assert.equal(
      isStaggeredGrid([20, 80, 140, 30, 90, 160]),
      true,
    );
    assert.equal(isStaggeredGrid([20, 60, 20, 20]), false);
  });
});

describe("listScanlineIssue", () => {
  it("flags titles with 40px left drift as high confidence", () => {
    const issue = listScanlineIssue(
      titles([box(20, 10), box(60, 40), box(20, 70), box(20, 100)]),
    );
    assert.ok(issue);
    assert.equal(issue.source, "visual");
    assert.equal(issue.rule, "scanline");
    assert.equal(issue.severity, "warning");
    assert.equal(issue.confidence, "high");
    assert.equal(issue.count, 1);
    assert.equal(issue.message, "Row titles do not share a left edge");
    assert.equal(issue.where, "Threads");
  });

  it("uses medium confidence for a 17–27px spread", () => {
    const issue = listScanlineIssue(
      titles([box(20, 10), box(20 + SCAN_PX + 1, 40), box(20, 70)]),
    );
    assert.ok(issue);
    assert.equal(issue.confidence, "medium");
  });

  it("does not flag a 16px jitter", () => {
    assert.equal(
      listScanlineIssue(titles([box(20, 10), box(20 + SCAN_PX, 40), box(20, 70)])),
      undefined,
    );
  });

  it("does not flag a 3-column card grid", () => {
    const boxes: ListScanBox[] = [];
    for (const top of [10, 120]) {
      for (const left of [20, 220, 420]) {
        boxes.push(box(left, top, { height: 80, right: left + 180 }));
      }
    }
    assert.equal(listScanlineIssue(titles(boxes, "cards")), undefined);
  });

  it("does not flag a horizontal menubar", () => {
    assert.equal(
      listScanlineIssue(
        titles([box(0, 10), box(80, 10), box(160, 10), box(240, 10)], "Primary"),
      ),
      undefined,
    );
  });

  it("needs three similar-height stacked siblings", () => {
    assert.equal(listScanlineIssue(titles([box(20, 10), box(60, 40)])), undefined);
    assert.equal(
      listScanlineIssue(
        titles([
          box(20, 10, { height: 24 }),
          box(60, 40, { height: 24 }),
          box(20, 70, { height: 48 }),
        ]),
      ),
      undefined,
    );
  });

  it("does not flag aligned row titles", () => {
    assert.equal(
      listScanlineIssue(titles([box(20, 10), box(20, 40), box(20, 70), box(20, 100)])),
      undefined,
    );
  });

  it("flags trailing actions on the right edge", () => {
    const issue = listScanlineIssue({
      kind: "actions",
      where: "Threads",
      boxes: [
        box(200, 10, { right: 240 }),
        box(200, 40, { right: 280 }),
        box(200, 70, { right: 240 }),
        box(200, 100, { right: 240, rowLeft: 20 }),
      ].map((b, i) => ({ ...b, rowLeft: 20, left: 200, top: 10 + i * 30 })),
    });
    assert.ok(issue);
    assert.equal(issue.message, "Row actions do not share a right edge");
    assert.equal(issue.confidence, "high");
  });

  it("flags trailing values shoved by variable-width titles", () => {
    const issue = listScanlineIssue({
      kind: "values",
      where: "Voucher cards",
      boxes: [
        box(120, 10, { right: 160, rowLeft: 20 }),
        box(280, 40, { right: 320, rowLeft: 20 }),
        box(80, 70, { right: 140, rowLeft: 20 }),
      ],
    });
    assert.ok(issue);
    assert.equal(issue.message, "Row values do not share a left edge");
    assert.equal(issue.confidence, "high");
  });

  it("does not flag right-locked amounts whose lefts move with title width", () => {
    assert.equal(
      listScanlineIssue({
        kind: "values",
        where: "Locked amounts",
        boxes: [
          box(200, 10, { right: 240, rowLeft: 20 }),
          box(80, 40, { right: 240, rowLeft: 20 }),
          box(300, 70, { right: 240, rowLeft: 20 }),
        ],
      }),
      undefined,
    );
  });

  it("does not flag left-aligned values that only grow to the right", () => {
    assert.equal(
      listScanlineIssue({
        kind: "values",
        where: "meta",
        boxes: [
          box(200, 10, { right: 240, rowLeft: 20 }),
          box(200, 40, { right: 320, rowLeft: 20 }),
          box(200, 70, { right: 260, rowLeft: 20 }),
        ],
      }),
      undefined,
    );
  });

  it("flags row icons on the left edge", () => {
    const issue = listScanlineIssue({
      kind: "icons",
      where: "nav",
      boxes: [box(16, 10), box(48, 40), box(16, 70), box(16, 100)].map((b) => ({
        ...b,
        right: b.left + 16,
        rowLeft: 8,
      })),
    });
    assert.ok(issue);
    assert.equal(issue.message, "Row icons do not share a left edge");
  });

  it("uses row lefts so a 3-col grid of ragged titles still skips", () => {
    const boxes: ListScanBox[] = [];
    for (const top of [10, 120]) {
      for (const left of [20, 220, 420]) {
        boxes.push(box(left + 40, top, { height: 80, rowLeft: left, right: left + 160 }));
      }
    }
    assert.equal(listScanlineIssue(titles(boxes, "cards")), undefined);
  });
});

describe("listScanlineIssues", () => {
  it("caps at 8 and dedupes the same where+message", () => {
    const samples: ListScanSample[] = [];
    for (let i = 0; i < 10; i++) {
      samples.push(titles([box(20, 10), box(60, 40), box(20, 70)], `list ${i}`));
    }
    samples.push(titles([box(20, 10), box(60, 40), box(20, 70)], "list 0"));
    const issues = listScanlineIssues(samples);
    assert.equal(issues.length, MAX_HITS);
    assert.ok(issues.every((i) => i.rule === "scanline"));
  });
});
