import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Page } from "playwright";
import {
  MAX_OVERFLOW_HITS,
  OVERFLOW_PX,
  childWiderPx,
  crossesViewportEdge,
  documentOverflowPx,
  isDocumentXOverflow,
  isReflowDocumentLeak,
  isFixedChromeInViewport,
  isIntendedScroll,
  isPopupOverflowLayer,
  isSmallOpenDialog,
  overflowLayoutIssue,
  scanOverflowMobile,
  scanOverflowReflow,
  takeOverflowHits,
  xOverflowContained,
  type OverflowBox,
} from "../src/surveyor/overflow.js";

const vw = 1280;
const vh = 720;
const pane: OverflowBox = { left: 0, right: vw, top: 0, bottom: vh };

describe("overflow geometry", () => {
  it("flags document horizontal overflow past the scrollbar gutter, not 1–15px", () => {
    assert.equal(isDocumentXOverflow(1297, 1280), true);
    assert.equal(isDocumentXOverflow(1295, 1280), false);
    assert.equal(isDocumentXOverflow(1281, 1280), false);
    assert.equal(isDocumentXOverflow(1280, 1280), false);
    assert.equal(documentOverflowPx(1324, 1280), 44);
  });

  it("flags a box that crosses the viewport right or bottom by ≥8px", () => {
    assert.equal(crossesViewportEdge({ ...pane, right: vw + OVERFLOW_PX }, vw, vh), true);
    assert.equal(crossesViewportEdge({ ...pane, right: vw + OVERFLOW_PX - 1 }, vw, vh), false);
    assert.equal(crossesViewportEdge({ ...pane, bottom: vh + OVERFLOW_PX }, vw, vh), true);
    assert.equal(crossesViewportEdge({ ...pane, bottom: vh + 3 }, vw, vh), false);
  });

  it("measures a child wider than a non-scrolling parent", () => {
    const parent: OverflowBox = { left: 440, right: 840, top: 80, bottom: 400 };
    const child: OverflowBox = { left: 440, right: 960, top: 80, bottom: 200 };
    assert.equal(childWiderPx(child, parent), 120);
    assert.equal(isIntendedScroll("auto"), true);
    assert.equal(isIntendedScroll("scroll"), true);
    assert.equal(isIntendedScroll("visible"), false);
    assert.equal(xOverflowContained("auto"), true);
    assert.equal(xOverflowContained("hidden"), true);
    assert.equal(xOverflowContained("visible"), false);
  });

  it("skips fixed nav/header chrome that stays inside the viewport", () => {
    const box: OverflowBox = { left: 0, right: vw, top: 0, bottom: 48 };
    assert.equal(
      isFixedChromeInViewport({ tag: "header", position: "fixed", box, vw, vh }),
      true,
    );
    assert.equal(
      isFixedChromeInViewport({ tag: "nav", role: "navigation", position: "sticky", box, vw, vh }),
      true,
    );
    assert.equal(
      isFixedChromeInViewport({
        tag: "header",
        position: "fixed",
        box: { ...box, right: vw + 40 },
        vw,
        vh,
      }),
      false,
    );
    assert.equal(
      isFixedChromeInViewport({ tag: "main", position: "fixed", box, vw, vh }),
      false,
    );
  });

  it("treats a card-sized dialog as an overlay at every viewport", () => {
    assert.equal(
      isSmallOpenDialog({ left: 400, right: 800, top: 120, bottom: 400 }, vw),
      true,
    );
    assert.equal(
      isSmallOpenDialog({ left: 40, right: 1240, top: 20, bottom: 700 }, vw),
      false,
    );
    assert.equal(
      isSmallOpenDialog({ left: 20, right: 300, top: 80, bottom: 400 }, 320),
      true,
    );
    assert.equal(
      isSmallOpenDialog({ left: 16, right: 304, top: 40, bottom: 360 }, 375),
      true,
    );
  });

  it("skips popup layers by role and class token, not in-flow page blocks", () => {
    assert.equal(isPopupOverflowLayer({ role: "listbox" }), true);
    assert.equal(isPopupOverflowLayer({ role: "menu" }), true);
    assert.equal(isPopupOverflowLayer({ role: "tooltip" }), true);
    assert.equal(isPopupOverflowLayer({ popoverOpen: true }), true);
    assert.equal(isPopupOverflowLayer({ className: "fvs-menu-surface" }), true);
    assert.equal(isPopupOverflowLayer({ className: "mdc-menu" }), true);
    assert.equal(isPopupOverflowLayer({ className: "fvs-skrim" }), true);
    assert.equal(isPopupOverflowLayer({ className: "mdc-dialog__scrim" }), true);
    assert.equal(isPopupOverflowLayer({ className: "modal-backdrop" }), true);
    assert.equal(isPopupOverflowLayer({ className: "wide hero-grid" }), false);
    assert.equal(isPopupOverflowLayer({ role: "main", className: "wide" }), false);
  });
});

