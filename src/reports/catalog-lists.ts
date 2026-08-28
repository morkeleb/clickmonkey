import { CHECKS, catalogIdFor, catalogPageHref, checkByRule } from "./check-catalog.js";
import { HTMLVALIDATE_RULES, specLink } from "./spec-links.js";
import { DOM_WCAG_RULES, enabledAxeRules, wcagOf } from "./wcag.js";

export const CATALOG_LISTS = ["clickmonkey", "axe", "wcag", "html-validate", "html"] as const;
export type CatalogListId = (typeof CATALOG_LISTS)[number];

export type CatalogListRow = {
  list: CatalogListId;
  rule: string;
  /** ClickMonkey catalog id when we own a page (`T-01`, `A-2.1.1`). */
  id?: string;
  chapter?: string;
  title: string;
  /** Original spec URL (W3C, Deque, html-validate, HTML, or our catalog). */
  href: string;
  sc?: string;
  level?: string;
};

const HTML_SPEC_RULES = ["implicitSubmit", "noopener"] as const;

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

/** Catalog handle for an axe Check (`axe-color-contrast`). */
export function axePageId(rule: string): string {
  return `axe-${rule}`;
}

export function axeRows(): CatalogListRow[] {
  return enabledAxeRules()
    .sort((a, b) => a.localeCompare(b))
    .map((rule) => {
      const spec = mustSpec(rule);
      return {
        list: "axe" as const,
        rule,
        id: axePageId(rule),
        title: spec.label,
        href: spec.href,
        ...scBits(rule),
      };
    });
}

export function wcagRows(): CatalogListRow[] {
  return DOM_WCAG_RULES.map((rule) => {
    const spec = mustSpec(rule);
    const id = catalogIdFor(rule);
    return {
      list: "wcag" as const,
      rule,
      title: spec.label,
      href: spec.href,
      ...(id ? { id } : {}),
      ...scBits(rule),
    };
  }).sort((a, b) => (a.sc ?? a.rule).localeCompare(b.sc ?? b.rule, undefined, { numeric: true }));
}

/** Catalog handle for an html-validate Check (`html-validate-no-dup-id`). */
export function htmlValidatePageId(rule: string): string {
  return `html-validate-${rule}`;
}

export function htmlValidateRows(): CatalogListRow[] {
  return HTMLVALIDATE_RULES.map((rule) => {
    const spec = mustSpec(rule);
    return {
      list: "html-validate" as const,
      rule,
      id: htmlValidatePageId(rule),
      title: spec.label,
      href: spec.href,
    };
  });
}

export function htmlRows(): CatalogListRow[] {
  return HTML_SPEC_RULES.map((rule) => {
    const spec = mustSpec(rule);
    const owned = checkByRule(rule);
    return {
      list: "html" as const,
      rule,
      title: spec.label,
      href: spec.href,
      ...(owned ? { id: owned.id } : {}),
    };
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

Rules this walker reports, grouped by who owns the spec. Original pages are in the other lists; ClickMonkey pages are only for classes we named.

- [ClickMonkey](#clickmonkey) — T/V/Q classes we own
- [AXE](#axe) — axe-core 4.13 ([rule list](https://dequeuniversity.com/rules/axe/4.13))
- [WCAG](#wcag) — DOM checks we run (not axe)
- [html-validate](#html-validate) — HTML authoring
- [HTML](#html) — WHATWG
- [What a person still tests](qa-left/) — leftover WCAG 2.2 A/AA

## ClickMonkey

These pages are the spec. Reports link here so T/V/Q ids do not shuffle.

${mdTable(
    ["Id", "Rule", "Chapter", "Title"],
    ours.map((r) => [ourPage(r), `\`${r.rule}\``, r.chapter ?? "", r.title]),
  )}

## AXE

axe-core after inspect (\`wcag2a\` / \`wcag2aa\` / \`wcag21a\` / \`wcag21aa\` plus extras). Reports tag these as **AXE {rule}**. Original: [axe 4.13](https://dequeuniversity.com/rules/axe/4.13).

${mdTable(
    ["Check", "Rule", "Original", "SC"],
    axe.map((r) => [`[${r.title}](${r.id}/)`, `\`${r.rule}\``, originalLink(r), scCell(r)]),
  )}

## WCAG

DOM detectors ClickMonkey runs itself. Original: W3C Understanding. \`A-*\` is only a handle when we also have a catalog page.

${mdTable(
    ["Check", "Rule", "Original"],
    wcag.map((r) => [
      r.id ? `[${r.title}](${r.id}/)` : r.title,
      `\`${r.rule}\``,
      originalLink(r),
    ]),
  )}

## html-validate

html-validate:standard after inspect. Reports tag these as **html-validate {rule}**. Original: [html-validate rules](https://html-validate.org/rules/).

${mdTable(
    ["Check", "Rule", "Original"],
    htmlv.map((r) => [`[${r.title}](${r.id}/)`, `\`${r.rule}\``, originalLink(r)]),
  )}

## HTML

Original: [HTML Living Standard](https://html.spec.whatwg.org/multipage/).

${mdTable(
    ["Check", "Rule", "Original"],
    html.map((r) => [
      r.id ? `[${r.title}](${r.id}/)` : r.title,
      `\`${r.rule}\``,
      originalLink(r),
    ]),
  )}
`;
}
