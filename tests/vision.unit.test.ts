import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ChatClient, ChatRequest } from "../src/brains/chat.js";
import {
  dropExpectedOverlayVisual,
  dropPayloadContentVisual,
  examineScreenshot,
  hashPngFile,
  parseVisualReply,
  VISUAL_BLURB_PROMPT,
  VISUAL_PROMPT,
} from "../src/surveyor/vision.js";

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
        issues: [{ rule: "overlap", severity: "error", message: "Two cards overlap" }],
        sight: "A login form with email and password",
      }),
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.persist, true);
    assert.deepEqual(out.issues, [
      {
        source: "visual",
        rule: "overlap",
        severity: "error",
        message: "Two cards overlap",
        count: 1,
        confidence: "medium",
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

  it("tells the model leftover nasty payloads are content, not a rendering defect", () => {
    assert.match(VISUAL_PROMPT, /XSS payload text/);
    assert.match(VISUAL_PROMPT, /you MUST file clip\/scanline\/overflow/);
    assert.match(VISUAL_PROMPT, /column wall that shears a word/);
    assert.match(VISUAL_PROMPT, /Must-check: every visible table/);
  });

  it("tells the model an open dropdown covering the page is expected stacking", () => {
    assert.match(VISUAL_PROMPT, /expected stacking/);
    assert.match(VISUAL_PROMPT, /open dropdown/);
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
{ "issues": [{ "rule": "clip", "severity": "warning", "message": "Text clipped" }], "sight": "header bar" }
\`\`\``);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.issues.length, 1);
    assert.equal(out.issues[0]?.rule, "clip");
    assert.equal(out.issues[0]?.message, "Text clipped");
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
          { rule: "overlap", severity: "error" },
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
            rule: "overlap",
            severity: "error",
            confidence: "high",
            where: "filter chip on table header",
            message: "Chip border crosses the header",
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

  it("accepts scanline as a rule", () => {
    const out = parseVisualReply(
      JSON.stringify({
        issues: [
          {
            rule: "scanline",
            severity: "warning",
            confidence: "high",
            where: "invoice list titles",
            message: "Row titles do not share a left edge",
          },
        ],
      }),
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.issues[0]?.rule, "scanline");
  });

  it("drops a report when it quotes a --nasty catalog payload or paraphrases XSS/SQLi, not the word malicious", () => {
    assert.equal(
      dropPayloadContentVisual({
        rule: "broken",
        message: "Customer list looks broken; cells contain <script>alert(1)</script>",
      }),
      true,
    );
    assert.equal(
      dropPayloadContentVisual({
        rule: "broken",
        message: "Input field displays XSS payload text instead of placeholder or error state.",
        where: "Tenant Id input field",
      }),
      true,
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
        rule: "broken",
        message: "Input fields contain malformed SVG code instead of text",
        where: "Billing Split",
      }),
      true,
    );
    assert.equal(
      dropPayloadContentVisual({
        rule: "broken",
        message: `Contains malformed text: '"<svg onload=alert(1)>"' instead of expected attorney name.`,
        where: "Originating Split * Attorney input field",
      }),
      true,
    );
    assert.equal(
      dropPayloadContentVisual({
        rule: "overflow",
        message: "XSS payload text overflows the Tenant Id field",
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
            rule: "broken",
            severity: "warning",
            confidence: "high",
            message: "Listing looks malicious and broken",
          },
          {
            rule: "overflow",
            severity: "error",
            confidence: "high",
            message: "Overlong name overflows the table cell",
          },
        ],
      }),
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.issues.length, 2);
    assert.deepEqual(
      out.issues.map((i) => i.rule),
      ["broken", "overflow"],
    );
  });

  it("drops an open dropdown covering the page, keeps a clipped menu or colliding cards", () => {
    assert.equal(
      dropExpectedOverlayVisual({
        rule: "overlap",
        message: "Dropdown menu overlaps with the 'No matching records' message, visually obscuring part of the text.",
        where: "Readiness dropdown menu and 'No matching records' message",
      }),
      true,
    );
    assert.equal(
      dropExpectedOverlayVisual({
        rule: "overlap",
        message: "Two cards overlap on the dashboard",
      }),
      false,
    );
    assert.equal(
      dropExpectedOverlayVisual({
        rule: "clip",
        message: "Dropdown menu is cut off by the viewport",
      }),
      false,
    );
    const out = parseVisualReply(
      JSON.stringify({
        issues: [
          {
            rule: "overlap",
            severity: "warning",
            confidence: "medium",
            where: "Readiness dropdown menu and 'No matching records' message",
            message: "Dropdown menu overlaps with the 'No matching records' message",
          },
          {
            rule: "overlap",
            severity: "error",
            confidence: "high",
            message: "Two cards overlap",
          },
        ],
      }),
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.issues.length, 1);
    assert.equal(out.issues[0]?.message, "Two cards overlap");
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