describe("overflowLayoutIssue", () => {
  it("treats a 20px page-width leak as medium (scrollbar / 100vw noise)", () => {
    const issue = overflowLayoutIssue({
      where: "hero-grid",
      px: 20,
      kind: "document",
    });
    assert.ok(issue);
    assert.equal(issue.confidence, "medium");
    assert.equal(issue.severity, "warning");
  });

  it("treats 320 page-width as reflow only when it is new vs desktop", () => {
    assert.equal(isReflowDocumentLeak(undefined, 20), true);
    assert.equal(isReflowDocumentLeak(0, 20), true);
    assert.equal(isReflowDocumentLeak(15, 20), true);
    assert.equal(isReflowDocumentLeak(30, 30), false);
    assert.equal(isReflowDocumentLeak(30, 36), false);
    assert.equal(isReflowDocumentLeak(30, 50), true);
  });

  it("treats a 20px document leak as high at 320 reflow width", () => {
    const issue = overflowLayoutIssue(
      { where: "hero-grid", px: 20, kind: "document" },
      320,
    );
    assert.ok(issue);
    assert.equal(issue.confidence, "high");
    assert.equal(issue.severity, "error");
  });

  it("names document overflow as a high-confidence page width leak", () => {
    const issue = overflowLayoutIssue({
      where: "hero-grid",
      px: 44,
      kind: "document",
    });
    assert.ok(issue);
    assert.equal(issue.rule, "overflow");
    assert.equal(issue.source, "visual");
    assert.equal(issue.severity, "error");
    assert.equal(issue.confidence, "high");
    assert.equal(issue.count, 1);
    assert.equal(issue.where, "hero-grid");
    assert.equal(issue.message, "Page is 44px wider than the viewport");
  });

  it("names a child past the main pane as medium when the page does not scroll", () => {
    const issue = overflowLayoutIssue({
      where: "hero-grid",
      label: "Hero grid",
      px: 80,
      kind: "container",
      parentWhere: "the main pane",
    });
    assert.ok(issue);
    assert.equal(issue.confidence, "medium");
    assert.equal(issue.severity, "warning");
    assert.equal(issue.message, "Hero grid extends 80px past the main pane");
  });

  it("drops sub-threshold leaks", () => {
    assert.equal(
      overflowLayoutIssue({ where: "hero-grid", px: 1, kind: "document" }),
      undefined,
    );
    assert.equal(
      overflowLayoutIssue({ where: "hero-grid", px: 7, kind: "viewport" }),
      undefined,
    );
    assert.equal(overflowLayoutIssue({ where: "", px: 40, kind: "document" }), undefined);
  });

  it("keeps the worst eight hits", () => {
    const hits = Array.from({ length: 12 }, (_, i) => ({ px: i + 1, where: `n${i}` }));
    const top = takeOverflowHits(hits);
    assert.equal(top.length, MAX_OVERFLOW_HITS);
    assert.equal(top[0]?.px, 12);
    assert.equal(top[7]?.px, 5);
  });
});

describe("scanOverflowMobile restore", () => {
  it("restores the previous viewport when the 375 pass throws", async () => {
    const prev = { width: 1280, height: 720 };
    const sizes: { width: number; height: number }[] = [];
    const page = {
      viewportSize: () => prev,
      async setViewportSize(size: { width: number; height: number }) {
        sizes.push({ ...size });
        if (size.width === 375) throw new Error("resize failed");
      },
    };
    await assert.rejects(() => scanOverflowMobile(page as unknown as Page), /resize failed/);
    assert.deepEqual(sizes.at(-1), prev);
  });

  it("restores the previous viewport when collect throws", async () => {
    const prev = { width: 1280, height: 720 };
    const sizes: { width: number; height: number }[] = [];
    const page = {
      viewportSize: () => prev,
      async setViewportSize(size: { width: number; height: number }) {
        sizes.push({ ...size });
      },
      evaluate() {
        return Promise.reject(new Error("collect failed"));
      },
    };
    const issues = await scanOverflowMobile(page as unknown as Page);
    assert.deepEqual(issues, []);
    assert.deepEqual(sizes.at(-1), prev);
    assert.equal(sizes.some((s) => s.width === 375), true);
  });
});

describe("scanOverflowReflow restore", () => {
  it("restores the previous viewport when the 320 pass throws", async () => {
    const prev = { width: 1280, height: 720 };
    const sizes: { width: number; height: number }[] = [];
    const page = {
      viewportSize: () => prev,
      async setViewportSize(size: { width: number; height: number }) {
        sizes.push({ ...size });
        if (size.width === 320) throw new Error("resize failed");
      },
    };
    await assert.rejects(() => scanOverflowReflow(page as unknown as Page), /resize failed/);
    assert.deepEqual(sizes.at(-1), prev);
  });

  it("restores the previous viewport when collect throws", async () => {
    const prev = { width: 1280, height: 720 };
    const sizes: { width: number; height: number }[] = [];
    const page = {
      viewportSize: () => prev,
      async setViewportSize(size: { width: number; height: number }) {
        sizes.push({ ...size });
      },
      evaluate() {
        return Promise.reject(new Error("collect failed"));
      },
    };
    const issues = await scanOverflowReflow(page as unknown as Page);
    assert.deepEqual(issues, []);
    assert.deepEqual(sizes.at(-1), prev);
    assert.equal(sizes.some((s) => s.width === 320), true);
  });

  it("takes the evidence still at 320 before restoring the viewport", async () => {
    let current = { width: 1280, height: 720 };
    const sizes: number[] = [];
    const shotAt: number[] = [];
    const page = {
      viewportSize: () => current,
      async setViewportSize(size: { width: number; height: number }) {
        current = { ...size };
        sizes.push(size.width);
      },
      async evaluate() {
        return [{ where: "hero", px: 80, kind: "document", label: "Hero" }];
      },
    };
    const issues = await scanOverflowReflow(page as unknown as Page, async () => {
      shotAt.push(current.width);
      return "/tmp/overflow-320.png";
    });
    assert.ok(issues.some((i) => i.rule === "overflow" && /@ 320px/.test(`${i.where} ${i.message}`)));
    assert.deepEqual(shotAt, [320]);
    assert.equal(sizes.at(-1), 1280);
    assert.ok(sizes.includes(320));
  });
});
