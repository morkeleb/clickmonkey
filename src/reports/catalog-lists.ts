import { CHECKS, catalogPageHref } from "./check-catalog.js";
import { HTMLVALIDATE_RULES, specLink } from "./spec-links.js";
import { DOM_WCAG_RULES, enabledAxeRules, wcagOf } from "./wcag.js";

export const CATALOG_LISTS = ["clickmonkey", "axe", "wcag", "html-validate", "html"] as const;
export type CatalogListId = (typeof CATALOG_LISTS)[number];

export type CatalogListRow = {
  list: CatalogListId;
  rule: string;
  /** ClickMonkey catalog id when we own the spec (`T-01`). Absent when Original is canonical. */
  id?: string;
  chapter?: string;
  title: string;
  /** Original spec URL (W3C, Deque, html-validate, HTML, or our catalog). */
  href: string;
  sc?: string;
  level?: string;
};

export const HTML_SPEC_RULES = ["implicitSubmit", "noopener"] as const;

function mustSpec(rule: string): { label: string; href: string } {
  const spec = specLink(rule);
  if (!spec) throw new Error(`catalog list: no original URL for ${rule}`);
  return spec;
}

function scBits(rule: string, extras?: Parameters<typeof wcagOf>[1]) {
  const wcag = wcagOf(rule, extras);
  return {
    ...(wcag.sc ? { sc: wcag.sc } : {}),
    ...(wcag.level ? { level: wcag.level } : {}),
  };
}

const HTML_SPEC_SET = new Set<string>(HTML_SPEC_RULES);

/** ClickMonkey-owned product classes. HTML/WCAG rows live in those lists. */
export function clickmonkeyRows(): CatalogListRow[] {
  return CHECKS.filter((c) => !("sc" in c && c.sc) && !HTML_SPEC_SET.has(c.rule)).map((c) => ({
    list: "clickmonkey" as const,
    rule: c.rule,
    id: c.id,
    chapter: c.chapter,
    title: c.title,
    href: catalogPageHref(c.id),
  }));
}

export function axeRows(): CatalogListRow[] {
  return enabledAxeRules()
    .sort((a, b) => a.localeCompare(b))
    .map((rule) => {
      const spec = mustSpec(rule);
      return { list: "axe" as const, rule, title: spec.label, href: spec.href, ...scBits(rule) };
    });
}

export function wcagRows(): CatalogListRow[] {
  return DOM_WCAG_RULES.map((rule) => {
    const spec = mustSpec(rule);
    return { list: "wcag" as const, rule, title: spec.label, href: spec.href, ...scBits(rule) };
  }).sort((a, b) => (a.sc ?? a.rule).localeCompare(b.sc ?? b.rule, undefined, { numeric: true }));
}

export function htmlValidateRows(): CatalogListRow[] {
  return HTMLVALIDATE_RULES.map((rule) => {
    const spec = mustSpec(rule);
    return { list: "html-validate" as const, rule, title: spec.label, href: spec.href };
  });
}

export function htmlRows(): CatalogListRow[] {
  return HTML_SPEC_RULES.map((rule) => {
    const spec = mustSpec(rule);
    return { list: "html" as const, rule, title: spec.label, href: spec.href };
  });
}

export function catalogListRows(): CatalogListRow[] {
  return [...clickmonkeyRows(), ...axeRows(), ...wcagRows(), ...htmlValidateRows(), ...htmlRows()];
}

function mdTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((cells) => `| ${cells.join(" | ")} |`),
  ].join("\n");
}

function ourPage(row: CatalogListRow): string {
  return row.id ? `[${row.id}](${row.id}/)` : "";
}

function originalLink(row: CatalogListRow): string {
  return `[${row.title}](${row.href})`;
}

function scCell(row: CatalogListRow): string {
  if (!row.sc) return "—";
  return row.level ? `${row.sc} ${row.level}` : row.sc;
}

/** Markdown body for docs/findings/index.md (no front matter). */
export function catalogIndexMarkdown(): string {
  const ours = clickmonkeyRows();
  const axe = axeRows();
  const wcag = wcagRows();
  const htmlv = htmlValidateRows();
  const html = htmlRows();
  return `# Finding catalog

Rules this walker reports. ClickMonkey pages exist only when there is no official spec. AXE, WCAG, html-validate, and HTML link the canonical page — we do not republish it.

- [ClickMonkey](#clickmonkey) — classes we named
- [AXE](#axe) — [axe 4.13](https://dequeuniversity.com/rules/axe/4.13)
- [WCAG](#wcag) — DOM checks we run (not axe)
- [html-validate](#html-validate) — [html-validate rules](https://html-validate.org/rules/)
- [HTML](#html) — [HTML Living Standard](https://html.spec.whatwg.org/multipage/)
- [What a person still tests](qa-left/) — leftover WCAG 2.2 A/AA

## ClickMonkey

These pages are the spec. No W3C / Deque / html-validate / WHATWG page covers them.

${mdTable(
    ["Id", "Rule", "Chapter", "Title"],
    ours.map((r) => [ourPage(r), `\`${r.rule}\``, r.chapter ?? "", r.title]),
  )}

## AXE

axe-core after inspect (\`wcag2a\` / \`wcag2aa\` / \`wcag21a\` / \`wcag21aa\` plus extras). Reports tag **AXE {rule}**.

${mdTable(
    ["Check", "Rule", "SC"],
    axe.map((r) => [originalLink(r), `\`${r.rule}\``, scCell(r)]),
  )}

## WCAG

DOM detectors ClickMonkey runs itself. Reports tag **WCAG {sc}**. The W3C Understanding page is the spec.

${mdTable(
    ["Check", "Rule"],
    wcag.map((r) => [originalLink(r), `\`${r.rule}\``]),
  )}

## html-validate

html-validate:standard after inspect. Reports tag **html-validate {rule}**.

${mdTable(
    ["Check", "Rule"],
    htmlv.map((r) => [originalLink(r), `\`${r.rule}\``]),
  )}

## HTML

Reports tag the WHATWG name. \`implicitSubmit\` / \`noopener\` are how we detect them.

${mdTable(
    ["Check", "Rule"],
    html.map((r) => [originalLink(r), `\`${r.rule}\``]),
  )}
`;
}
