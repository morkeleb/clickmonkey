import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HIGH_CHROME_PX,
  MIN_CHROME_PX,
  needsScrollPadding,
  parseScrollPadPx,
  scrollPaddingConfidence,
  scrollPaddingIssue,
  scrollPaddingMessage,
  type ScrollPaddingHit,
} from "../src/surveyor/scroll-padding.js";

function hit(partial: Partial<ScrollPaddingHit> = {}): ScrollPaddingHit {
  return {
    headerPx: 80,
    padPx: 0,
    where: 'header[data-testid="app-header"]',
    ...partial,
  };
}

describe("needsScrollPadding", () => {
  it("flags an 80px bar with no pad, not a matching pad, and skips short bars", () => {
    assert.equal(MIN_CHROME_PX, 32);
    assert.equal(HIGH_CHROME_PX, 40);
    assert.equal(needsScrollPadding(80, 0), true);
    assert.equal(needsScrollPadding(80, 80), false);
    assert.equal(needsScrollPadding(80, 79), true);
    assert.equal(needsScrollPadding(24, 0), false);
    assert.equal(needsScrollPadding(31, 0), false);
    assert.equal(needsScrollPadding(32, 0), true);
    assert.equal(needsScrollPadding(Number.NaN, 0), false);
    assert.equal(needsScrollPadding(80, Number.NaN), false);
  });
});

describe("parseScrollPadPx", () => {
  it("treats auto/normal/empty as 0", () => {
    assert.equal(parseScrollPadPx("80px"), 80);
    assert.equal(parseScrollPadPx("0px"), 0);
    assert.equal(parseScrollPadPx("auto"), 0);
    assert.equal(parseScrollPadPx("normal"), 0);
    assert.equal(parseScrollPadPx(""), 0);
    assert.equal(parseScrollPadPx(undefined), 0);
  });
});

describe("scrollPaddingIssue", () => {
  it("flags a 0-pad 80px header as a high-confidence warning", () => {
    const issue = scrollPaddingIssue(hit());
    assert.ok(issue);
    assert.equal(issue.source, "visual");
    assert.equal(issue.rule, "scrollPadding");
    assert.equal(issue.severity, "warning");
    assert.equal(issue.confidence, "high");
    assert.equal(issue.count, 1);
    assert.equal(issue.where, 'header[data-testid="app-header"]');
    assert.equal(issue.message, "Sticky header is 80px but scroll-padding-top is 0px");
    assert.equal("via" in issue, false);
  });

  it("uses medium when pad is positive but still short, and skips a matching pad", () => {
    const short = scrollPaddingIssue(hit({ padPx: 79 }));
    assert.ok(short);
    assert.equal(short.confidence, "medium");
    assert.equal(short.message, "Sticky header is 80px but scroll-padding-top is 79px");
    assert.equal(scrollPaddingIssue(hit({ padPx: 80 })), undefined);
    assert.equal(scrollPaddingIssue(hit({ headerPx: 24 })), undefined);
    assert.equal(scrollPaddingConfidence(80, 0), "high");
    assert.equal(scrollPaddingConfidence(80, 79), "medium");
    assert.equal(scrollPaddingMessage(80, 0), "Sticky header is 80px but scroll-padding-top is 0px");
  });

  it("skips incomplete hits", () => {
    assert.equal(scrollPaddingIssue(hit({ where: "  " })), undefined);
    assert.equal(scrollPaddingIssue(hit({ headerPx: Number.NaN })), undefined);
    assert.equal(scrollPaddingIssue(undefined), undefined);
  });
});
