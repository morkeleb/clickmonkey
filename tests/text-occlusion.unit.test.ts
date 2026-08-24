import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CANDIDATE_SELECTOR,
  MAX_HITS,
  MAX_RECTS,
  clipWhere,
  describeCover,
  expectedOverlay,
  isStickyChromeCover,
  hitPaints,
  issuesFromHits,
  occlusionConfidence,
  probeRelated,
  rectUsable,
  skipOpenOverlay,
  skipOverflowClip,
  textKindFromTag,
  textOcclusionIssue,
  textOcclusionMessage,
  type TextOcclusionHit,
} from "../src/surveyor/text-occlusion.js";

const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

function hit(partial: Partial<TextOcclusionHit> = {}): TextOcclusionHit {
  return {
    kind: "Heading",
    where: "Quarterly revenue",
    cover: "a badge",
    probed: 1,
    occluded: 1,
    ...partial,
  };
}

describe("text-occlusion helpers", () => {
  it("targets headings, copy, labels, and cells — not every span", () => {
    assert.match(CANDIDATE_SELECTOR, /h1/);
    assert.match(CANDIDATE_SELECTOR, /\bp\b/);
    assert.match(CANDIDATE_SELECTOR, /label/);
    assert.match(CANDIDATE_SELECTOR, /\bth\b/);
    assert.match(CANDIDATE_SELECTOR, /\btd\b/);
    assert.match(CANDIDATE_SELECTOR, /role='heading'/);
    assert.match(CANDIDATE_SELECTOR, /legend/);
    assert.doesNotMatch(CANDIDATE_SELECTOR, /\bspan\b/);
    assert.equal(MAX_HITS, 8);
    assert.equal(MAX_RECTS, 3);
  });

  it("names the text kind from tag/role", () => {
    assert.equal(textKindFromTag({ tag: "h1" }), "Heading");
    assert.equal(textKindFromTag({ role: "heading", tag: "div" }), "Heading");
    assert.equal(textKindFromTag({ tag: "p" }), "Paragraph");
    assert.equal(textKindFromTag({ tag: "label" }), "Label");
    assert.equal(textKindFromTag({ tag: "td" }), "Cell");
    assert.equal(textKindFromTag({ tag: "legend" }), "Legend");
    assert.equal(textKindFromTag({ tag: "span" }), "Text");
  });

  it("names a badge or chip as the cover and treats sticky chrome as skip", () => {
    assert.equal(describeCover({ className: "badge" }), "a badge");
    assert.equal(describeCover({ className: "chip" }), "a chip");
    assert.equal(describeCover({ tag: "header", position: "sticky" }), "a sticky bar");
    assert.equal(isStickyChromeCover({ tag: "header", position: "sticky" }), true);
    assert.equal(isStickyChromeCover({ tag: "nav", role: "navigation", position: "fixed" }), true);
    assert.equal(isStickyChromeCover({ className: "badge" }), false);
    assert.equal(describeCover({ name: "toast" }), "toast");
    assert.equal(describeCover({ tag: "div" }), "div");
  });

  it("builds the covered-by message", () => {
    assert.equal(textOcclusionMessage("Heading", "a badge"), "Heading is covered by a badge");
    assert.equal(clipWhere("Quarterly revenue"), "Quarterly revenue");
    const long = "A".repeat(50);
    const where = clipWhere(long);
    assert.equal(where.length, 40);
    assert.match(where, /…$/);
  });

  it("reports only entirely covered probes as high", () => {
    assert.equal(occlusionConfidence(1, 1), "high");
    assert.equal(occlusionConfidence(3, 3), "high");
    assert.equal(occlusionConfidence(3, 1), undefined);
    assert.equal(occlusionConfidence(3, 2), undefined);
    assert.equal(occlusionConfidence(0, 0), undefined);
  });

  it("skips parent/child, zero-size, off-screen, and transparent hits", () => {
    assert.equal(probeRelated({ hitIsSelf: true }), true);
    assert.equal(probeRelated({ hitIsAncestor: true }), true);
    assert.equal(probeRelated({ hitIsDescendant: true }), true);
    assert.equal(probeRelated({}), false);
    assert.equal(rectUsable(box(0, 0, 0, 40), 1280, 720), false);
    assert.equal(rectUsable(box(-80, 10, 40, 20), 1280, 720), false);
    assert.equal(rectUsable(box(10, 10, 80, 24), 1280, 720), true);
    assert.equal(hitPaints({ visible: true, opacity: 0 }), false);
    assert.equal(hitPaints({ visible: false, opacity: 1 }), false);
    assert.equal(hitPaints({ visible: true, opacity: 1 }), true);
  });

  it("skips overflow clip of the same box and an open dialog covering the page", () => {
    assert.equal(skipOverflowClip({ overflowX: "hidden", probeInClip: false }), true);
    assert.equal(skipOverflowClip({ overflowX: "hidden", probeInClip: true }), false);
    assert.equal(skipOverflowClip({ overflowX: "visible", probeInClip: false }), false);
    assert.equal(expectedOverlay("dialog"), true);
    assert.equal(expectedOverlay("menu"), true);
    assert.equal(expectedOverlay("header"), false);
    assert.equal(
      skipOpenOverlay({ textOverlayId: -1, coverOverlay: "dialog", coverOverlayId: 0 }),
      true,
    );
    assert.equal(
      skipOpenOverlay({ textOverlayId: 0, coverOverlay: "dialog", coverOverlayId: 0 }),
      false,
    );
  });
});

describe("textOcclusionIssue", () => {
  it("flags entirely covered text as a high-confidence visual warning", () => {
    const issue = textOcclusionIssue(hit());
    assert.ok(issue);
    assert.equal(issue.source, "visual");
    assert.equal(issue.rule, "textOcclusion");
    assert.equal(issue.severity, "warning");
    assert.equal(issue.confidence, "high");
    assert.equal(issue.count, 1);
    assert.equal(issue.where, "Quarterly revenue");
    assert.equal(issue.message, "Heading is covered by a badge");
  });

  it("skips a corner overlap that does not cover every probed rect", () => {
    assert.equal(textOcclusionIssue(hit({ probed: 3, occluded: 1 })), undefined);
    assert.equal(textOcclusionIssue(hit({ probed: 3, occluded: 2 })), undefined);
  });

  it("caps at 8 issues", () => {
    const hits: TextOcclusionHit[] = [];
    for (let i = 0; i < 10; i++) {
      hits.push(hit({ where: `Heading ${i}` }));
    }
    const issues = issuesFromHits(hits);
    assert.equal(issues.length, MAX_HITS);
  });
});
