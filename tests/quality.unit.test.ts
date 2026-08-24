import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  lastVisualHash,
  loadCombinedQuality,
  loadQualityReport,
  persistQualityRuntime,
  persistQualitySnapshot,
  persistQualityVisual,
  qualityReportPath,
} from "../src/persist/quality.js";
import { renderFindingsReport } from "../src/reports/findings-report.js";
import {
  mergeQualityIssues,
  mergeRuntimeEvents,
  normalizeQualityMessage,
  qualityPageCounts,
  QualityReport,
} from "../src/schema/quality.js";
import { validateHtml } from "../src/surveyor/html.js";

describe("quality ledger", () => {
  it("merges runtime events by path+rule+message and increments count", () => {
    const first = mergeRuntimeEvents(
      [],
      [
        {
          source: "console",
          rule: "console.error",
          severity: "error",
          message: "boom",
          count: 1,
          firstSeen: "t1",
          lastSeen: "t1",
        },
      ],
    );
    const next = mergeRuntimeEvents(first, [
      {
        source: "console",
        rule: "console.error",
        severity: "error",
        message: "boom",
        count: 2,
        firstSeen: "t2",
        lastSeen: "t2",
      },
    ]);
    assert.equal(next.length, 1);
    assert.equal(next[0]?.count, 3);
    assert.equal(next[0]?.lastSeen, "t2");
    assert.equal(next[0]?.firstSeen, "t1");
  });

  it("merges visual issues and keeps the higher confidence", () => {
    const merged = mergeQualityIssues([
      {
        source: "visual",
        rule: "overlap",
        severity: "warning",
        message: "chip on header",
        count: 1,
        confidence: "medium",
      },
      {
        source: "visual",
        rule: "overlap",
        severity: "warning",
        message: "chip on header",
        count: 1,
        confidence: "high",
        where: "filter chip on table header",
      },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.count, 2);
    assert.equal(merged[0]?.confidence, "high");
    assert.equal(merged[0]?.where, "filter chip on table header");
    const unioned = mergeQualityIssues([
      { source: "a11y", rule: "color-contrast", severity: "error", message: "contrast", count: 1, where: 'a "Milkshake"' },
      { source: "a11y", rule: "color-contrast", severity: "error", message: "contrast", count: 1, where: 'span "Settings"' },
    ]);
    assert.equal(unioned[0]?.where, 'a "Milkshake" · span "Settings"');
  });

  it("collapses visual paraphrases of the same rule and upgrades severity", () => {
    const merged = mergeQualityIssues([
      {
        source: "visual",
        rule: "scanline",
        severity: "warning",
        message: "row icons drift",
        count: 1,
        confidence: "medium",
        where: "row icons",
      },
      {
        source: "visual",
        rule: "scanline",
        severity: "error",
        message: "icons do not share a vertical edge",
        count: 1,
        confidence: "high",
        where: "row action icons",
      },
      {
        source: "visual",
        rule: "overlap",
        severity: "warning",
        message: "badge covers title",
        count: 1,
        confidence: "medium",
      },
    ]);
    assert.equal(merged.length, 2);
    const scanline = merged.find((i) => i.rule === "scanline")!;
    assert.equal(scanline.count, 2);
    assert.equal(scanline.severity, "error");
    assert.equal(scanline.confidence, "high");
    assert.equal(scanline.message, "icons do not share a vertical edge");
    assert.equal(scanline.where, "row icons · row action icons");
  });

  it("keeps a DOM sparse message when a higher-confidence VLM sparse arrives", () => {
    const merged = mergeQualityIssues([
      {
        source: "visual",
        rule: "sparse",
        severity: "warning",
        message: "left-locked form uses 29% of the pane",
        count: 1,
        confidence: "medium",
        via: "dom",
        where: "New vendor",
      },
      {
        source: "visual",
        rule: "sparse",
        severity: "warning",
        message: "huge empty region on the right",
        count: 1,
        confidence: "high",
        via: "vlm",
        where: "main pane",
      },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.message, "left-locked form uses 29% of the pane");
    assert.equal(merged[0]?.confidence, "medium");
    assert.equal(merged[0]?.via, "dom");
    assert.equal(merged[0]?.count, 1);
    assert.equal(merged[0]?.where, "New vendor");
  });

  it("lets VLM refresh untagged contrast but not untagged overflow", () => {
    const merged = mergeQualityIssues([
      {
        source: "visual",
        rule: "contrast",
        severity: "warning",
        message: "Hint is faint",
        count: 1,
        confidence: "medium",
      },
      {
        source: "visual",
        rule: "contrast",
        severity: "warning",
        message: "Hint text fails contrast on the gray bar",
        count: 1,
        confidence: "high",
        via: "vlm",
        where: "hint",
      },
      {
        source: "visual",
        rule: "overflow",
        severity: "warning",
        message: "Page is 20px wider",
        count: 1,
        confidence: "medium",
      },
      {
        source: "visual",
        rule: "overflow",
        severity: "error",
        message: "Page is 80px wider",
        count: 1,
        confidence: "high",
        via: "vlm",
      },
    ]);
    const contrast = merged.find((i) => i.rule === "contrast")!;
    assert.equal(contrast.message, "Hint text fails contrast on the gray bar");
    assert.equal(contrast.confidence, "high");
    assert.equal(contrast.where, "hint");
    const overflow = merged.find((i) => i.rule === "overflow")!;
    assert.equal(overflow.message, "Page is 20px wider");
    assert.equal(overflow.confidence, "medium");
    assert.equal(overflow.via, undefined);
  });

  it("lets a later DOM scan overwrite a VLM message for the same rule", () => {
    const merged = mergeQualityIssues([
      {
        source: "visual",
        rule: "clip",
        severity: "warning",
        message: "maybe sheared",
        count: 1,
        confidence: "medium",
        via: "vlm",
      },
      {
        source: "visual",
        rule: "clip",
        severity: "error",
        message: "Vendor column shears Expert Witness Servic",
        count: 1,
        confidence: "high",
        via: "dom",
        where: "Vendor column",
      },
    ]);
    assert.equal(merged[0]?.message, "Vendor column shears Expert Witness Servic");
    assert.equal(merged[0]?.severity, "error");
    assert.equal(merged[0]?.confidence, "high");
    assert.equal(merged[0]?.via, "dom");
    assert.equal(merged[0]?.where, "Vendor column");
  });

  it("keeps the worse DOM overflow when 1280 and 375 both hit", () => {
    const merged = mergeQualityIssues([
      {
        source: "visual",
        rule: "overflow",
        severity: "warning",
        message: "Page is 20px wider than the viewport",
        count: 1,
        confidence: "medium",
        via: "dom",
        where: "hero",
      },
      {
        source: "visual",
        rule: "overflow",
        severity: "error",
        message: "Page is 44px wider than the viewport",
        count: 1,
        confidence: "high",
        via: "dom",
        where: "hero @ 375px",
      },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.message, "Page is 44px wider than the viewport");
    assert.equal(merged[0]?.severity, "error");
    assert.equal(merged[0]?.confidence, "high");
    assert.equal(merged[0]?.via, "dom");
    assert.equal(merged[0]?.where, "hero · hero @ 375px");
    assert.equal(merged[0]?.count, 2);
  });

  it("truncates messages used as keys", () => {
    const long = "x".repeat(500);
    const n = normalizeQualityMessage(long);
    assert.ok(n.length <= 400);
    assert.match(n, /…$/);
  });

  it("snapshot replaces html/a11y and keeps runtime", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-quality-"));
    const configPath = join(dir, "clickmonkey.json");
    persistQualityRuntime(configPath, { path: "/" }, {
      source: "pageError",
      rule: "pageError",
      severity: "error",
      message: "cm-quality-boom",
      count: 1,
      firstSeen: "2026-08-18T00:00:00.000Z",
      lastSeen: "2026-08-18T00:00:00.000Z",
    });
    persistQualitySnapshot(configPath, {
      path: "/",
      foundAt: "2026-08-18T00:00:01.000Z",
      htmlHash: "abc",
      html: [{ source: "html", rule: "no-dup-id", severity: "error", message: "Duplicate ID", count: 1 }],
      a11y: [{ source: "a11y", rule: "image-alt", severity: "error", message: "Images must have alternate text", count: 1 }],
    });
    persistQualityRuntime(configPath, { path: "/" }, {
      source: "pageError",
      rule: "pageError",
      severity: "error",
      message: "cm-quality-boom",
      count: 1,
      firstSeen: "2026-08-18T00:00:02.000Z",
      lastSeen: "2026-08-18T00:00:02.000Z",
    });
    const report = loadQualityReport(qualityReportPath(configPath));
    assert.equal(report.pages.length, 1);
    const page = report.pages[0]!;
    assert.equal(page.html[0]?.rule, "no-dup-id");
    assert.equal(page.a11y[0]?.rule, "image-alt");
    assert.equal(page.runtime[0]?.count, 2);
    assert.equal(page.runtime[0]?.lastSeen, "2026-08-18T00:00:02.000Z");
  });

  it("snapshot keeps visual when html/a11y are replaced", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-quality-visual-keep-"));
    const configPath = join(dir, "clickmonkey.json");
    persistQualityVisual(configPath, {
      path: "/",
      foundAt: "t1",
      visualHash: "png-1",
      visual: [{ source: "visual", rule: "overlap", severity: "warning", message: "cards overlap", count: 1 }],
    });
    persistQualitySnapshot(configPath, {
      path: "/",
      foundAt: "t2",
      htmlHash: "html-2",
      html: [{ source: "html", rule: "no-dup-id", severity: "error", message: "Duplicate ID", count: 1 }],
      a11y: [],
    });
    persistQualityRuntime(configPath, { path: "/" }, {
      source: "console",
      rule: "console.error",
      severity: "error",
      message: "boom",
      count: 1,
      firstSeen: "t3",
      lastSeen: "t3",
    });
    const page = loadQualityReport(qualityReportPath(configPath)).pages[0]!;
    assert.equal(page.visual[0]?.rule, "overlap");
    assert.equal(page.visualHash, "png-1");
    assert.equal(page.html[0]?.rule, "no-dup-id");
    assert.equal(page.runtime[0]?.message, "boom");
  });

  it("persistQualityVisual keeps html/runtime and lastVisualHash tracks the png", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-quality-visual-"));
    const configPath = join(dir, "clickmonkey.json");
    assert.equal(lastVisualHash(configPath, { path: "/" }), undefined);
    persistQualitySnapshot(configPath, {
      path: "/",
      foundAt: "t1",
      htmlHash: "html-1",
      html: [{ source: "html", rule: "no-dup-id", severity: "error", message: "Duplicate ID", count: 1 }],
      a11y: [],
    });
    assert.equal(lastVisualHash(configPath, { path: "/" }), undefined);
    persistQualityRuntime(configPath, { path: "/" }, {
      source: "pageError",
      rule: "pageError",
      severity: "error",
      message: "cm-quality-boom",
      count: 1,
      firstSeen: "t2",
      lastSeen: "t2",
    });
    persistQualityVisual(configPath, {
      path: "/",
      foundAt: "t3",
      visualHash: "png-9",
      visual: [{ source: "visual", rule: "overflow", severity: "error", message: "text clipped", count: 1 }],
    });
    const page = loadQualityReport(qualityReportPath(configPath)).pages[0]!;
    assert.equal(page.html[0]?.rule, "no-dup-id");
    assert.equal(page.htmlHash, "html-1");
    assert.equal(page.runtime[0]?.message, "cm-quality-boom");
    assert.equal(page.visual[0]?.rule, "overflow");
    assert.equal(page.visualHash, "png-9");
    assert.equal(lastVisualHash(configPath, { path: "/" }), "png-9");
    assert.equal(lastVisualHash(configPath, { path: "/other" }), undefined);
  });

  it("persistQualityVisual unions a later scan with earlier visual issues", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-quality-visual-merge-"));
    const configPath = join(dir, "clickmonkey.json");
    persistQualityVisual(configPath, {
      path: "/customers/:id1/migrations",
      foundAt: "t1",
      visualHash: "png-a",
      visual: [
        { source: "visual", rule: "scanline", severity: "warning", message: "row icons drift", count: 1 },
      ],
    });
    persistQualityVisual(configPath, {
      path: "/customers/:id1/migrations",
      foundAt: "t2",
      visualHash: "png-b",
      visual: [
        { source: "visual", rule: "overlap", severity: "warning", message: "badge covers title", count: 1 },
      ],
    });
    const page = loadQualityReport(qualityReportPath(configPath)).pages[0]!;
    assert.deepEqual(
      page.visual.map((i) => i.rule).sort(),
      ["overlap", "scanline"],
    );
    assert.equal(page.visualHash, "png-b");
  });

  it("replaceDom drops prior DOM hits and keeps VLM-only rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-quality-visual-replace-"));
    const configPath = join(dir, "clickmonkey.json");
    persistQualityVisual(configPath, {
      path: "/",
      foundAt: "t1",
      visualHash: "png-a",
      visual: [
        {
          source: "visual",
          rule: "overflow",
          severity: "error",
          message: "Page is 44px wider",
          count: 1,
          via: "dom",
        },
        {
          source: "visual",
          rule: "contrast",
          severity: "warning",
          message: "Hint is faint",
          count: 1,
          via: "vlm",
        },
      ],
    });
    persistQualityVisual(
      configPath,
      {
        path: "/",
        foundAt: "t2",
        visualHash: "png-b",
        visual: [
          {
            source: "visual",
            rule: "sparse",
            severity: "warning",
            message: "left-locked form uses 29%",
            count: 1,
            via: "dom",
          },
        ],
      },
      undefined,
      { replaceDom: true },
    );
    const page = loadQualityReport(qualityReportPath(configPath)).pages[0]!;
    assert.deepEqual(page.visual.map((i) => i.rule).sort(), ["contrast", "sparse"]);
    assert.equal(page.visual.find((i) => i.rule === "overflow"), undefined);
  });

  it("replaceDom drops leftover via:vlm geometry", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-quality-visual-replace-vlm-geo-"));
    const configPath = join(dir, "clickmonkey.json");
    persistQualityVisual(configPath, {
      path: "/",
      foundAt: "t1",
      visualHash: "png-a",
      visual: [
        {
          source: "visual",
          rule: "overflow",
          severity: "error",
          message: "Page is 44px wider",
          count: 1,
          via: "vlm",
        },
        {
          source: "visual",
          rule: "other",
          severity: "warning",
          message: "Toast covering the save button",
          count: 1,
          via: "vlm",
        },
      ],
    });
    persistQualityVisual(
      configPath,
      {
        path: "/",
        foundAt: "t2",
        visualHash: "png-b",
        visual: [
          {
            source: "visual",
            rule: "sparse",
            severity: "warning",
            message: "left-locked form uses 29%",
            count: 1,
            via: "dom",
          },
        ],
      },
      undefined,
      { replaceDom: true },
    );
    const page = loadQualityReport(qualityReportPath(configPath)).pages[0]!;
    assert.deepEqual(page.visual.map((i) => i.rule).sort(), ["other", "sparse"]);
    assert.equal(page.visual.find((i) => i.rule === "overflow"), undefined);
  });

  it("replaceDom keeps untagged contrast/align/other from old ledgers", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-quality-visual-legacy-vlm-"));
    const configPath = join(dir, "clickmonkey.json");
    persistQualityVisual(configPath, {
      path: "/",
      foundAt: "t1",
      visualHash: "png-a",
      visual: [
        {
          source: "visual",
          rule: "overflow",
          severity: "error",
          message: "Page is 44px wider",
          count: 1,
        },
        {
          source: "visual",
          rule: "contrast",
          severity: "warning",
          message: "Hint is faint",
          count: 1,
        },
      ],
    });
    persistQualityVisual(
      configPath,
      {
        path: "/",
        foundAt: "t2",
        visualHash: "png-b",
        visual: [],
      },
      undefined,
      { replaceDom: true },
    );
    const page = loadQualityReport(qualityReportPath(configPath)).pages[0]!;
    assert.deepEqual(page.visual.map((i) => i.rule), ["contrast"]);
  });

  it("persistQualityVisual does not add a second row when the VLM rephrases the same rule", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-quality-visual-dedupe-"));
    const configPath = join(dir, "clickmonkey.json");
    persistQualityVisual(configPath, {
      path: "/customers/:id1/migrations",
      foundAt: "t1",
      visualHash: "png-a",
      visual: [
        {
          source: "visual",
          rule: "scanline",
          severity: "warning",
          message: "row icons drift",
          count: 1,
          confidence: "medium",
        },
      ],
    });
    persistQualityVisual(configPath, {
      path: "/customers/:id1/migrations",
      foundAt: "t2",
      visualHash: "png-b",
      visual: [
        {
          source: "visual",
          rule: "scanline",
          severity: "warning",
          message: "trailing actions wander off the title column",
          count: 1,
          confidence: "high",
          where: "row action icons",
        },
      ],
    });
    const page = loadQualityReport(qualityReportPath(configPath)).pages[0]!;
    assert.equal(page.visual.length, 1);
    assert.equal(page.visual[0]?.rule, "scanline");
    assert.equal(page.visual[0]?.count, 2);
    assert.equal(page.visual[0]?.confidence, "high");
    assert.equal(page.visual[0]?.message, "trailing actions wander off the title column");
    assert.equal(page.visual[0]?.where, "row action icons");
  });

  it("folds UUID customer pages onto one /customers/:id1/migrations ledger row", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-quality-fold-"));
    const configPath = join(dir, "clickmonkey.json");
    persistQualitySnapshot(configPath, {
      path: "/customers/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/migrations",
      foundAt: "t1",
      htmlHash: "h1",
      html: [{ source: "html", rule: "no-dup-id", severity: "error", message: "dup", count: 1 }],
      a11y: [],
    });
    persistQualityVisual(configPath, {
      path: "/customers/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/migrations",
      foundAt: "t2",
      visualHash: "png-a",
      visual: [{ source: "visual", rule: "scanline", severity: "warning", message: "row icons drift", count: 1 }],
    });
    persistQualitySnapshot(configPath, {
      path: "/customers/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/migrations",
      foundAt: "t3",
      htmlHash: "h2",
      html: [{ source: "html", rule: "no-dup-id", severity: "error", message: "dup", count: 1 }],
      a11y: [],
    });
    persistQualityVisual(configPath, {
      path: "/customers/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/migrations",
      foundAt: "t4",
      visualHash: "png-b",
      visual: [{ source: "visual", rule: "overlap", severity: "warning", message: "badge covers title", count: 1 }],
    });
    const report = loadQualityReport(qualityReportPath(configPath));
    assert.equal(report.pages.length, 1);
    assert.equal(report.pages[0]?.path, "/customers/:id1/migrations");
    assert.deepEqual(report.pages[0]?.visual.map((i) => i.rule).sort(), ["overlap", "scanline"]);
  });

  it("qualityPageCounts includes visual errors", () => {
    const counts = qualityPageCounts({
      path: "/",
      foundAt: "t",
      html: [{ source: "html", rule: "no-dup-id", severity: "error", message: "dup", count: 1 }],
      a11y: [{ source: "a11y", rule: "image-alt", severity: "warning", message: "alt", count: 1 }],
      visual: [{ source: "visual", rule: "overlap", severity: "error", message: "overlap", count: 1 }],
      runtime: [
        {
          source: "console",
          rule: "console.warning",
          severity: "warning",
          message: "w",
          count: 1,
          firstSeen: "t",
          lastSeen: "t",
        },
      ],
    });
    assert.equal(counts.errors, 2);
    assert.equal(counts.warnings, 2);
  });

  it("parses old quality.json without visual", () => {
    const parsed = QualityReport.parse({
      schemaVersion: 1,
      pages: [{ path: "/", foundAt: "t", html: [], a11y: [], runtime: [] }],
    });
    assert.deepEqual(parsed.pages[0]?.visual, []);
    assert.equal(parsed.pages[0]?.visualHash, undefined);
  });

  it("keeps the same path on different origins apart", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-quality-origin-"));
    const configPath = join(dir, "clickmonkey.json");
    persistQualitySnapshot(configPath, {
      path: "/login",
      foundAt: "t1",
      html: [{ source: "html", rule: "no-dup-id", severity: "error", message: "app", count: 1 }],
      a11y: [],
    });
    persistQualitySnapshot(configPath, {
      path: "/login",
      origin: "https://idp.example.com",
      foundAt: "t2",
      html: [{ source: "html", rule: "element-required-attributes", severity: "error", message: "idp", count: 1 }],
      a11y: [],
    });
    const report = loadQualityReport(qualityReportPath(configPath));
    assert.equal(report.pages.length, 2);
    const app = report.pages.find((p) => p.path === "/login" && !p.origin);
    const idp = report.pages.find((p) => p.origin === "https://idp.example.com");
    assert.equal(app?.html[0]?.message, "app");
    assert.equal(idp?.html[0]?.message, "idp");
  });

  it("writes a run quality.json and combines selected runs without touching the workspace ledger", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-quality-run-"));
    const configPath = join(dir, "clickmonkey.json");
    const runA = join(dir, "runs", "run-a");
    const runB = join(dir, "runs", "run-b");
    persistQualitySnapshot(
      configPath,
      {
        path: "/",
        foundAt: "t1",
        html: [{ source: "html", rule: "no-dup-id", severity: "error", message: "workspace", count: 1 }],
        a11y: [],
      },
    );
    persistQualitySnapshot(
      configPath,
      {
        path: "/customers",
        foundAt: "t2",
        html: [{ source: "html", rule: "no-dup-id", severity: "error", message: "run-a", count: 1 }],
        a11y: [],
      },
      runA,
    );
    persistQualitySnapshot(
      configPath,
      {
        path: "/pipelines",
        foundAt: "t3",
        html: [{ source: "html", rule: "no-dup-id", severity: "error", message: "run-b", count: 1 }],
        a11y: [],
      },
      runB,
    );
    assert.equal(existsSync(join(runA, "quality.json")), true);
    assert.equal(existsSync(join(runB, "quality.json")), true);
    const workspace = loadQualityReport(qualityReportPath(configPath));
    assert.equal(workspace.pages.length, 1);
    assert.equal(workspace.pages[0]?.html[0]?.message, "workspace");
    const onlyA = loadCombinedQuality([runA]);
    assert.equal(onlyA.pages.length, 1);
    assert.equal(onlyA.pages[0]?.path, "/customers");
    const both = loadCombinedQuality([runA, runB]);
    assert.deepEqual(both.pages.map((p) => p.path).sort(), ["/customers", "/pipelines"]);
    const reportA = renderFindingsReport(
      [],
      {
        url: "http://127.0.0.1/",
        generatedAt: "t",
        runIds: ["run-a"],
        quality: onlyA,
      },
      "/tmp/findings.md",
    );
    assert.match(reportA, /Workspace ledger across 1 page/);
    assert.match(reportA, /\/customers/);
    assert.doesNotMatch(reportA, /\/pipelines/);
  });

  it("html-validate flags duplicate ids and missing lang", async () => {
    const issues = await validateHtml(`<!DOCTYPE html>
<html>
  <head><title>x</title></head>
  <body>
    <p><div>bad</div></p>
    <button id="a"><div>x</div></button>
    <span id="a">two</span>
  </body>
</html>`);
    const rules = issues.map((i) => i.rule);
    assert.ok(rules.includes("no-dup-id"), JSON.stringify(issues));
    assert.ok(rules.includes("element-required-attributes"), JSON.stringify(issues));
    const nested = issues.find((i) => i.rule === "element-permitted-content");
    assert.ok(nested?.where?.includes("div"), JSON.stringify(nested));
    const dup = issues.find((i) => i.rule === "no-dup-id");
    assert.equal(dup?.where, "span");
  });

  it("report includes a Quality section from the ledgers", () => {
    const md = renderFindingsReport(
      [],
      {
        url: "http://127.0.0.1:4173/",
        generatedAt: "2026-08-18T00:00:00.000Z",
        runIds: ["sess"],
        qualityFull: true,
        testability: {
          schemaVersion: 1,
          pages: [
            {
              path: "/",
              foundAt: "t",
              insufficient: true,
              issues: [{ code: "opaqueControl", severity: "block", tag: "button" }],
            },
          ],
        },
        quality: {
          schemaVersion: 1,
          pages: [
            {
              path: "/",
              foundAt: "t",
              html: [{ source: "html", rule: "no-dup-id", severity: "error", message: "Duplicate ID \"a\"", count: 1 }],
              a11y: [
                {
                  source: "a11y",
                  rule: "image-alt",
                  severity: "error",
                  message: "Images must have alternate text",
                  count: 2,
                },
              ],
              visual: [
                {
                  source: "visual",
                  rule: "overlap",
                  severity: "warning",
                  message: "cards overlap the footer",
                  count: 1,
                },
              ],
              runtime: [
                {
                  source: "console",
                  rule: "console.error",
                  severity: "error",
                  message: "cm-quality-error",
                  count: 1,
                  firstSeen: "t",
                  lastSeen: "t",
                },
              ],
            },
          ],
        },
      },
      "/tmp/findings.md",
    );
    assert.match(md, /^## Quality/m);
    assert.match(md, /html-validate/);
    assert.match(md, /axe-core/);
    assert.match(md, /SEO \(title\/description\/OG\) on public paths/);
    assert.match(md, /DOM layout/);
    assert.doesNotMatch(md, /No LLM/);
    assert.match(md, /`opaqueControl` block/);
    assert.match(md, /`no-dup-id` · error/);
    assert.match(md, /`image-alt` · error ×2/);
    assert.match(md, /\*\*Visual\*\*/);
    assert.match(md, /`overlap` · warning/);
    assert.match(md, /cards overlap the footer/);
    assert.match(md, /`console.error` · error/);
    assert.match(md, /cm-quality-error/);
    const seoOnly = renderFindingsReport(
      [],
      {
        url: "http://127.0.0.1:4173/",
        generatedAt: "2026-08-18T00:00:00.000Z",
        runIds: ["sess"],
        qualityFull: true,
        quality: {
          schemaVersion: 1,
          pages: [
            {
              path: "/about",
              foundAt: "t",
              html: [],
              a11y: [],
              seo: [
                {
                  source: "seo",
                  rule: "meta-description",
                  severity: "warning",
                  message: "Missing meta description",
                  count: 1,
                },
              ],
              visual: [],
              runtime: [],
            },
          ],
        },
      },
      "/tmp/findings.md",
    );
    assert.match(seoOnly, /`\/about`/);
    assert.match(seoOnly, /\*\*SEO\*\*/);
    assert.match(seoOnly, /`meta-description` · warning/);
    const digest = renderFindingsReport(
      [],
      {
        url: "http://127.0.0.1:4173/",
        generatedAt: "2026-08-18T00:00:00.000Z",
        runIds: ["sess"],
        quality: {
          schemaVersion: 1,
          pages: [
            {
              path: "/",
              foundAt: "t",
              html: [],
              a11y: [],
              visual: [
                {
                  source: "visual",
                  rule: "overlap",
                  severity: "warning",
                  message: "cards overlap the footer",
                  count: 1,
                },
              ],
              runtime: [],
            },
          ],
        },
      },
      "/tmp/findings.md",
    );
    assert.match(digest, /`overlap` · warning\n\n  cards overlap the footer/);
    assert.doesNotMatch(digest, /\*\*Visual\*\*/);
  });
});
