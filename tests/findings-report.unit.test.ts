import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { collectFindingCases, contextAtStep } from "../src/persist/runs.js";
import { extractClickmonkeyFences } from "../src/reports/fences.js";
import {
  caseKey,
  collapseFindingCases,
  enrichWithBrain,
  isChromeRow,
  isClusterRow,
  markdownSafeQualityMessage,
  pathFamily,
  renderFindingsReport,
} from "../src/reports/findings-report.js";
import { findingId } from "../src/schema/finding.js";

describe("findings report", () => {
  it("renders severity groups, screenshot links, and clickmonkey fences", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-rep-"));
    const runDir = join(root, "runs", "20260817T000000Z-abcd");
    const folder = join(runDir, "findings", "fnd_3_expectFailed");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "finding.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        id: findingId(3, "expectFailed"),
        kind: "expectFailed",
        severity: "major",
        message: "expected invalid, field is valid",
        tapePath: join(folder, "replay.log"),
        stepIndex: 3,
      })}\n`,
    );
    writeFileSync(join(folder, "report.md"), "Expected validation / expect failed.\n");
    writeFileSync(join(folder, "replay.log"), "open home\nfill create.name \"\"\nclick create.submit\nexpect create.name invalid\n");
    writeFileSync(join(folder, "screenshot.png"), "png");

    const cases = collectFindingCases([runDir]);
    assert.equal(cases.length, 1);
    const out = join(root, "findings.md");
    const md = renderFindingsReport(
      cases,
      {
        url: "http://127.0.0.1:4173/",
        generatedAt: "2026-08-17T00:00:00.000Z",
        runIds: ["20260817T000000Z-abcd"],
      },
      out,
    );
    assert.match(md, /^# Findings report/m);
    assert.match(md, /^## Summary/m);
    assert.match(md, /^## Major/m);
    assert.match(md, /!\[screenshot\]\(runs\/20260817T000000Z-abcd\/findings\/fnd_3_expectFailed\/screenshot\.png\)/);
    assert.match(md, /```clickmonkey/);
    assert.match(md, /^## Findings/m);
    const findingsAt = md.indexOf("## Findings");
    const qualityAt = md.indexOf("## Quality");
    assert.ok(qualityAt === -1 || findingsAt < qualityAt, "findings before quality");
    const fences = extractClickmonkeyFences(md);
    assert.equal(fences.length, 1);
    assert.equal(fences[0]?.log.steps.some((s) => s.kind === "expectInvalid"), true);
  });

  it("collapses the same notFound and httpError across runs", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-rep-dedup-"));
    function writeCase(runId: string, id: string, kind: "notFound" | "httpError", message: string, url: string) {
      const folder = join(root, "runs", runId, "findings", id);
      mkdirSync(folder, { recursive: true });
      writeFileSync(
        join(folder, "finding.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          id,
          kind,
          message,
          tapePath: join(folder, "replay.log"),
          stepIndex: 1,
          url,
          ...(kind === "httpError" ? { httpStatus: 403 } : {}),
        })}\n`,
      );
      writeFileSync(join(folder, "replay.log"), "open home\n");
    }
    writeCase(
      "run-a",
      "fnd_1_notFound",
      "notFound",
      "Not found page GET http://127.0.0.1:3000/applications",
      "http://127.0.0.1:3000/applications",
    );
    writeCase(
      "run-b",
      "fnd_1_notFound",
      "notFound",
      "HTTP 404 GET http://127.0.0.1:3000/applications",
      "http://127.0.0.1:3000/applications",
    );
    writeCase(
      "run-a",
      "fnd_5_httpError",
      "httpError",
      "HTTP 403 GET http://127.0.0.1:3000/api/trpc/migration.get?batch=1",
      "http://127.0.0.1:3000/api/trpc/migration.get?batch=1",
    );
    writeCase(
      "run-b",
      "fnd_3_httpError",
      "httpError",
      "HTTP 403 GET http://127.0.0.1:3000/api/trpc/migration.get?batch=2",
      "http://127.0.0.1:3000/api/trpc/migration.get?batch=2",
    );
    const cases = collectFindingCases([join(root, "runs", "run-a"), join(root, "runs", "run-b")]);
    assert.equal(cases.length, 4);
    assert.equal(collapseFindingCases(cases).length, 2);
    const md = renderFindingsReport(
      cases,
      {
        url: "http://127.0.0.1:3000/",
        generatedAt: "2026-08-19T22:00:00.000Z",
        runIds: ["run-a", "run-b"],
      },
      join(root, "findings.md"),
    );
    assert.match(md, /2 findings from 2 runs/);
    assert.match(md, /\*\*seen:\*\* 2× in 2 runs/);
    assert.equal((md.match(/^### /gm) ?? []).length, 2);
  });

  it("collapses visualIssue findings on the same templated path and rule", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-rep-visual-"));
    function writeVisual(runId: string, id: string, url: string, message: string) {
      const folder = join(root, "runs", runId, "findings", id);
      mkdirSync(folder, { recursive: true });
      writeFileSync(
        join(folder, "finding.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          id,
          kind: "visualIssue",
          severity: "minor",
          message,
          tapePath: join(folder, "replay.log"),
          stepIndex: 1,
          url,
          widgetRef: "scanline",
        })}\n`,
      );
      writeFileSync(join(folder, "replay.log"), "open home\n");
      writeFileSync(join(folder, "screenshot.png"), "png");
    }
    writeVisual(
      "run-a",
      "fnd_2_visualIssue",
      "http://127.0.0.1:3000/customers/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/migrations",
      "scanline: row icons drift",
    );
    writeVisual(
      "run-b",
      "fnd_8_visualIssue",
      "http://127.0.0.1:3000/customers/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/migrations",
      "scanline: icons do not share an edge",
    );
    const cases = collectFindingCases([join(root, "runs", "run-a"), join(root, "runs", "run-b")]);
    assert.equal(cases.length, 2);
    assert.equal(collapseFindingCases(cases).length, 1);
  });

  it("renders an Explore outline from selected runs", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-rep-outline-"));
    const runDir = join(root, "runs", "20260818T120000Z-exp");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "presence.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        id: "20260818T120000Z-exp",
        name: "Nim",
        hue: 12,
        pid: 1,
        brain: "explore",
        pageId: "home",
        startedAt: "2026-08-18T12:00:00.000Z",
        updatedAt: "2026-08-18T12:01:00.000Z",
        stoppedAt: "2026-08-18T12:02:00.000Z",
        outline: {
          charter: "walk AR invoicing",
          now: "Empty invoice name — open accounts_receivable_invoices",
          notes: ["leave chrome via invoices"],
          plan: {
            goal: "Walk AR invoicing",
            items: [
              { id: "1", title: "Empty invoice name", page: "accounts_receivable_invoices", status: "now" },
              { id: "2", title: "Period close required fields", status: "pending" },
            ],
          },
        },
      })}\n`,
    );
    const md = renderFindingsReport(
      [],
      {
        url: "http://127.0.0.1:4173/",
        generatedAt: "2026-08-18T12:03:00.000Z",
        runIds: ["20260818T120000Z-exp"],
        outlines: [
          {
            runId: "20260818T120000Z-exp",
            outline: {
              charter: "walk AR invoicing",
              now: "Empty invoice name — open accounts_receivable_invoices",
              notes: ["leave chrome via invoices"],
              plan: {
                goal: "Walk AR invoicing",
                items: [
                  { id: "1", title: "Empty invoice name", page: "accounts_receivable_invoices", status: "now" },
                  { id: "2", title: "Period close required fields", status: "pending" },
                ],
              },
            },
          },
        ],
      },
      join(root, "findings.md"),
    );
    assert.match(md, /^## Explore/m);
    assert.match(md, /walk AR invoicing/);
    assert.match(md, /open accounts_receivable_invoices/);
    assert.match(md, /leave chrome via invoices/);
    assert.match(md, /\*\*Plan:\*\* Walk AR invoicing/);
    assert.match(md, /\[>\] Empty invoice name/);
    const exploreAt = md.indexOf("## Explore");
    const findingsAt = md.indexOf("## Findings");
    assert.ok(exploreAt > 0 && exploreAt < findingsAt);
  });

  it("renders plan coverage on explore outlines", () => {
    const md = renderFindingsReport(
      [],
      {
        url: "http://127.0.0.1:4173/",
        generatedAt: "t",
        runIds: ["r"],
        outlines: [
          {
            runId: "r",
            outline: {
              charter: "walk invoicing",
              notes: [],
              plan: {
                goal: "Cover invoicing",
                items: [
                  {
                    id: "1",
                    title: "Empty name",
                    page: "invoices",
                    status: "done",
                    stepCount: 3,
                    findingIds: ["fnd_1_uiIssue"],
                  },
                  { id: "2", title: "Period close", status: "skipped", stepCount: 10, findingIds: [] },
                  { id: "3", title: "Credits", status: "now", stepCount: 2, findingIds: [] },
                  { id: "4", title: "Reports", status: "pending" },
                ],
              },
            },
          },
        ],
      },
      "/tmp/findings.md",
    );
    assert.match(md, /\[x\] Empty name \(invoices\) — 3 steps, 1 finding: fnd_1_uiIssue/);
    assert.match(md, /\[-\] Period close — skipped, 10 steps/);
    assert.match(md, /\[>\] Credits — in progress, 2 steps/);
    assert.match(md, /\[ \] Reports — never started/);
  });

  it("attaches url and path from hops after the step starts", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-rep-ctx-"));
    const runDir = join(root, "runs", "20260818T000000Z-hop");
    const folder = join(runDir, "findings", "fnd_0_pageError");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "finding.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        id: findingId(0, "pageError"),
        kind: "pageError",
        severity: "critical",
        message: "Ga(...) is not a function",
        tapePath: join(folder, "replay.log"),
        stepIndex: 0,
      })}\n`,
    );
    writeFileSync(join(folder, "replay.log"), "click page.closing_routines nav\n");
    writeFileSync(
      join(runDir, "nav.jsonl"),
      [
        JSON.stringify({
          type: "step",
          line: "click page.closing_routines nav",
          pageId: "home",
        }),
        JSON.stringify({
          type: "nav",
          from: "https://app.example/",
          to: "https://app.example/accounting/closing-routines",
          via: "commit",
        }),
        JSON.stringify({ type: "stepDone", line: "click page.closing_routines nav", ok: true, ms: 80 }),
        JSON.stringify({
          type: "step",
          line: "click page.invoice_workspace",
          pageId: "accounting_closing_routines",
        }),
      ].join("\n"),
    );
    const ctx = contextAtStep(runDir, 0);
    assert.equal(ctx.url, "https://app.example/accounting/closing-routines");
    assert.equal(ctx.pageId, "accounting_closing_routines");
    const cases = collectFindingCases([runDir]);
    assert.equal(cases[0]?.url, "https://app.example/accounting/closing-routines");
    const md = renderFindingsReport(
      cases,
      {
        url: "https://app.example/",
        generatedAt: "t",
        runIds: ["20260818T000000Z-hop"],
      },
      join(root, "findings.md"),
    );
    assert.match(md, /\*\*url:\*\* https:\/\/app\.example\/accounting\/closing-routines/);
    assert.match(md, /\*\*path:\*\* \/accounting\/closing-routines/);
  });

  it("rolls quality into unique rules and omits preload noise", () => {
    const md = renderFindingsReport(
      [],
      {
        url: "http://127.0.0.1:4173/",
        generatedAt: "t",
        runIds: [],
        quality: {
          schemaVersion: 1,
          pages: [
            {
              path: "/",
              foundAt: "t",
              html: [
                {
                  source: "html",
                  rule: "no-multiple-main",
                  severity: "error",
                  message: "dup main",
                  count: 1,
                  where: "main.layout",
                },
              ],
              a11y: [],
              visual: [],
              runtime: [
                {
                  source: "console",
                  rule: "console.warning",
                  severity: "warning",
                  message: "The resource /font.woff2 was preloaded but not used within a few seconds",
                  count: 7,
                  firstSeen: "t",
                  lastSeen: "t",
                },
                {
                  source: "pageError",
                  rule: "pageError",
                  severity: "error",
                  message: "Ga(...) is not a function",
                  count: 1,
                  firstSeen: "t",
                  lastSeen: "t",
                },
              ],
            },
            {
              path: "/vendors",
              foundAt: "t",
              html: [{ source: "html", rule: "no-multiple-main", severity: "error", message: "dup main", count: 1 }],
              a11y: [],
              visual: [],
              runtime: [],
            },
          ],
        },
      },
      "/tmp/findings.md",
    );
    assert.match(md, /### Start here/);
    assert.match(md, /### Chrome/);
    assert.match(md, /Pages with unique issues/);
    assert.match(md, /2 pages/);
    assert.match(md, /no-multiple-main/);
    assert.match(md, /main\.layout/);
    assert.match(md, /Ga\(\.\.\.\) is not a function/);
    assert.match(md, /`\/` — 1 error, 0 warnings/);
    assert.match(md, / {2}- `pageError` error — Ga\(\.\.\.\) is not a function/);
    assert.doesNotMatch(md, / {2}- `no-multiple-main`/);
    assert.doesNotMatch(md, /`\/vendors` —/);
    assert.doesNotMatch(md, /Recurring rules/);
    assert.doesNotMatch(md, /Pages with the most issues/);
    assert.doesNotMatch(md, /preloaded but not used/);
    assert.doesNotMatch(md, /### `\/` —/);
  });

  it("counts UUID customer pages as one quality heading", () => {
    const md = renderFindingsReport(
      [],
      {
        url: "http://127.0.0.1:3000/",
        generatedAt: "t",
        runIds: [],
        quality: {
          schemaVersion: 1,
          pages: [
            {
              path: "/customers/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/migrations",
              foundAt: "t",
              html: [{ source: "html", rule: "no-dup-id", severity: "error", message: "dup", count: 1 }],
              a11y: [],
              visual: [],
              runtime: [],
            },
            {
              path: "/customers/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/migrations",
              foundAt: "t",
              html: [{ source: "html", rule: "no-dup-id", severity: "error", message: "dup", count: 1 }],
              a11y: [],
              visual: [],
              runtime: [],
            },
          ],
        },
      },
      "/tmp/findings.md",
    );
    assert.match(md, /Workspace ledger across 1 page/);
    assert.match(md, /\/customers\/:id1\/migrations/);
    assert.doesNotMatch(md, /aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/);
  });

  it("treats majority and large-walk thirds as chrome", () => {
    assert.equal(isChromeRow({ pages: 2 }, 2), true);
    assert.equal(isChromeRow({ pages: 1 }, 2), false);
    assert.equal(isChromeRow({ pages: 1 }, 1), false);
    assert.equal(isChromeRow({ pages: 24 }, 62), true);
    assert.equal(isChromeRow({ pages: 15 }, 62), false);
    assert.equal(isChromeRow({ pages: 3 }, 8), true);
    assert.equal(isChromeRow({ pages: 2 }, 8), false);
  });

  it("treats a few routes as a cluster, not chrome", () => {
    assert.equal(isClusterRow({ pages: 4 }, 13), true);
    assert.equal(isClusterRow({ pages: 2 }, 13), false);
    assert.equal(isClusterRow({ pages: 3 }, 8), false);
    assert.equal(isClusterRow({ pages: 24 }, 62), false);
  });

  it("wraps HTML tags in quality messages so markdown does not eat the report", () => {
    assert.equal(
      markdownSafeQualityMessage("<style> element is not permitted as content under <div>"),
      "`<style>` element is not permitted as content under `<div>`",
    );
    const pages = Array.from({ length: 13 }, (_, i) => ({
      path: `/p${i}`,
      foundAt: "t",
      html: [
        {
          source: "html" as const,
          rule: "no-multiple-main",
          severity: "error" as const,
          message: "dup main",
          count: 1,
        },
      ],
      a11y:
        i < 4
          ? [
              {
                source: "a11y" as const,
                rule: "clickableNonWidget",
                severity: "error" as const,
                message: "<div>",
                count: 1,
              },
            ]
          : [],
      visual: [],
      runtime:
        i === 0
          ? [
              {
                source: "pageError" as const,
                rule: "pageError",
                severity: "error" as const,
                message: "<style> element is not permitted as content under <div>",
                count: 1,
                firstSeen: "t",
                lastSeen: "t",
              },
            ]
          : [],
    }));
    const md = renderFindingsReport(
      [],
      { url: "http://127.0.0.1:4173/", generatedAt: "t", runIds: [], quality: { schemaVersion: 1, pages } },
      "/tmp/findings.md",
    );
    assert.match(md, /### Start here/);
    assert.match(md, /### On several pages/);
    assert.match(md, /clickableNonWidget/);
    assert.match(md, /`<div>`/);
    assert.match(md, /`<style>` element is not permitted as content under `<div>`/);
    assert.doesNotMatch(md, / — <style>/);
    assert.match(md, /## Appendix/);
    const full = renderFindingsReport(
      [],
      {
        url: "http://127.0.0.1:4173/",
        generatedAt: "t",
        runIds: [],
        qualityFull: true,
        quality: {
          schemaVersion: 1,
          pages: [
            {
              path: "/",
              foundAt: "t",
              html: [
                {
                  source: "html",
                  rule: "element-permitted-content",
                  severity: "error",
                  message: "<style> element is not permitted as content under <div>",
                  count: 1,
                },
              ],
              a11y: [],
              visual: [],
              runtime: [],
            },
          ],
        },
      },
      "/tmp/findings.md",
    );
    assert.match(full, /`<style>` element is not permitted as content under `<div>`/);
    assert.doesNotMatch(full, / — <style>/);
  });

  it("Start here prefers a path-family component over scattered same-count issues", () => {
    assert.equal(
      pathFamily([
        "/pipelines/00000000-0000-4000-8000-0000000000b1",
        "/pipelines/00000000-0000-4000-8000-0000000000b5/designer",
        "/pipelines/00000000-0000-4000-8000-0000000000b9",
        "/pipelines/00000000-0000-4000-8000-0000000000bd",
      ]),
      "/pipelines",
    );
    assert.equal(pathFamily(["/connectors", "/customers", "/pipelines", "/runs", "/sync-sessions"]), undefined);

    const pages = Array.from({ length: 13 }, (_, i) => {
      const path =
        i < 4 ? `/pipelines/${i}` : i < 8 ? ["/connectors", "/customers", "/runs", "/sync-sessions"][i - 4]! : `/other${i}`;
      return {
        path,
        foundAt: "t",
        html: [
          {
            source: "html" as const,
            rule: "color-contrast",
            severity: "error" as const,
            message: "Elements must meet minimum color contrast ratio thresholds",
            count: 1,
          },
        ],
        a11y:
          i < 4
            ? [
                {
                  source: "a11y" as const,
                  rule: "clickableNonWidget",
                  severity: "error" as const,
                  message: "div",
                  count: 1,
                },
              ]
            : i < 8
              ? [
                  {
                    source: "a11y" as const,
                    rule: "button-name",
                    severity: "error" as const,
                    message: "Buttons must have discernible text",
                    count: 1,
                  },
                ]
              : [],
        visual: [],
        runtime: [],
      };
    });
    const md = renderFindingsReport(
      [],
      { url: "http://127.0.0.1:4173/", generatedAt: "t", runIds: [], quality: { schemaVersion: 1, pages } },
      "/tmp/findings.md",
    );
    const start = md.slice(md.indexOf("### Start here"), md.indexOf("### Chrome"));
    assert.match(start, /Fix `color-contrast` \(shared shell/);
    assert.match(start, /one token\/CSS change/);
    assert.match(start, /2\. Fix `clickableNonWidget` \(same component/);
    assert.match(start, /mostly `\/pipelines`/);
    assert.ok(start.indexOf("clickableNonWidget") < start.indexOf("button-name"));
  });

  it("enrichWithBrain keeps only known ids", async () => {
    const extras = await enrichWithBrain(
      [
        {
          id: "fnd_1_uiIssue",
          runId: "r",
          runDir: "/tmp",
          finding: {
            schemaVersion: 1,
            id: "fnd_1_uiIssue",
            kind: "uiIssue",
            message: "overlap",
            tapePath: "/tmp/x",
            stepIndex: 1,
          },
          severity: "suggestion",
          title: "overlap",
          description: "overlap",
          tape: "screenshot ui overlap\n",
        },
      ],
      {
        url: "http://127.0.0.1:4173/",
        intro: [],
        writePolicy: "validationOnly",
        map: { schemaVersion: 1, app: "x", generation: 0, pages: [] },
        brain: { baseUrl: "http://127.0.0.1:9", model: "mock" },
      },
      async () =>
        JSON.stringify({
          summary: "One UI overlap.",
          items: [
            { id: "r/fnd_1_uiIssue", title: "Create – buttons overlap", why: "Users miss the submit." },
            { id: "invented", title: "nope" },
          ],
        }),
    );
    assert.equal(extras.summary, "One UI overlap.");
    assert.equal(extras.extras.get("r/fnd_1_uiIssue")?.title, "Create – buttons overlap");
    assert.equal(extras.extras.has("invented"), false);
  });

  it("enrichWithBrain returns empty extras on invalid JSON", async () => {
    const extras = await enrichWithBrain(
      [
        {
          id: "fnd_1_uiIssue",
          runId: "r",
          runDir: "/tmp",
          finding: {
            schemaVersion: 1,
            id: "fnd_1_uiIssue",
            kind: "uiIssue",
            message: "overlap",
            tapePath: "/tmp/x",
            stepIndex: 1,
          },
          severity: "suggestion",
          title: "overlap",
          description: "overlap",
          tape: "screenshot ui overlap\n",
        },
      ],
      {
        url: "http://127.0.0.1:4173/",
        intro: [],
        writePolicy: "validationOnly",
        map: { schemaVersion: 1, app: "x", generation: 0, pages: [] },
        brain: { baseUrl: "http://127.0.0.1:9", model: "mock" },
      },
      async () => `{ "summary": "x", "items": [ { "id": "r/fnd_1_uiIssue" `,
    );
    assert.equal(extras.summary, "");
    assert.equal(extras.extras.size, 0);
  });

  it("keeps LLM extras distinct when two runs share a finding id", async () => {
    const a = {
      id: "fnd_3_expectFailed",
      runId: "sess-a",
      runDir: "/tmp/a",
      finding: {
        schemaVersion: 1 as const,
        id: "fnd_3_expectFailed",
        kind: "expectFailed" as const,
        message: "empty on a",
        tapePath: "/tmp/a",
        stepIndex: 3,
      },
      severity: "major" as const,
      title: "empty on a",
      description: "a",
      tape: "open home\n",
    };
    const b = { ...a, runId: "sess-b", runDir: "/tmp/b", finding: { ...a.finding, message: "empty on b" }, title: "empty on b", description: "b" };
    const extras = await enrichWithBrain(
      [a, b],
      {
        url: "http://127.0.0.1:4173/",
        intro: [],
        writePolicy: "validationOnly",
        map: { schemaVersion: 1, app: "x", generation: 0, pages: [] },
        brain: { baseUrl: "http://127.0.0.1:9", model: "mock" },
      },
      async () =>
        JSON.stringify({
          summary: "Two empties.",
          items: [
            { id: caseKey(a), title: "A – empty name" },
            { id: caseKey(b), title: "B – empty name" },
          ],
        }),
    );
    const md = renderFindingsReport([a, b], { url: "http://127.0.0.1:4173/", generatedAt: "t", runIds: ["sess-a", "sess-b"] }, "/tmp/findings.md", extras.extras);
    assert.match(md, /A – empty name/);
    assert.match(md, /B – empty name/);
    assert.notEqual(extras.extras.get(caseKey(a))?.title, extras.extras.get(caseKey(b))?.title);
  });
});
