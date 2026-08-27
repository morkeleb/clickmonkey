import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HIGH_PX,
  MAX_HITS,
  SCAN_PX,
  edgeSpread,
  isHorizontalRow,
  isStaggeredGrid,
  tabScanlineIssue,
  tabScanlineIssues,
  type TabScanBox,
  type TabScanSample,
} from "../src/surveyor/tab-scanline.js";

function box(left: number, top: number, extra?: Partial<TabScanBox>): TabScanBox {
  return { left, tabLeft: left, top, height: 24, ...extra };
}

function tabs(boxes: TabScanBox[], where = "Statements"): TabScanSample {
  return { where, boxes };
}

describe("tab scanline geometry", () => {
  it("treats 16px as aligned and 28px as high", () => {
    assert.equal(SCAN_PX, 16);
    assert.equal(HIGH_PX, 28);
    assert.equal(edgeSpread([20, 36, 24]), 16);
    assert.equal(edgeSpread([20, 60, 20]), 40);
  });

  it("detects a horizontal strip by shared tops", () => {
    assert.equal(
      isHorizontalRow([box(0, 10), box(80, 12), box(160, 10), box(240, 11)]),
      true,
    );
    assert.equal(
      isHorizontalRow([box(20, 10), box(20, 40), box(20, 70), box(20, 100)]),
      false,
    );
  });
});

describe("tabScanlineIssue", () => {
  it("flags titles with 40px left drift as high confidence", () => {
    const issue = tabScanlineIssue(
      tabs([box(20, 10), box(60, 40), box(20, 70), box(20, 100)]),
    );
    assert.ok(issue);
    assert.equal(issue.source, "visual");
    assert.equal(issue.rule, "scanline");
    assert.equal(issue.severity, "warning");
    assert.equal(issue.confidence, "high");
    assert.equal(issue.count, 1);
    assert.equal(issue.message, "Tab titles do not share a left edge");
    assert.equal(issue.where, "Statements");
  });

  it("uses medium confidence for a 17–27px spread", () => {
    const issue = tabScanlineIssue(
      tabs([box(20, 10), box(20 + SCAN_PX + 1, 40), box(20, 70)]),
    );
    assert.ok(issue);
    assert.equal(issue.confidence, "medium");
  });

  it("does not flag a 16px jitter", () => {
    assert.equal(
      tabScanlineIssue(tabs([box(20, 10), box(20 + SCAN_PX, 40), box(20, 70)])),
      undefined,
    );
  });

  it("needs three tabs", () => {
    assert.equal(tabScanlineIssue(tabs([box(20, 10), box(60, 40)])), undefined);
  });

  it("flags a horizontal strip with one title indented", () => {
    const issue = tabScanlineIssue(
      tabs([
        box(28, 10, { tabLeft: 20 }),
        box(148, 10, { tabLeft: 100 }),
        box(268, 10, { tabLeft: 260 }),
        box(388, 10, { tabLeft: 380 }),
      ]),
    );
    assert.ok(issue);
    assert.equal(issue.message, "Tab titles do not share a left edge");
    assert.equal(issue.confidence, "high");
  });

  it("does not flag an aligned horizontal strip", () => {
    assert.equal(
      tabScanlineIssue(
        tabs([
          box(28, 10, { tabLeft: 20 }),
          box(108, 10, { tabLeft: 100 }),
          box(188, 10, { tabLeft: 180 }),
          box(268, 10, { tabLeft: 260 }),
        ]),
      ),
      undefined,
    );
  });

  it("does not flag aligned vertical sidebar tabs", () => {
    assert.equal(
      tabScanlineIssue(tabs([box(20, 10), box(20, 40), box(20, 70), box(20, 100)], "Sidebar")),
      undefined,
    );
  });

  it("does not flag a 3-column card grid", () => {
    const boxes: TabScanBox[] = [];
    for (const top of [10, 120]) {
      for (const left of [20, 220, 420]) {
        boxes.push(box(left + 8, top, { height: 80, tabLeft: left }));
      }
    }
    assert.equal(isStaggeredGrid(boxes.map((b) => b.tabLeft)), true);
    assert.equal(tabScanlineIssue(tabs(boxes, "cards")), undefined);
  });
});

describe("tabScanlineIssues", () => {
  it("caps at 8 and dedupes the same where+message", () => {
    const samples: TabScanSample[] = [];
    for (let i = 0; i < 10; i++) {
      samples.push(tabs([box(20, 10), box(60, 40), box(20, 70)], `tabs ${i}`));
    }
    samples.push(tabs([box(20, 10), box(60, 40), box(20, 70)], "tabs 0"));
    const issues = tabScanlineIssues(samples);
    assert.equal(issues.length, MAX_HITS);
    assert.ok(issues.every((i) => i.rule === "scanline"));
  });
});
