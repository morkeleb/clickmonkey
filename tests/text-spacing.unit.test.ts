import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Page } from "playwright";
import type { QualityIssue } from "../src/schema/quality.js";
import {
  STYLE_ID,
  TEXT_SPACING_CAP,
  TEXT_SPACING_CSS,
  scanTextSpacing,
  tagTextSpacingIssue,
  takeTextSpacingHits,
  textSpacingMessage,
} from "../src/surveyor/text-spacing.js";

function issue(partial: Partial<QualityIssue> = {}): QualityIssue {
  return {
    source: "visual",
    rule: "clip",
    severity: "error",
    message: "Button label is cut mid-word without an ellipsis",
    count: 1,
    confidence: "high",
    where: "Project archive",
    ...partial,
  };
}

describe("text spacing CSS", () => {
  it("matches WCAG 1.4.12 on html plus paragraph spacing", () => {
    assert.equal(STYLE_ID, "cm-text-spacing");
    assert.match(TEXT_SPACING_CSS, /html\.cm-text-spacing,\s*html\.cm-text-spacing \*/);
    assert.match(TEXT_SPACING_CSS, /line-height:\s*1\.5\s*!important/);
    assert.match(TEXT_SPACING_CSS, /letter-spacing:\s*0\.12em\s*!important/);
    assert.match(TEXT_SPACING_CSS, /word-spacing:\s*0\.16em\s*!important/);
    assert.match(TEXT_SPACING_CSS, /html\.cm-text-spacing p \{ margin-bottom:\s*2em\s*!important/);
    assert.equal(TEXT_SPACING_CAP, 8);
  });
});

describe("tagTextSpacingIssue", () => {
  it("remaps clip/overflow to textSpacing and prefixes the message", () => {
    const tagged = tagTextSpacingIssue(issue());
    assert.equal(tagged.rule, "textSpacing");
    assert.equal(tagged.source, "visual");
    assert.equal(tagged.severity, "error");
    assert.equal(tagged.confidence, "high");
    assert.equal(tagged.count, 1);
    assert.equal(tagged.where, "Project archive");
    assert.equal(
      tagged.message,
      "with text spacing: Button label is cut mid-word without an ellipsis",
    );
    assert.equal("via" in tagged, false);
  });

  it("keeps a message that already names text spacing or 1.4.12", () => {
    assert.equal(
      textSpacingMessage("with text spacing: Page is 44px wider than the viewport"),
      "with text spacing: Page is 44px wider than the viewport",
    );
    assert.equal(
      tagTextSpacingIssue(issue({ message: "WCAG 1.4.12: heading clips" })).message,
      "WCAG 1.4.12: heading clips",
    );
  });

  it("drops via so layout can stamp it later", () => {
    const tagged = tagTextSpacingIssue(issue({ via: "dom" }));
    assert.equal(tagged.via, undefined);
    assert.equal("via" in tagged, false);
  });
});

describe("takeTextSpacingHits", () => {
  it("caps at 8 and keeps high confidence first", () => {
    const many = [
      ...Array.from({ length: 5 }, (_, i) => issue({ confidence: "medium", where: `m${i}` })),
      ...Array.from({ length: 5 }, (_, i) => issue({ confidence: "high", where: `h${i}` })),
    ];
    const top = takeTextSpacingHits(many);
    assert.equal(top.length, TEXT_SPACING_CAP);
    assert.ok(top.slice(0, 5).every((i) => i.confidence === "high"));
    assert.ok(top.slice(5).every((i) => i.confidence === "medium"));
  });
});

describe("scanTextSpacing restore", () => {
  it("removes the stylesheet when inject throws", async () => {
    const calls: string[] = [];
    const page = {
      async evaluate(src: string) {
        if (src.includes("classList.add")) {
          calls.push("inject");
          throw new Error("inject failed");
        }
        if (src.includes("classList.remove")) {
          calls.push("restore");
          return;
        }
        return [];
      },
    };
    await assert.rejects(() => scanTextSpacing(page as unknown as Page), /inject failed/);
    assert.deepEqual(calls, ["inject", "restore"]);
  });

  it("restores after a successful collect", async () => {
    const calls: string[] = [];
    const page = {
      async evaluate(src: string) {
        if (src.includes("classList.add")) {
          calls.push("inject");
          return;
        }
        if (src.includes("classList.remove")) {
          calls.push("restore");
          return;
        }
        calls.push("collect");
        return [];
      },
    };
    const issues = await scanTextSpacing(page as unknown as Page);
    assert.deepEqual(issues, []);
    assert.deepEqual(calls, ["inject", "collect", "collect", "restore"]);
  });
});
