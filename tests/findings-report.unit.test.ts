import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { collectFindingCases, contextAtStep, type FindingCase } from "../src/persist/runs.js";
import { findingHitOf } from "../src/reports/check.js";
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
import { cannedReport } from "../src/reports/canned.js";
import { findingId, pageErrorExplanation, pageErrorTitle, validationMissExplanation } from "../src/schema/finding.js";

function caseOf(c: Omit<FindingCase, "check" | "message">): FindingCase {
  const hit = findingHitOf(c.finding, {
    pageId: c.pageId,
    url: c.url,
    screenshotPath: c.screenshotPath,
  });
  return { ...hit, ...c, check: hit.check, message: hit.message };
}

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
    assert.equal(cases[0]?.check.rule, "expectFailed");
    assert.equal(cases[0]?.check.code, "Q-22");
    assert.match(cases[0]?.check.href ?? "", /^https?:\/\//);
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
    assert.doesNotMatch(md.slice(md.indexOf("## Summary"), md.indexOf("## Findings")), /### Labels/);
    assert.doesNotMatch(md.slice(md.indexOf("## Summary"), md.indexOf("## Findings")), /### By chapter/);
    assert.match(md, /^## Major/m);
    assert.match(md, /!\[screenshot\]\(runs\/20260817T000000Z-abcd\/findings\/fnd_3_expectFailed\/screenshot\.png\)/);
    assert.match(md, /```clickmonkey/);
    assert.match(md, /\*\*Expected:\*\*/);
    assert.match(md, /\*\*Actual:\*\*/);
    assert.match(md, /\*\*Why it matters:\*\*/);
    assert.doesNotMatch(md, /^- \*\*id:\*\*/m);
    assert.match(md, /`expectFailed` · major · `fnd_3_expectFailed` · `20260817T000000Z-abcd`/);
    assert.match(md, /^## Findings/m);
    const findingsAt = md.indexOf("## Findings");
    const qualityAt = md.indexOf("## Quality");
    assert.ok(qualityAt === -1 || findingsAt < qualityAt, "findings before quality");
    const tapeAt = md.indexOf("```clickmonkey");
    const locAt = md.indexOf("`expectFailed` · major · `fnd_3_expectFailed`");
    assert.ok(tapeAt > 0 && locAt > tapeAt, "loc line after the tape");
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
    assert.match(md, /2× in 2 runs/);
    const findings = md.slice(md.indexOf("## Findings"));
    assert.equal((findings.match(/^### /gm) ?? []).length, 2);
  });

  it("collapses the same visualIssue message across pages and runs", () => {
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
          widgetRef: "overlap",
        })}\n`,
      );
      writeFileSync(join(folder, "replay.log"), "open home\n");
      writeFileSync(join(folder, "screenshot.png"), "png");
    }
    const chrome =
      "overlap: Header or nav controls occupy the same pixels — folder_open Clients & Matters, Your account";
    const chromeGrown =
      "overlap: Header or nav controls occupy the same pixels — folder_open Clients & Matters, Your account · group Employees expand_more, Your account";
    writeVisual("run-a", "fnd_2_visualIssue", "https://demo.f2dev.test/home", chrome);
    writeVisual("run-b", "fnd_8_visualIssue", "https://demo.f2dev.test/reports/cash-flow", chromeGrown);
    writeVisual(
      "run-b",
      "fnd_9_visualIssue",
      "https://demo.f2dev.test/home",
      "overlap: dashboard Dashboard and checklist Action Items close occupy the same pixels — dashboard Dashboard, checklist Action Items close",
    );
    writeVisual(
      "run-b",
      "fnd_10_visualIssue",
      "https://demo.f2dev.test/clients",
      'targetSize: Button is 18×18px; WCAG 2.5.8 minimum is 24×24 — button "Close Clients & Matters"',
    );
    writeVisual(
      "run-a",
      "fnd_11_visualIssue",
      "https://demo.f2dev.test/fees",
      'targetSize: Button is 18×18px; WCAG 2.5.8 minimum is 24×24 — button "Close Fee entries"',
    );
    const cases = collectFindingCases([join(root, "runs", "run-a"), join(root, "runs", "run-b")]);
    assert.equal(cases.length, 5);
    // Growing chrome where stays one card; two named Close buttons stay two.
    assert.equal(collapseFindingCases(cases).length, 4);
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
    assert.match(md, /### Explore/);
    assert.match(md, /walk AR invoicing/);
    assert.match(md, /open accounts_receivable_invoices/);
    assert.match(md, /leave chrome via invoices/);
    assert.match(md, /\*\*Plan:\*\* Walk AR invoicing/);
    assert.match(md, /\[>\] Empty invoice name/);
    const exploreAt = md.indexOf("### Explore");
    const findingsAt = md.indexOf("## Findings");
    const appendixAt = md.indexOf("## Appendix");
    assert.ok(findingsAt > 0 && appendixAt > findingsAt && exploreAt > appendixAt);
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
                    findingIds: ["fnd_1_visualIssue"],
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
    assert.match(md, /\[x\] Empty name \(invoices\) — 3 steps, 1 finding: fnd_1_visualIssue/);
    assert.match(md, /\[-\] Period close — skipped, 10 steps/);
    assert.match(md, /\[>\] Credits — in progress, 2 steps/);
    assert.match(md, /\[ \] Reports — never started/);
  });

  it("uses host summary as the Summary body", () => {
    const md = renderFindingsReport(
      [],
      {
        url: "http://127.0.0.1:4173/",
        generatedAt: "t",
        runIds: ["r"],
      },
      "/tmp/findings.md",
      undefined,
      "Empty invoice name is the main risk.",
    );
    assert.match(md, /^## Summary\n\nEmpty invoice name is the main risk\./m);
    assert.doesNotMatch(md, /\d+ findings? from \d+ runs?/);
  });

  it("renders extra before Appendix", () => {
    const md = renderFindingsReport(
      [],
      {
        url: "http://127.0.0.1:4173/",
        generatedAt: "t",
        runIds: ["r"],
        extra: "Host digest of the walk.",
      },
      "/tmp/findings.md",
    );
    assert.match(md, /^## Extra$/m);
    assert.match(md, /Host digest of the walk\./);
    const extraAt = md.indexOf("## Extra");
    const appendixAt = md.indexOf("## Appendix");
    assert.ok(extraAt > 0 && extraAt < appendixAt, "extra before appendix");
  });

  it("renders positive observations from outline goods", () => {
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
              goods: ["required name blocks submit"],
            },
          },
        ],
      },
      "/tmp/findings.md",
    );
    assert.match(md, /\*\*Positive observations:\*\*/);
    assert.match(md, /required name blocks submit/);
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
    const slim = collectFindingCases([runDir], { tapes: false });
    assert.equal(slim[0]?.url, "https://app.example/accounting/closing-routines");
    assert.equal(slim[0]?.pageId, "accounting_closing_routines");
    assert.equal(slim[0]?.check.rule, "pageError");
    assert.equal(slim[0]?.tape, "");
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
    assert.match(
      md,
      /\[\/accounting\/closing-routines\]\(https:\/\/app\.example\/accounting\/closing-routines\)/,
    );
    assert.match(md, /Uncaught JavaScript error: Ga\(\.\.\.\) is not a function/);
    assert.match(md, /\*\*Expected:\*\* The page stays usable\./);
    assert.match(md, /\*\*Actual:\*\* Uncaught JavaScript `Ga\(\.\.\.\) is not a function`\./);
    assert.match(md, /\*\*Why it matters:\*\*/);
    assert.doesNotMatch(md, /Playwright `pageerror`/);
    assert.doesNotMatch(md, /not `console\.error`/);
    assert.doesNotMatch(md, /not a field validation message/);
    assert.doesNotMatch(md, /validation is missing/);
    assert.doesNotMatch(md, /bad input/);
  });

  it("explains a throw after fill as missing validation and an uncaught JS error", () => {
    const title = pageErrorTitle("Invalid time value");
    assert.equal(title, "Uncaught JavaScript error: Invalid time value");
    const body = pageErrorExplanation("Invalid time value", {
      field: "page.from_date",
      value: "%00%00%00%00",
      markedInvalid: false,
      shouldInvalid: true,
    });
    assert.match(body, /uncaught JavaScript error/);
    assert.match(body, /the page crashed/i);
    assert.match(body, /page\.from_date/);
    assert.match(body, /%00%00%00%00/);
    assert.match(body, /not marked invalid/);
    assert.match(body, /Validation is missing|does not wrap parsing/i);
    assert.match(body, /product bug/);
    assert.match(body, /Exception: `Invalid time value`/);
    const again = pageErrorExplanation(body);
    assert.match(again, /uncaught JavaScript error/);
    assert.match(again, /page\.from_date/);
    assert.equal(pageErrorTitle(body), title);
    const generic = pageErrorExplanation("Ga(...) is not a function");
    assert.match(generic, /uncaught JavaScript error/);
    assert.doesNotMatch(generic, /validation is missing/);
    assert.doesNotMatch(generic, /ClickMonkey had just filled/);
    const afterValid = pageErrorExplanation("Ga(...) is not a function", {
      field: "page.name",
      value: "Ada",
      shouldInvalid: false,
    });
    assert.match(afterValid, /page\.name/);
    assert.doesNotMatch(afterValid, /validation is missing/);
    assert.doesNotMatch(afterValid, /junk value that crashes/);
  });

  it("renders a silent-accept finding as missing validation, not a raw expect", () => {
    const message = validationMissExplanation([{ field: "page.from_date", value: "%00%00%00%00" }]);
    const root = mkdtempSync(join(tmpdir(), "cm-rep-valid-"));
    const runDir = join(root, "runs", "20260821T000000Z-vald");
    const folder = join(runDir, "findings", "fnd_4_expectFailed");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "finding.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        id: findingId(4, "expectFailed"),
        kind: "expectFailed",
        severity: "major",
        message,
        tapePath: join(folder, "replay.log"),
        stepIndex: 4,
      })}\n`,
    );
    writeFileSync(join(folder, "replay.log"), "open home\nfill page.from_date \"%00%00%00%00\"\nclick page.save\n");
    const md = renderFindingsReport(
      collectFindingCases([runDir]),
      { url: "http://127.0.0.1:4173/", generatedAt: "t", runIds: ["20260821T000000Z-vald"] },
      join(root, "findings.md"),
    );
    assert.match(md, /### Validation did not catch junk in `page\.from_date`/);
    assert.match(md, /\*\*Expected:\*\* The field is marked invalid\./);
    assert.match(md, /\*\*Actual:\*\* The form sent or left without rejecting the input\./);
    assert.match(md, /\*\*Why it matters:\*\*/);
    assert.doesNotMatch(md, /### filled page\.from_date/);
    const canned = cannedReport({
      schemaVersion: 1,
      id: findingId(4, "expectFailed"),
      kind: "expectFailed",
      message,
      tapePath: "t",
      stepIndex: 4,
    });
    assert.match(canned, /Validation did not catch junk in `page\.from_date`/);
    assert.doesNotMatch(canned, /Expected validation \/ expect failed/);
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
    assert.match(md, /### Pages/);
    assert.match(md, /More than one main landmark/);
    assert.match(md, /2 pages/);
    assert.match(md, /no-multiple-main/);
    assert.match(md, /main\.layout/);
    assert.match(md, /Ga\(\.\.\.\) is not a function/);
    assert.match(md, /#### `\/`/);
    assert.match(md, /`pageError` · error/);
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
    assert.match(start, /theme token/);
    assert.match(start, /2\. Fix `clickableNonWidget` \(same component/);
    assert.match(start, /mostly `\/pipelines`/);
    assert.ok(start.indexOf("clickableNonWidget") < start.indexOf("button-name"));
  });

  it("enrichWithBrain keeps only known ids", async () => {
    const extras = await enrichWithBrain(
      [
        caseOf({
          id: "fnd_1_visualIssue",
          runId: "r",
          runDir: "/tmp",
          finding: {
            schemaVersion: 1,
            id: "fnd_1_visualIssue",
            kind: "visualIssue",
            message: "overlap",
            tapePath: "/tmp/x",
            stepIndex: 1,
          },
          severity: "suggestion",
          title: "overlap",
          description: "overlap",
          tape: "screenshot ui overlap\n",
        }),
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
            { id: "r/fnd_1_visualIssue", title: "Create – buttons overlap", why: "Users miss the submit." },
            { id: "invented", title: "nope" },
          ],
        }),
    );
    assert.equal(extras.summary, "One UI overlap.");
    assert.equal(extras.extras.get("r/fnd_1_visualIssue")?.title, "Create – buttons overlap");
    assert.equal(extras.extras.has("invented"), false);
  });

  it("enrichWithBrain returns empty extras on invalid JSON", async () => {
    const extras = await enrichWithBrain(
      [
        caseOf({
          id: "fnd_1_visualIssue",
          runId: "r",
          runDir: "/tmp",
          finding: {
            schemaVersion: 1,
            id: "fnd_1_visualIssue",
            kind: "visualIssue",
            message: "overlap",
            tapePath: "/tmp/x",
            stepIndex: 1,
          },
          severity: "suggestion",
          title: "overlap",
          description: "overlap",
          tape: "screenshot ui overlap\n",
        }),
      ],
      {
        url: "http://127.0.0.1:4173/",
        intro: [],
        writePolicy: "validationOnly",
        map: { schemaVersion: 1, app: "x", generation: 0, pages: [] },
        brain: { baseUrl: "http://127.0.0.1:9", model: "mock" },
      },
      async () => `{ "summary": "x", "items": [ { "id": "r/fnd_1_visualIssue" `,
    );
    assert.equal(extras.summary, "");
    assert.equal(extras.extras.size, 0);
  });

  it("keeps LLM extras distinct when two runs share a finding id", async () => {
    const a = caseOf({
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
    });
    const b = caseOf({ ...a, runId: "sess-b", runDir: "/tmp/b", finding: { ...a.finding, message: "empty on b" }, title: "empty on b", description: "b" });
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

  it("caps pages with issues at 8 and does not paginate chrome", () => {
    const pages = Array.from({ length: 9 }, (_, i) => ({
      path: `/p${i}`,
      foundAt: "t",
      html: [
        {
          source: "html" as const,
          rule: "no-dup-id",
          severity: "error" as const,
          message: `dup-${i}`,
          count: 1,
        },
      ],
      a11y: [
        {
          source: "a11y" as const,
          rule: "color-contrast",
          severity: "error" as const,
          message: "Elements must meet minimum color contrast ratio thresholds",
          count: 1,
        },
      ],
      visual: [],
      runtime: [],
    }));
    const meta = {
      url: "http://127.0.0.1:4173/",
      generatedAt: "t",
      runIds: [] as string[],
      quality: { schemaVersion: 1 as const, pages },
    };
    const md = renderFindingsReport([], meta, "/tmp/findings.md");
    assert.match(md, /## Accessibility/);
    assert.match(md, /\*\*AXE color-contrast\*\* · AA · 1\.4\.3 · `color-contrast` · error · chrome · 9 pages/);
    assert.match(md, /## Quality/);
    assert.equal((md.match(/^#### `/gm) ?? []).length, 8);
    assert.match(md, /#### `\/p0`/);
    assert.doesNotMatch(md, /#### `\/p8`/);
    assert.doesNotMatch(md, /meets AA/i);
    const full = renderFindingsReport([], { ...meta, qualityFull: true }, "/tmp/findings.md");
    assert.match(full, /#### `\/p8`/);
    assert.equal((full.match(/^#### `/gm) ?? []).length, 9);
    assert.match(full, /`color-contrast` · error · chrome · 9 pages/);
    const withShell = {
      ...meta,
      qualityFull: true,
      quality: {
        schemaVersion: 1 as const,
        pages: [
          ...pages,
          {
            path: "/shell",
            foundAt: "t",
            html: [],
            a11y: [
              {
                source: "a11y" as const,
                rule: "color-contrast",
                severity: "error" as const,
                message: "Elements must meet minimum color contrast ratio thresholds",
                count: 1,
              },
            ],
            visual: [],
            runtime: [],
          },
        ],
      },
    };
    const fullIndex = renderFindingsReport([], withShell, "/tmp/findings.md");
    assert.doesNotMatch(fullIndex, /## By page/);
    assert.doesNotMatch(fullIndex, /^#### `\/shell`/m);
    assert.match(fullIndex, /`color-contrast` · error · chrome/);
  });

  it("explains spec-name labels before they appear", () => {
    const meta = {
      url: "http://127.0.0.1:4173/",
      generatedAt: "t",
      runIds: [] as string[],
      qualityFull: true,
      quality: {
        schemaVersion: 1 as const,
        pages: [
          {
            path: "/",
            foundAt: "t",
            html: [],
            a11y: [
              {
                source: "a11y" as const,
                rule: "color-contrast",
                severity: "error" as const,
                message: "Elements must meet minimum color contrast ratio thresholds",
                count: 1,
              },
            ],
            visual: [
              {
                source: "visual" as const,
                rule: "overlap",
                severity: "warning" as const,
                message: "cards overlap the footer",
                count: 1,
              },
            ],
            runtime: [],
          },
        ],
      },
    };
    const md = renderFindingsReport([], meta, "/tmp/findings.md");
    const summary = md.slice(md.indexOf("## Summary"), md.indexOf("## Findings"));
    assert.doesNotMatch(summary, /### Labels/);
    assert.match(summary, /### By chapter/);
    assert.match(summary, /- \*\*Accessibility\*\*/);
    assert.match(summary, /- \*\*Visual\*\*/);
    assert.match(summary, /\[AXE color-contrast\]\([^)]+axe\/4\.13\/color-contrast\) — 1 page/);
    assert.match(summary, /\[Overlap\]\([^)]+V-03[^)]*\) — 1 page/);
    assert.match(summary, /\[`\/`\]\(http:\/\/127\.0\.0\.1:4173\/\)/);
    assert.ok(summary.indexOf("**Accessibility**") < summary.indexOf("AXE color-contrast"));
    assert.ok(summary.indexOf("**Visual**") < summary.indexOf("Overlap"));
    assert.ok(summary.indexOf("AXE color-contrast") < summary.indexOf("[`/`]"), "path nests under the class");
    assert.ok(summary.indexOf("### By chapter") < summary.indexOf("### Start here"));
    assert.doesNotMatch(md, /## By page/);
    assert.match(md, /### Pages/);
    assert.ok(md.includes("#### `/`"), md);
    assert.match(md, /\*\*AXE color-contrast\*\*/);
    assert.match(md, /\*\*Overlap\*\*/);
    const withLlm = renderFindingsReport(
      [],
      meta,
      "/tmp/findings.md",
      undefined,
      "Walked the app. Contrast is the worst.",
    );
    assert.ok(withLlm.indexOf("Walked the app") < withLlm.indexOf("### By chapter"));
    const llmIndex = withLlm.slice(withLlm.indexOf("### By chapter"), withLlm.indexOf("## Findings"));
    assert.match(llmIndex, /AXE color-contrast/);
    assert.match(llmIndex, /### Start here/);
    const empty = renderFindingsReport(
      [],
      { url: "http://127.0.0.1:4173/", generatedAt: "t", runIds: [] },
      "/tmp/findings.md",
    );
    assert.doesNotMatch(empty, /### By chapter/);
    assert.doesNotMatch(empty, /### Labels/);
  });

  it("ranks issue classes by pages and leftover Pages by unique issues", () => {
    const md = renderFindingsReport(
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
              path: "/quiet",
              foundAt: "t",
              html: [],
              a11y: [
                {
                  source: "a11y",
                  rule: "color-contrast",
                  severity: "error",
                  message: "Elements must meet minimum color contrast ratio thresholds",
                  count: 1,
                },
              ],
              visual: [],
              runtime: [],
            },
            {
              path: "/messy",
              foundAt: "t",
              html: [
                {
                  source: "html",
                  rule: "no-dup-id",
                  severity: "error",
                  message: "dup ids",
                  count: 1,
                },
              ],
              a11y: [
                {
                  source: "a11y",
                  rule: "color-contrast",
                  severity: "error",
                  message: "Elements must meet minimum color contrast ratio thresholds",
                  count: 1,
                },
              ],
              visual: [
                {
                  source: "visual",
                  rule: "clip",
                  severity: "error",
                  message: "BILLABLE and DESCRIPTION headers are squished together",
                  count: 1,
                },
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
    const index = md.slice(md.indexOf("### By chapter"), md.indexOf("## Findings"));
    const a1 = index.indexOf("AXE color-contrast");
    const vClip = index.indexOf("Clip");
    const qDup = index.indexOf("html-validate no-dup-id");
    assert.ok(a1 >= 0, index);
    assert.ok(vClip >= 0, index);
    assert.ok(qDup >= 0, index);
    const a11yHead = index.indexOf("**Accessibility**");
    const visualHead = index.indexOf("**Visual**");
    const qualityHead = index.indexOf("**Quality**");
    assert.ok(a11yHead >= 0 && visualHead > a11yHead && qualityHead > visualHead, index);
    assert.ok(a1 < visualHead, "contrast under Accessibility");
    assert.ok(index.indexOf("2 pages") >= 0 && index.indexOf("2 pages") < visualHead, "most pages first in chapter");
    const contrastAt = index.indexOf("AXE color-contrast");
    const messyPath = index.indexOf("[`/messy`](http://127.0.0.1:4173/messy)");
    const quietPath = index.indexOf("[`/quiet`](http://127.0.0.1:4173/quiet)");
    assert.ok(messyPath > contrastAt && messyPath < visualHead, "messy nests under contrast");
    assert.ok(quietPath > contrastAt && quietPath < visualHead, "quiet nests under contrast");
    assert.doesNotMatch(md, /## By page/);
    assert.ok(md.includes("#### `/messy`"), md);
    assert.ok(!md.includes("#### `/quiet`"), md);
  });

  it("nests paths under By chapter and groups long classes by prefix", () => {
    const pages = Array.from({ length: 9 }, (_, i) => ({
      path: i < 4 ? `/acct/p${i}` : `/trust/p${i}`,
      foundAt: "t",
      html: [] as [],
      a11y: [
        {
          source: "a11y" as const,
          rule: "color-contrast",
          severity: "error" as const,
          message: "Elements must meet minimum color contrast ratio thresholds",
          count: 1,
        },
      ],
      visual:
        i === 0
          ? [
              {
                source: "visual" as const,
                rule: "clip",
                severity: "error" as const,
                message: "AMOUNT header is cut off",
                count: 1,
              },
            ]
          : [],
      runtime: [] as [],
    }));
    const md = renderFindingsReport(
      [],
      {
        url: "http://127.0.0.1:4173/",
        generatedAt: "t",
        runIds: [],
        qualityFull: true,
        quality: { schemaVersion: 1, pages },
      },
      "/tmp/findings.md",
    );
    const index = md.slice(md.indexOf("### By chapter"), md.indexOf("## Findings"));
    const contrastAt = index.indexOf("[AXE color-contrast]");
    const clipAt = index.indexOf("[Clip]");
    assert.ok(contrastAt >= 0 && clipAt > contrastAt, index);
    const contrast = index.slice(contrastAt, clipAt);
    assert.match(contrast, /\[AXE color-contrast\]\([^)]+\) — 9 pages/);
    assert.doesNotMatch(contrast, /<details>/);
    assert.match(contrast, /`\/trust` — 5/);
    assert.match(contrast, /`\/acct` — 4/);
    assert.ok(contrast.indexOf("`/trust` — 5") < contrast.indexOf("`/acct` — 4"), contrast);
    assert.match(contrast, /\[`\/trust\/p8`\]\(http:\/\/127\.0\.0\.1:4173\/trust\/p8\)/);
    const clip = index.slice(clipAt);
    assert.match(clip, /\[Clip\]\([^)]+V-02[^)]*\) — 1 page/);
    assert.match(clip, /\[`\/acct\/p0`\]\(http:\/\/127\.0\.0\.1:4173\/acct\/p0\)/);
    assert.doesNotMatch(clip, /`\/acct` —/);
  });

  it("splits accessibility vs visual by SC, including 320 overflow", () => {
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
              html: [],
              a11y: [
                {
                  source: "a11y",
                  rule: "color-contrast",
                  severity: "error",
                  message: "Elements must meet minimum color contrast ratio thresholds",
                  count: 1,
                },
                {
                  source: "a11y",
                  rule: "heading-order",
                  severity: "warning",
                  message: "Heading levels should only increase by one",
                  count: 1,
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
                {
                  source: "visual",
                  rule: "focusVisible",
                  severity: "error",
                  message: "no focus ring",
                  count: 1,
                },
                {
                  source: "visual",
                  rule: "targetSize",
                  severity: "error",
                  message: "target is 16px",
                  count: 1,
                },
                {
                  source: "visual",
                  rule: "overflow",
                  severity: "error",
                  message: "Page is 80px wider than the viewport",
                  count: 1,
                  where: "main @ 320px",
                },
                {
                  source: "visual",
                  rule: "overflow",
                  severity: "warning",
                  message: "Page is 48px wider than the viewport",
                  count: 1,
                  where: "main @ 1280px",
                },
              ],
              runtime: [],
            },
          ],
        },
      },
      "/tmp/findings.md",
    );
    const a11y = md.slice(md.indexOf("## Accessibility"), md.indexOf("## Visual"));
    const visual = md.slice(md.indexOf("## Visual"), md.indexOf("## Quality") === -1 ? md.length : md.indexOf("## Quality"));
    assert.match(a11y, /`color-contrast`/);
    assert.match(a11y, /\*\*AXE color-contrast\*\*/);
    assert.match(a11y, /`focusVisible`/);
    assert.match(a11y, /`targetSize`/);
    assert.match(a11y, /1\.4\.10/);
    assert.match(a11y, /`overflow`/);
    assert.match(a11y, /Checked: WCAG 2\.0\/2\.1 A and AA/);
    assert.match(a11y, /Not checked:.*2\.5\.7.*AAA/);
    assert.match(a11y, /Fails on covered SCs: A — 0 rules; AA — 4 rules\./);
    assert.doesNotMatch(a11y, /meets AA/i);
    assert.match(a11y, /`heading-order`/);
    assert.match(visual, /`overlap`/);
    assert.match(visual, /\*\*Overlap\*\*/);
    assert.match(visual, /@ 1280px/);
    assert.doesNotMatch(visual, /`focusVisible`/);
    assert.doesNotMatch(visual, /`targetSize`/);
    assert.doesNotMatch(visual, /@ 320px/);
  });

  it("fallback summary includes start-here, not only a count line", () => {
    const md = renderFindingsReport(
      [],
      {
        url: "http://127.0.0.1:4173/",
        generatedAt: "t",
        runIds: ["r"],
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
                },
              ],
              a11y: [],
              visual: [],
              runtime: [],
            },
            {
              path: "/vendors",
              foundAt: "t",
              html: [
                {
                  source: "html",
                  rule: "no-multiple-main",
                  severity: "error",
                  message: "dup main",
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
    assert.match(md, /0 findings from 1 run \(none\)/);
    assert.match(md, /### Start here/);
    assert.match(md, /Fix `no-multiple-main`/);
    const summary = md.slice(md.indexOf("## Summary"), md.indexOf("## Findings"));
    assert.ok(summary.includes("Start here"));
  });

  it("uses a brain summary when valid and falls back when JSON is invalid", async () => {
    const cases: Parameters<typeof renderFindingsReport>[0] = [
      caseOf({
        id: "fnd_1_visualIssue",
        runId: "r",
        runDir: "/tmp",
        finding: {
          schemaVersion: 1,
          id: "fnd_1_visualIssue",
          kind: "visualIssue",
          message: "overlap",
          tapePath: "/tmp/x",
          stepIndex: 1,
        },
        severity: "suggestion",
        title: "overlap",
        description: "overlap",
        tape: "screenshot ui overlap\n",
      }),
    ];
    const config = {
      url: "http://127.0.0.1:4173/",
      intro: [],
      writePolicy: "validationOnly" as const,
      map: { schemaVersion: 1 as const, app: "x", generation: 0, pages: [] },
      brain: { baseUrl: "http://127.0.0.1:9", model: "mock" },
    };
    const ok = await enrichWithBrain(cases, config, async () =>
      JSON.stringify({
        summary: "The shell overlap is the thing to fix first.",
        items: [
          {
            id: "r/fnd_1_visualIssue",
            title: "Header buttons sit on top of each other.",
            expected: "Buttons stay apart.",
            actual: "They share pixels.",
            why: "Users miss the account menu.",
          },
        ],
      }),
    );
    const withBrain = renderFindingsReport(
      cases,
      { url: "http://127.0.0.1:4173/", generatedAt: "t", runIds: ["r"] },
      "/tmp/findings.md",
      ok.extras,
      ok.summary,
    );
    assert.match(withBrain, /The shell overlap is the thing to fix first\./);
    assert.match(withBrain, /Header buttons sit on top of each other\./);
    assert.match(withBrain, /Users miss the account menu/);
    assert.doesNotMatch(withBrain, /A human or charter marked this screenshot/);
    const bad = await enrichWithBrain(cases, config, async () => `{ "summary": "x", "items": [`);
    const fallback = renderFindingsReport(
      cases,
      { url: "http://127.0.0.1:4173/", generatedAt: "t", runIds: ["r"] },
      "/tmp/findings.md",
      bad.extras.size ? bad.extras : undefined,
      bad.summary || undefined,
    );
    assert.match(fallback, /1 finding from 1 run/);
    assert.match(fallback, /### Start here/);
    assert.doesNotMatch(fallback, /The shell overlap is the thing to fix first/);
  });

  it("splits mixed overflow where into 320 accessibility and 1280 visual", () => {
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
              path: "/a",
              foundAt: "t",
              html: [],
              a11y: [],
              visual: [
                {
                  source: "visual",
                  rule: "overflow",
                  severity: "error",
                  message: "Page is 80px wider than the viewport",
                  count: 2,
                  where: "header · main @ 320px · footer @ 375px",
                },
              ],
              runtime: [],
            },
            {
              path: "/b",
              foundAt: "t",
              html: [],
              a11y: [],
              visual: [
                {
                  source: "visual",
                  rule: "overflow",
                  severity: "error",
                  message: "Page is 80px wider than the viewport",
                  count: 1,
                  where: "nav",
                },
              ],
              runtime: [],
            },
          ],
        },
      },
      "/tmp/findings.md",
    );
    const a11y = md.slice(md.indexOf("## Accessibility"), md.indexOf("## Visual"));
    const visual = md.slice(md.indexOf("## Visual"));
    assert.match(a11y, /1\.4\.10/);
    assert.match(a11y, /`overflow`/);
    assert.match(a11y, /main @ 320px/);
    assert.doesNotMatch(a11y, /@ 375px/);
    assert.match(visual, /`overflow`/);
    assert.match(visual, /@ 375px/);
    assert.match(visual, /header/);
    assert.doesNotMatch(visual, /@ 320px/);
  });

  it("cross-links a visualIssue card to the catalog label", () => {
    const md = renderFindingsReport(
      [
        caseOf({
          id: "fnd_2_visualIssue",
          runId: "r",
          runDir: "/tmp",
          finding: {
            schemaVersion: 1,
            id: "fnd_2_visualIssue",
            kind: "visualIssue",
            message:
              "overlap: Header controls occupy the same pixels — folder_open Clients",
            tapePath: "/tmp/x",
            stepIndex: 2,
            widgetRef: "overlap",
          },
          severity: "minor",
          title: "overlap: Header controls occupy the same pixels",
          description: "overlap",
          tape: "screenshot ui overlap\n",
        }),
      ],
      {
        url: "http://127.0.0.1:4173/",
        generatedAt: "t",
        runIds: ["r"],
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
    assert.match(md, /see Overlap/);
    const locAt = md.indexOf("`visualIssue` · minor · `fnd_2_visualIssue`");
    const seeAt = md.indexOf("see Overlap");
    assert.ok(seeAt > 0 && locAt > seeAt, "see-link before loc line");
  });

  it("cross-links mixed overflow visualIssue tapes to reflow and overflow tags", () => {
    const md = renderFindingsReport(
      [
        caseOf({
          id: "fnd_2_visualIssue",
          runId: "r",
          runDir: "/tmp",
          finding: {
            schemaVersion: 1,
            id: "fnd_2_visualIssue",
            kind: "visualIssue",
            message:
              "overflow: Page is 80px wider than the viewport — header · main @ 320px · footer @ 375px",
            tapePath: "/tmp/x",
            stepIndex: 2,
            widgetRef: "overflow",
          },
          severity: "minor",
          title: "overflow: Page is 80px wider than the viewport",
          description: "overflow",
          tape: "screenshot ui overflow\n",
        }),
      ],
      {
        url: "http://127.0.0.1:4173/",
        generatedAt: "t",
        runIds: ["r"],
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
                  rule: "overflow",
                  severity: "error",
                  message: "Page is 80px wider than the viewport",
                  count: 1,
                  where: "header · main @ 320px · footer @ 375px",
                },
              ],
              runtime: [],
            },
          ],
        },
      },
      "/tmp/findings.md",
    );
    assert.match(md, /see WCAG 1\.4\.10 Reflow/);
    assert.match(md, /see Overflow/);
    const see = md.slice(md.indexOf("see WCAG 1.4.10 Reflow"), md.indexOf("`visualIssue`"));
    assert.match(see, /see WCAG 1\.4\.10 Reflow · see Overflow/);
  });

  it("explains squished headers and empty typeaheads in Expected/Actual", () => {
    const squish = renderFindingsReport(
      [
        caseOf({
          id: "fnd_13_visualIssue",
          runId: "r",
          runDir: "/tmp",
          finding: {
            schemaVersion: 1,
            id: "fnd_13_visualIssue",
            kind: "visualIssue",
            message:
              "clip: BILLABLE and DESCRIPTION headers are squished together — BILLABLE · DESCRIPTION in Distribution lines",
            tapePath: "/tmp/x",
            stepIndex: 13,
            widgetRef: "clip",
          },
          severity: "major",
          title:
            "clip: BILLABLE and DESCRIPTION headers are squished together — BILLABLE · DESCRIPTION in Distribution lines",
          description: "clip",
          tape: "screenshot ui clip\n",
        }),
      ],
      { url: "http://127.0.0.1:4173/", generatedAt: "t", runIds: ["r"] },
      "/tmp/findings.md",
    );
    assert.match(squish, /BILLABLE and DESCRIPTION headers are squished together/);
    assert.match(squish, /\*\*Expected:\*\* Each column header is readable in its own column\./);
    const empty = renderFindingsReport(
      [
        caseOf({
          id: "fnd_22_expectFailed",
          runId: "r",
          runDir: "/tmp",
          finding: {
            schemaVersion: 1,
            id: "fnd_22_expectFailed",
            kind: "expectFailed",
            message: 'Select a matter: no matching options for "beatus bos"',
            tapePath: "/tmp/x",
            stepIndex: 22,
            widgetRef: "page.lineitems_0__matterid",
          },
          severity: "major",
          title: 'Select a matter: no matching options for "beatus bos"',
          description: "typeahead",
          tape: "fill page.lineitems_0__matterid \"beatus bos\"\n",
        }),
      ],
      { url: "http://127.0.0.1:4173/", generatedAt: "t", runIds: ["r"] },
      "/tmp/findings.md",
    );
    assert.match(empty, /\*\*Expected:\*\* The typeahead shows options we can pick\./);
    assert.match(empty, /\*\*Actual:\*\* Select a matter: no matching options for "beatus bos"/);
    assert.doesNotMatch(empty, /The field is marked invalid/);
  });

  it("labels a silent Save expectFailed as WCAG 3.3.1 Error Identification, not a quality leftover", () => {
    const message =
      "Save did not submit the form: no navigation, no write request, and no invalid fields were shown";
    const md = renderFindingsReport(
      [
        caseOf({
          id: "fnd_8_expectFailed",
          runId: "r",
          runDir: "/tmp",
          finding: {
            schemaVersion: 1,
            id: "fnd_8_expectFailed",
            kind: "expectFailed",
            message,
            tapePath: "/tmp/x",
            stepIndex: 8,
            widgetRef: "page.button_save",
            url: "http://127.0.0.1:4173/vouchers/new",
          },
          severity: "major",
          title: message,
          description: message,
          tape: "click page.button_save\n",
          url: "http://127.0.0.1:4173/vouchers/new",
        }),
      ],
      { url: "http://127.0.0.1:4173/", generatedAt: "t", runIds: ["r"] },
      "/tmp/findings.md",
    );
    assert.match(md, /\*\*WCAG 3\.3\.1 Error Identification\*\*/);
    assert.match(md, /3\.3\.1/);
    assert.match(md, /`silentSubmit`/);
    assert.match(md, /see WCAG 3\.3\.1 Error Identification/);
    assert.match(md, /\*\*Expected:\*\* Save submits, navigates, or shows invalid fields\./);
    assert.doesNotMatch(md, /The field is marked invalid/);
    assert.doesNotMatch(md, /\*\*Q-1\*\* `silentSubmit`/);
  });

  it("labels a write 409 as Q-01 serverRefusedSubmit, not a generic httpError leftover", () => {
    const message = "HTTP 409 POST https://app/api/vouchers: Vendor has status Blacklisted";
    const md = renderFindingsReport(
      [
        caseOf({
          id: "fnd_22_httpError",
          runId: "r",
          runDir: "/tmp",
          finding: {
            schemaVersion: 1,
            id: "fnd_22_httpError",
            kind: "httpError",
            message,
            tapePath: "/tmp/x",
            stepIndex: 22,
            httpStatus: 409,
            url: "http://127.0.0.1:4173/vouchers/new",
          },
          severity: "critical",
          title: message,
          description: message,
          tape: "click page.button_save\n",
          url: "http://127.0.0.1:4173/vouchers/new",
        }),
      ],
      { url: "http://127.0.0.1:4173/", generatedAt: "t", runIds: ["r"] },
      "/tmp/findings.md",
    );
    assert.match(md, /\*\*Server refused submit\*\*/);
    assert.match(md, /`serverRefusedSubmit`/);
    assert.match(md, /see Server refused submit/);
    assert.match(md, /findings\/Q-01/);
    assert.match(md, /\*\*Expected:\*\* The UI only sends values the server will store\./);
    assert.doesNotMatch(md, /The resource loads/);
    assert.doesNotMatch(md, /\*\*Q-01\*\* `serverRefusedSubmit`/);
    assert.doesNotMatch(md, /\*\*Q-1\*\*/);
  });

  it("labels accepted empty/junk as Q-02 acceptedInvalid", () => {
    const message = "Required field `page.name` accepted empty";
    const md = renderFindingsReport(
      [
        caseOf({
          id: "fnd_9_expectFailed",
          runId: "r",
          runDir: "/tmp",
          finding: {
            schemaVersion: 1,
            id: "fnd_9_expectFailed",
            kind: "expectFailed",
            message,
            tapePath: "/tmp/x",
            stepIndex: 9,
            widgetRef: "page.name",
            url: "http://127.0.0.1:4173/clients/new",
          },
          severity: "major",
          title: message,
          description: message,
          tape: "fill page.name \"\"\nclick page.button_save\n",
          url: "http://127.0.0.1:4173/clients/new",
        }),
      ],
      { url: "http://127.0.0.1:4173/", generatedAt: "t", runIds: ["r"] },
      "/tmp/findings.md",
    );
    assert.match(md, /\*\*Invalid input accepted\*\*/);
    assert.match(md, /`acceptedInvalid`/);
    assert.match(md, /see Invalid input accepted/);
    assert.match(md, /findings\/Q-02/);
    assert.match(md, /\*\*Expected:\*\* The field is marked invalid\./);
    assert.doesNotMatch(md, /\*\*Q-02\*\* `acceptedInvalid`/);
  });

  it("labels a junk-crash pageError as Q-03 throwInsteadOfInvalid", () => {
    const message =
      "ClickMonkey had just filled `page.from_date` with \"%00\". The page threw an uncaught JS error instead of rejecting the input. That means validation is missing or does not wrap parsing.";
    const md = renderFindingsReport(
      [
        caseOf({
          id: "fnd_3_pageError",
          runId: "r",
          runDir: "/tmp",
          finding: {
            schemaVersion: 1,
            id: "fnd_3_pageError",
            kind: "pageError",
            message,
            tapePath: "/tmp/x",
            stepIndex: 3,
            widgetRef: "page.from_date",
            url: "http://127.0.0.1:4173/clients/new",
          },
          severity: "critical",
          title: "Uncaught JavaScript error: Invalid time value",
          description: message,
          tape: "fill page.from_date \"%00\"\n",
          url: "http://127.0.0.1:4173/clients/new",
        }),
      ],
      { url: "http://127.0.0.1:4173/", generatedAt: "t", runIds: ["r"] },
      "/tmp/findings.md",
    );
    assert.match(md, /\*\*Threw instead of invalid\*\*/);
    assert.match(md, /`throwInsteadOfInvalid`/);
    assert.match(md, /see Threw instead of invalid/);
    assert.match(md, /findings\/Q-03/);
    assert.match(md, /\*\*Expected:\*\* The page stays usable, and junk in a field shows as a field error\./);
    assert.doesNotMatch(md, /\*\*Q-03\*\* `throwInsteadOfInvalid`/);
  });
});
