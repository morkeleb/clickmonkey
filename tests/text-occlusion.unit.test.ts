import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CANDIDATE_SELECTOR,
  MAX_HITS,
  MAX_RECTS,
  clipWhere,
  coverIsRestack,
  describeCover,
  expectedOverlay,
  isUtilityCoverClass,
  nodeClassesAreUtilities,
  stripTailwindVariants,
  isStickyChromeCover,
  isStepperStep,
  isTabChrome,
  isUnselectedTabpanel,
  hitPaints,
  issuesFromHits,
  occlusionConfidence,
  overlayKindFromClass,
  overlayKindFromNode,
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

  it("treats Tailwind display and shrink classes as unnamed covers", () => {
    assert.equal(isUtilityCoverClass("block"), true);
    assert.equal(isUtilityCoverClass("flex"), true);
    assert.equal(isUtilityCoverClass("absolute"), true);
    assert.equal(isUtilityCoverClass("min-w-0"), true);
    assert.equal(isUtilityCoverClass("md:min-w-0"), true);
    assert.equal(isUtilityCoverClass("gap-2"), true);
    assert.equal(isUtilityCoverClass("font-medium"), true);
    assert.equal(isUtilityCoverClass("text-sm"), true);
    assert.equal(isUtilityCoverClass("rounded-full"), true);
    assert.equal(stripTailwindVariants("after:absolute"), "absolute");
    assert.equal(isUtilityCoverClass("after:absolute"), true);
    assert.equal(isUtilityCoverClass("before:inset-0"), true);
    assert.equal(isUtilityCoverClass("hover:after:absolute"), true);
    assert.equal(isUtilityCoverClass("badge"), false);
    assert.equal(isUtilityCoverClass("chip"), false);
    assert.equal(nodeClassesAreUtilities("flex min-w-0 gap-2"), true);
    assert.equal(nodeClassesAreUtilities("min-w-0 badge"), false);
  });

  it("skips a covering node that restacks the same cell labels", () => {
    assert.equal(coverIsRestack("Crm Oauth2 date", "Crm · Oauth2 · date"), true);
    assert.equal(coverIsRestack("Oauth2", "Crm · Oauth2 · date"), true);
    assert.equal(coverIsRestack("NEW", "Quarterly revenue"), false);
    assert.equal(coverIsRestack("", "Crm · Oauth2 · date"), false);
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

  it("classifies menu-surface / mdc-menu / listbox-without-role as overlays", () => {
    assert.equal(overlayKindFromClass("fvs-menu-surface-base"), "menu");
    assert.equal(overlayKindFromClass("mdc-menu"), "menu");
    assert.equal(overlayKindFromClass("mdc-list listbox"), "listbox");
    assert.equal(overlayKindFromClass("hero-grid"), undefined);
    assert.equal(overlayKindFromNode({ comboboxPopup: true }), "listbox");
    assert.equal(overlayKindFromNode({ role: "listbox" }), "listbox");
    assert.equal(
      skipOpenOverlay({
        textOverlayId: -1,
        coverOverlay: overlayKindFromClass("fvs-menu-surface-base"),
        coverOverlayId: 0,
      }),
      true,
    );
  });

  it("skips tab chrome and stepper steps, not table/copy tokens", () => {
    assert.equal(isTabChrome({ role: "tab" }), true);
    assert.equal(isTabChrome({ role: "tablist" }), true);
    assert.equal(isTabChrome({ className: "fvs-tab" }), true);
    assert.equal(isTabChrome({ className: "table" }), false);
    assert.equal(isTabChrome({ className: "sortable-table" }), false);
    assert.equal(isTabChrome({ role: "tabpanel" }), false);
    assert.equal(isStepperStep({ className: "step" }), true);
    assert.equal(isStepperStep({ testid: "stepper-step" }), true);
    assert.equal(isStepperStep({ className: "mdc-step" }), true);
    assert.equal(isStepperStep({ className: "badge" }), false);
    assert.equal(isUnselectedTabpanel({ hidden: true }), true);
    assert.equal(isUnselectedTabpanel({ ariaHidden: true }), true);
    assert.equal(isUnselectedTabpanel({ tabSelected: false }), true);
    assert.equal(isUnselectedTabpanel({ tabSelected: true }), false);
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
