import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ChatClient, ChatRequest } from "../src/brains/chat.js";
import {
  dropPayloadContentVisual,
  examineScreenshot,
  hashPngFile,
  parseVisualReply,
  shouldSkipVision,
  visionPass,
  VISUAL_BLURB_PROMPT,
  VISUAL_PROMPT,
} from "../src/surveyor/vision.js";
import { FOG_FRESH_MS, FOG_OLD_MS } from "../src/schema/fog.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function withTempPng(fn: (pngPath: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "cm-vision-"));
  const pngPath = join(dir, "shot.png");
  writeFileSync(pngPath, PNG);
  return fn(pngPath).finally(() => rmSync(dir, { recursive: true, force: true }));
}

describe("parseVisualReply", () => {
  it("reads issues and sight from JSON", () => {
    const out = parseVisualReply(
      JSON.stringify({
        issues: [{ rule: "contrast", severity: "error", message: "Hint text is unreadable" }],
        sight: "A login form with email and password",
      }),
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.persist, true);
    assert.deepEqual(out.issues, [
      {
        source: "visual",
        rule: "contrast",
        severity: "error",
        message: "Hint text is unreadable",
        count: 1,
        confidence: "medium",
        via: "vlm",
      },
    ]);
    assert.equal(out.sight, "A login form with email and password");
  });

  it("asks for screen type, main pane, and a primary action — not chrome or paint", () => {
    assert.match(VISUAL_BLURB_PROMPT, /screen type/);
    assert.match(VISUAL_BLURB_PROMPT, /MAIN pane/);
    assert.match(VISUAL_BLURB_PROMPT, /primary action/);
    assert.match(VISUAL_BLURB_PROMPT, /sidebar or top nav/);
    assert.match(VISUAL_BLURB_PROMPT, /Do not: colors/);
    assert.match(VISUAL_BLURB_PROMPT, /not a loading screen/);
    assert.match(VISUAL_BLURB_PROMPT, /mapped widgets lists fields or actions/i);
  });

  it("asks for empty-vs-broken and DOM-measured grounding, not a geometry hunt", () => {
    assert.match(VISUAL_PROMPT, /Ignore leftover --nasty walker fills/);
    assert.match(VISUAL_PROMPT, /<script>alert\(1\)<\/script>/);
    assert.match(VISUAL_PROMPT, /OR '1'='1/);
    assert.match(VISUAL_PROMPT, /empty-vs-broken/);
    assert.match(VISUAL_PROMPT, /Do not re-file those rules/);
    assert.match(VISUAL_PROMPT, /DOM already measured overflow, clip, scanline, sparse, overlap/);
    assert.match(VISUAL_PROMPT, /focus-obscured, missing focus rings, text occlusion/);
    assert.match(VISUAL_PROMPT, /dead in-page hashes/);
    assert.match(VISUAL_PROMPT, /pointer-events:none/);
    assert.match(VISUAL_PROMPT, /visible error\/toast chrome/);
    assert.match(VISUAL_PROMPT, /mapped widgets listed below that are missing from the pixels/);
    assert.match(VISUAL_PROMPT, /trailing calendar\/search icon/);
    assert.match(VISUAL_PROMPT, /canvas or icon-font holes/);
    assert.match(VISUAL_PROMPT, /ellipsis/);
    assert.match(VISUAL_PROMPT, /mojibake|tofu/);
    assert.match(VISUAL_PROMPT, /chart/);
    assert.match(VISUAL_PROMPT, /lorem/);
    assert.match(VISUAL_PROMPT, /unreadable in this screenshot/);
    assert.match(VISUAL_PROMPT, /Not font-family/);
    assert.doesNotMatch(VISUAL_PROMPT, /Must-check/);
    assert.doesNotMatch(VISUAL_PROMPT, /column wall shears a word/);
    assert.doesNotMatch(VISUAL_PROMPT, /targetSize:/);
    assert.doesNotMatch(VISUAL_PROMPT, /brand or typography taste/);
  });

  it("reads a page blurb from the same JSON", () => {
    const out = parseVisualReply(
      JSON.stringify({
        issues: [],
        sight: "KPI cards and a table",
        blurb: "Customers dashboard with filters and an Add customer button.",
      }),
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.blurb, "Customers dashboard with filters and an Add customer button.");
  });

  it("accepts fenced JSON with extra text", () => {
    const out = parseVisualReply(`\`\`\`json
{ "issues": [{ "rule": "contrast", "severity": "warning", "message": "Hint text is unreadable" }], "sight": "header bar" }
\`\`\``);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.issues.length, 1);
    assert.equal(out.issues[0]?.rule, "contrast");
    assert.equal(out.issues[0]?.message, "Hint text is unreadable");
    assert.equal(out.issues[0]?.via, "vlm");
    assert.equal(out.sight, "header bar");
  });

  it("returns ok false for junk and does not throw", () => {
    assert.doesNotThrow(() => parseVisualReply("??? not json {"));
    const out = parseVisualReply("totally not json");
    assert.equal(out.ok, false);
  });

  it("does not treat other JSON as a clean scan", () => {
    const out = parseVisualReply(JSON.stringify({ line: "click page.go" }));
    assert.equal(out.ok, false);
  });

  it("keeps sight-only replies without persisting extras", () => {
    const out = parseVisualReply(JSON.stringify({ sight: "a settings form" }));
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.persist, false);
    assert.equal(out.sight, "a settings form");
    assert.deepEqual(out.issues, []);
  });

  it("maps unknown rules to other", () => {
    const out = parseVisualReply(
      JSON.stringify({
        issues: [
          { rule: "funky", severity: "error", message: "odd stacking" },
          { rule: "align", severity: "error" },
        ],
      }),
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.issues.length, 1);
    assert.equal(out.issues[0]?.rule, "other");
    assert.equal(out.issues[0]?.source, "visual");
    assert.equal(out.issues[0]?.severity, "error");
    assert.equal(out.issues[0]?.message, "odd stacking");
    assert.equal(out.issues[0]?.confidence, "medium");
  });

  it("keeps high/medium with where and drops low confidence", () => {
    const out = parseVisualReply(
      JSON.stringify({
        issues: [
          {
            rule: "align",
            severity: "error",
            confidence: "high",
            where: "filter chip on table header",
            message: "Chip is stepped vs its siblings",
          },
          {
            rule: "align",
            severity: "warning",
            confidence: "low",
            message: "maybe a pixel off",
          },
        ],
      }),
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.issues.length, 1);
    assert.equal(out.issues[0]?.confidence, "high");
    assert.equal(out.issues[0]?.where, "filter chip on table header");
  });

  it("drops a clip issue from the model and keeps contrast", () => {
    const out = parseVisualReply(
      JSON.stringify({
        issues: [
          {
            rule: "clip",
            severity: "warning",
            confidence: "high",
            where: "Vendor column",
            message: "Vendor column shears a word",
          },
          {
            rule: "contrast",
            severity: "warning",
            confidence: "high",
            message: "Hint text is unreadable",
          },
        ],
      }),
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.issues.length, 1);
    assert.equal(out.issues[0]?.rule, "contrast");
    assert.equal(out.issues[0]?.via, "vlm");
  });

  it("drops capitalized DOM-owned rules and other that restates clip", () => {
    const out = parseVisualReply(
      JSON.stringify({
        issues: [
          { rule: "CLIP", severity: "error", confidence: "high", message: "Text clipped" },
          { rule: "other", severity: "warning", confidence: "high", message: "Label is truncated by overflow" },
          { rule: "contrast", severity: "warning", confidence: "high", message: "Hint is faint" },
        ],
      }),
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.issues.length, 1);
    assert.equal(out.issues[0]?.rule, "contrast");
  });

  it("keeps pixel-only other: abnormal ellipsis, leftover lorem, and chart labels", () => {
    const out = parseVisualReply(
      JSON.stringify({
        issues: [
          {
            rule: "other",
            severity: "warning",
            confidence: "high",
            message: "Title uses an ellipsis even though the column still has empty space",
          },
          {
            rule: "other",
            severity: "warning",
            confidence: "high",
            message: "Main pane still shows lorem ipsum placeholder copy",
          },
          {
            rule: "other",
            severity: "warning",
            confidence: "high",
            message: "Chart axis labels are cut off on the canvas",
          },
          {
            rule: "other",
            severity: "warning",
            confidence: "high",
            message: "Label is truncated by overflow",
          },
        ],
      }),
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(
      out.issues.map((i) => i.message),
      [
        "Title uses an ellipsis even though the column still has empty space",
        "Main pane still shows lorem ipsum placeholder copy",
        "Chart axis labels are cut off on the canvas",
      ],
    );
  });

  it("keeps pixel-only other: icon collision and toast chrome", () => {
    const out = parseVisualReply(
      JSON.stringify({
        issues: [
          {
            rule: "other",
            severity: "warning",
            confidence: "high",
            where: "date field",
            message: "Date value colliding with the calendar icon",
          },
          {
            rule: "other",
            severity: "warning",
            confidence: "high",
            where: "top-right",
            message: "Toast covering the save button",
          },
        ],
      }),
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.issues.length, 2);
    assert.deepEqual(
      out.issues.map((i) => i.message),
      ["Date value colliding with the calendar icon", "Toast covering the save button"],
    );
  });

  it("drops focusObscured, textOcclusion, and fontSize from the model — DOM owns those", () => {
    const out = parseVisualReply(
      JSON.stringify({
        issues: [
          { rule: "focusObscured", severity: "error", confidence: "high", message: "Focus ring is under a modal" },
          { rule: "focusVisible", severity: "warning", confidence: "high", message: "Save has no focus ring" },
          { rule: "textOcclusion", severity: "warning", confidence: "high", message: "Value runs under a search icon" },
          { rule: "fontSize", severity: "warning", confidence: "medium", message: "Helper text is too small to read" },
          { rule: "textSpacing", severity: "warning", confidence: "high", message: "Chip clips after letter-spacing" },
          { rule: "contrast", severity: "warning", confidence: "high", message: "Hint text is unreadable" },
        ],
      }),
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(
      out.issues.map((i) => i.rule),
      ["contrast"],
    );
  });

  it("drops a report only when it quotes a --nasty catalog string, not a paraphrase", () => {
    assert.equal(
      dropPayloadContentVisual({
        rule: "broken",
        message: "Customer list looks broken; cells contain <script>alert(1)</script>",
      }),
      true,
    );
    assert.equal(
      dropPayloadContentVisual({
        rule: "clip",
        message: "Field value contains SQL injection junk (' OR '1'='1') and is clipped mid-word",
        where: "Legal Name field",
      }),
      true,
    );
    assert.equal(
      dropPayloadContentVisual({
        rule: "broken",
        message: "Input field displays XSS payload text instead of placeholder or error state.",
        where: "Tenant Id input field",
      }),
      false,
    );
    assert.equal(
      dropPayloadContentVisual({
        rule: "broken",
        message: "Listing looks malicious and broken",
      }),
      false,
    );
    assert.equal(
      dropPayloadContentVisual({
        rule: "clip",
        message: "Field contains SQL injection test string that is not clipped but visually inappropriate",
        where: "Legal Name field",
      }),
      false,
    );
    assert.equal(
      dropPayloadContentVisual({
        rule: "clip",
        message: "Vendor column shears 'Expert Witness Servic' mid-word with no ellipsis",
        where: "Ready-to-Pay table",
      }),
      false,
    );
    assert.equal(
      dropPayloadContentVisual({
        rule: "clip",
        message: "Leftover XSS in search; Vendor column shears Expert Witness Servic",
        where: "Ready-to-Pay table",
      }),
      false,
    );
    const out = parseVisualReply(
      JSON.stringify({
        issues: [
          {
            rule: "broken",
            severity: "warning",
            confidence: "high",
            message: "Table rows show XSS payload text like <script>alert(1)</script>",
          },
          {
            rule: "other",
            severity: "warning",
            confidence: "high",
            message: "Listing looks malicious and broken",
          },
          {
            rule: "other",
            severity: "error",
            confidence: "high",
            message: "Save toast never appears after submit",
          },
        ],
      }),
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.issues.length, 2);
    assert.deepEqual(
      out.issues.map((i) => i.rule),
      ["other", "other"],
    );
  });

  it("drops DOM-owned geometry rules even when the phrasing is a real pixel defect", () => {
    const out = parseVisualReply(
      JSON.stringify({
        issues: [
          {
            rule: "clip",
            severity: "warning",
            confidence: "high",
            message: "Vendor column shears 'Expert Witness Servic' mid-word",
            where: "vouchers table",
          },
          {
            rule: "scanline",
            severity: "warning",
            confidence: "high",
            message: "Row titles do not share a left edge",
            where: "invoice list titles",
          },
          {
            rule: "overlap",
            severity: "warning",
            confidence: "medium",
            message: "Badge covers the title",
          },
          {
            rule: "align",
            severity: "warning",
            confidence: "high",
            message: "Primary buttons in the toolbar are stepped",
          },
        ],
      }),
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.issues.length, 1);
    assert.equal(out.issues[0]?.rule, "align");
  });
});

describe("shouldSkipVision", () => {
  it("skips when the page is fog-fresh and unchanged", () => {
    assert.equal(shouldSkipVision({ staleMs: 0, unchanged: true }), true);
    assert.equal(shouldSkipVision({ staleMs: FOG_FRESH_MS, unchanged: true }), true);
  });

  it("still asks when fog is stale or the page changed", () => {
    assert.equal(shouldSkipVision({ staleMs: FOG_FRESH_MS + 1, unchanged: true }), false);
    assert.equal(shouldSkipVision({ staleMs: FOG_OLD_MS, unchanged: true }), false);
    assert.equal(shouldSkipVision({ staleMs: 0, unchanged: false }), false);
  });
});

describe("visionPass", () => {
  it("always asks when a caption is still needed", () => {
    assert.equal(
      visionPass({
        needBlurb: true,
        needSight: false,
        pngUnchanged: true,
        staleMs: 0,
        triedThisRun: true,
      }),
      "call",
    );
  });

  it("asks for Sight on the first land even when extras would skip", () => {
    assert.equal(
      visionPass({
        needBlurb: false,
        needSight: true,
        pngUnchanged: true,
        staleMs: 0,
        triedThisRun: false,
      }),
      "call",
    );
  });

  it("skips extras when fog is fresh, Sight exists, and the PNG matches", () => {
    assert.equal(
      visionPass({
        needBlurb: false,
        needSight: false,
        pngUnchanged: true,
        staleMs: 0,
        triedThisRun: false,
      }),
      "skip",
    );
  });

  it("asks on a stale tile even when the PNG matches", () => {
    assert.equal(
      visionPass({
        needBlurb: false,
        needSight: false,
        pngUnchanged: true,
        staleMs: FOG_OLD_MS,
        triedThisRun: false,
      }),
      "call",
    );
  });

  it("does not re-ask the same PNG this run", () => {
    assert.equal(
      visionPass({
        needBlurb: false,
        needSight: false,
        pngUnchanged: true,
        staleMs: FOG_OLD_MS,
        triedThisRun: true,
      }),
      "skip",
    );
  });
});

describe("examineScreenshot", () => {
  it("skips the model when lastHash matches the PNG hash", async () => {
    await withTempPng(async (pngPath) => {
      let called = 0;
      const chat: ChatClient = async () => {
        called += 1;
        return "{}";
      };
      const lastHash = hashPngFile(pngPath);
      const scan = await examineScreenshot({
        chat,
        baseUrl: "http://127.0.0.1:9",
        model: "vlm",
        pngPath,
        lastHash,
      });
      assert.equal(scan.status, "skip");
      assert.equal(called, 0);
    });
  });

  it("returns fail when chat throws", async () => {
    await withTempPng(async (pngPath) => {
      const chat: ChatClient = async () => {
        throw new Error("down");
      };
      const scan = await examineScreenshot({
        chat,
        baseUrl: "http://127.0.0.1:9",
        model: "vlm",
        pngPath,
      });
      assert.equal(scan.status, "fail");
    });
  });

  it("sends an image_url part on the user message", async () => {
    await withTempPng(async (pngPath) => {
      let seen: ChatRequest | undefined;
      const chat: ChatClient = async (req) => {
        seen = req;
        return JSON.stringify({
          issues: [{ rule: "align", severity: "warning", message: "off by a few pixels" }],
          sight: "settings form",
        });
      };
      const jpeg = Buffer.from("jpeg-bytes");
      const scan = await examineScreenshot({
        chat,
        baseUrl: "http://example.test/v1",
        model: "vlm",
        apiKey: "sk",
        pngPath,
        jpeg,
      });
      assert.ok(seen);
      assert.equal(seen.baseUrl, "http://example.test/v1");
      assert.equal(seen.model, "vlm");
      assert.equal(seen.apiKey, "sk");
      const user = seen.messages.find((m) => m.role === "user");
      assert.ok(user && Array.isArray(user.content));
      const parts = user.content;
      assert.equal(parts[0]?.type, "image_url");
      assert.ok(parts.some((p) => p.type === "text" && p.text.length > 0));
      const image = parts.find((p) => p.type === "image_url");
      assert.ok(image && image.type === "image_url");
      assert.equal(image.image_url.url, `data:image/jpeg;base64,${jpeg.toString("base64")}`);
      assert.equal(scan.status, "ok");
      if (scan.status !== "ok") return;
      assert.equal(scan.persist, true);
      assert.equal(scan.hash, hashPngFile(pngPath));
      assert.equal(scan.sight, "settings form");
      assert.equal(scan.issues[0]?.rule, "align");
      assert.equal(scan.issues[0]?.via, "vlm");
    });
  });

  it("appends already-measured hits so the model does not re-file them", async () => {
    await withTempPng(async (pngPath) => {
      let text = "";
      const chat: ChatClient = async (req) => {
        const user = req.messages.find((m) => m.role === "user");
        if (user && Array.isArray(user.content)) {
          const part = user.content.find((p) => p.type === "text");
          if (part && part.type === "text") text = part.text;
        }
        return JSON.stringify({
          issues: [{ rule: "clip", severity: "warning", message: "Vendor column shears a word" }],
          sight: "table",
          blurb: "Vouchers table with a clip in the vendor column.",
        });
      };
      const scan = await examineScreenshot({
        chat,
        baseUrl: "http://example.test/v1",
        model: "vlm",
        pngPath,
        measured: [{ rule: "clip", message: "Vendor column shears a word", where: "Vendor column" }],
      });
      assert.match(text, /Already measured \(do not repeat\):/);
      assert.match(text, /- clip: Vendor column/);
      assert.equal(scan.status, "ok");
      if (scan.status !== "ok") return;
      assert.equal(scan.issues.length, 0);
    });
  });

  it("returns fail when the model reply is not JSON", async () => {
    await withTempPng(async (pngPath) => {
      const chat: ChatClient = async () => "not json at all";
      const scan = await examineScreenshot({
        chat,
        baseUrl: "http://127.0.0.1:9",
        model: "vlm",
        pngPath,
      });
      assert.equal(scan.status, "fail");
    });
  });
});
