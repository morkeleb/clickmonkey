import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BROKEN_MAX,
  brokenFilename,
  brokenIssuesFrom,
  brokenLayoutIssue,
  type BrokenImageRecord,
} from "../src/surveyor/broken.js";

function rec(partial: Partial<BrokenImageRecord> = {}): BrokenImageRecord {
  return {
    complete: true,
    naturalWidth: 0,
    src: "missing-file.png",
    alt: "Logo",
    testid: "",
    width: 64,
    height: 64,
    display: "inline",
    visible: true,
    ariaHidden: false,
    inMain: true,
    ...partial,
  };
}

describe("brokenLayoutIssue", () => {
  it("flags a failed decode in main as high", () => {
    const issue = brokenLayoutIssue(rec());
    assert.ok(issue);
    assert.equal(issue.source, "visual");
    assert.equal(issue.rule, "broken");
    assert.equal(issue.severity, "error");
    assert.equal(issue.confidence, "high");
    assert.equal(issue.count, 1);
    assert.equal(issue.where, "Logo");
    assert.equal(issue.message, "Image failed to decode (Logo)");
  });

  it("is high when the hole is ≥32px even outside main", () => {
    const issue = brokenLayoutIssue(rec({ inMain: false, alt: "", testid: "hero" }));
    assert.ok(issue);
    assert.equal(issue.confidence, "high");
    assert.equal(issue.where, "hero");
  });

  it("is medium for a tiny decorative image outside main", () => {
    const issue = brokenLayoutIssue(
      rec({ inMain: false, alt: "", testid: "footer-dot", width: 12, height: 12 }),
    );
    assert.ok(issue);
    assert.equal(issue.confidence, "medium");
    assert.equal(issue.where, "footer-dot");
    assert.equal(issue.message, "Image failed to decode");
  });

  it("uses the filename when there is no alt or testid", () => {
    const issue = brokenLayoutIssue(rec({ alt: "", testid: "", src: "/assets/missing-file.png?v=1" }));
    assert.equal(issue?.where, "missing-file.png");
  });

  it("skips a decoded image", () => {
    assert.equal(brokenLayoutIssue(rec({ naturalWidth: 1 })), undefined);
  });

  it("skips images still loading", () => {
    assert.equal(brokenLayoutIssue(rec({ complete: false })), undefined);
  });

  it("skips empty src", () => {
    assert.equal(brokenLayoutIssue(rec({ src: "" })), undefined);
    assert.equal(brokenLayoutIssue(rec({ src: "   " })), undefined);
  });

  it("skips data: placeholders", () => {
    assert.equal(
      brokenLayoutIssue(rec({ src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" })),
      undefined,
    );
  });

  it("skips hidden, 0×0, and aria-hidden images", () => {
    assert.equal(brokenLayoutIssue(rec({ visible: false })), undefined);
    assert.equal(brokenLayoutIssue(rec({ display: "none" })), undefined);
    assert.equal(brokenLayoutIssue(rec({ width: 0, height: 0 })), undefined);
    assert.equal(brokenLayoutIssue(rec({ ariaHidden: true })), undefined);
  });
});

describe("brokenIssuesFrom", () => {
  it("caps at 8 unique hits", () => {
    const records = Array.from({ length: 12 }, (_, i) => rec({ alt: `Hole ${i}`, src: `missing-${i}.png` }));
    const issues = brokenIssuesFrom(records);
    assert.equal(issues.length, BROKEN_MAX);
  });
});

describe("brokenFilename", () => {
  it("takes the basename and ignores data: URLs", () => {
    assert.equal(brokenFilename("missing-file.png"), "missing-file.png");
    assert.equal(brokenFilename("data:image/png;base64,aaa"), "");
    assert.equal(brokenFilename(""), "");
  });
});
