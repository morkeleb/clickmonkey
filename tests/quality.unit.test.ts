import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  loadQualityReport,
  persistQualityRuntime,
  persistQualitySnapshot,
  qualityReportPath,
} from "../src/persist/quality.js";
import { renderFindingsReport } from "../src/reports/findings-report.js";
import {
  mergeRuntimeEvents,
  normalizeQualityMessage,
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

  it("html-validate flags duplicate ids and missing lang", async () => {
    const issues = await validateHtml(`<!DOCTYPE html>
<html>
  <head><title>x</title></head>
  <body>
    <p><div>bad</div></p>
    <button id="a">one</button>
    <span id="a">two</span>
  </body>
</html>`);
    const rules = issues.map((i) => i.rule);
    assert.ok(rules.includes("no-dup-id"), JSON.stringify(issues));
    assert.ok(rules.includes("element-required-attributes"), JSON.stringify(issues));
  });

  it("report includes a Quality section from the ledgers", () => {
    const md = renderFindingsReport(
      [],
      {
        url: "http://127.0.0.1:4173/",
        generatedAt: "2026-08-18T00:00:00.000Z",
        runIds: ["sess"],
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
    assert.match(md, /No LLM/);
    assert.match(md, /`opaqueControl` block/);
    assert.match(md, /`no-dup-id` error/);
    assert.match(md, /`image-alt` error ×2/);
    assert.match(md, /`console.error` error — cm-quality-error/);
  });
});
