import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { axePageId, catalogIndexMarkdown, htmlValidatePageId } from "../src/reports/catalog-lists.js";
import { catalogIdFor, CHECKS, FINDINGS_SITE } from "../src/reports/check-catalog.js";
import { mustCheck } from "../src/reports/check.js";
import { QA_LEFT } from "../src/reports/qa-left.js";
import { HTMLVALIDATE_RULES, specLink, wcagUnderstandingHref } from "../src/reports/spec-links.js";
import { DOM_WCAG_RULES, enabledAxeRules } from "../src/reports/wcag.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs", "findings");
mkdirSync(outDir, { recursive: true });

function pageMarkdown(check: (typeof CHECKS)[number]): string {
  const spec = specLink(check.rule);
  const wcagHref = check.sc ? wcagUnderstandingHref(check.sc) : undefined;
  if (check.sc && !wcagHref) {
    throw new Error(`${check.id} (${check.rule}) has SC ${check.sc} but no WCAG Understanding URL`);
  }
  const specLine = wcagHref
    ? `**WCAG:** [${spec?.label ?? `WCAG ${check.sc}`}](${wcagHref}) — official. ClickMonkey detects this SC as \`${check.rule}\`.`
    : spec
      ? `**Spec:** [${spec.label}](${spec.href})`
      : "**Spec:** ClickMonkey catalog (no WCAG/HTML spec URL).";
  const footer = wcagHref
    ? `${check.id} is only a handle for “we found ${check.sc}.” The requirement is the W3C page, not this catalog.`
    : "This id is **stable**. Reports link here so T/V/Q classes do not shuffle when a soak ranks differently.";
  return `---
title: "${check.id} ${check.title}"
permalink: /findings/${check.id}/
---

# ${check.id} — ${check.title}

**Chapter:** ${check.chapter}${check.sc ? ` · WCAG ${check.sc} ${check.level ?? ""}`.trimEnd() : ""}  
**Rule:** \`${check.rule}\`  
${specLine}

${check.summary}

${check.detail}

${footer}
`;
}

for (const check of CHECKS) {
  writeFileSync(join(outDir, `${check.id}.md`), pageMarkdown(check));
}

function htmlValidatePageMarkdown(rule: string): string {
  const check = mustCheck(rule);
  const id = htmlValidatePageId(rule);
  return `---
title: "${check.title}"
permalink: /findings/${id}/
---

# ${check.title}

**Chapter:** ${check.chapter}  
**Rule:** \`${check.rule}\`  
**html-validate:** [${check.title}](${check.href}) — official.

${check.why}

This handle is only “we found \`${check.rule}\`.” The requirement is the html-validate page, not this catalog.
`;
}

for (const rule of HTMLVALIDATE_RULES) {
  const id = htmlValidatePageId(rule);
  writeFileSync(join(outDir, `${id}.md`), htmlValidatePageMarkdown(rule));
}

function officialPageMarkdown(
  rule: string,
  id: string,
  specKind: "axe" | "WCAG",
): string {
  const check = mustCheck(rule);
  const specLabel = specKind === "axe" ? "axe" : "WCAG";
  return `---
title: "${check.title}"
permalink: /findings/${id}/
---

# ${check.title}

**Chapter:** ${check.chapter}${check.sc ? ` · WCAG ${check.sc} ${check.level ?? ""}`.trimEnd() : ""}  
**Rule:** \`${check.rule}\`  
**${specLabel}:** [${check.title}](${check.href}) — official.

${check.why}

This handle is only “we found \`${check.rule}\`.” The requirement is the ${specKind === "axe" ? "Deque" : "W3C"} page, not this catalog.
`;
}

for (const rule of enabledAxeRules()) {
  const id = axePageId(rule);
  writeFileSync(join(outDir, `${id}.md`), officialPageMarkdown(rule, id, "axe"));
}

const writtenIds = new Set(CHECKS.map((c) => c.id));
for (const rule of DOM_WCAG_RULES) {
  const id = catalogIdFor(rule);
  if (!id || writtenIds.has(id)) continue;
  writtenIds.add(id);
  writeFileSync(join(outDir, `${id}.md`), officialPageMarkdown(rule, id, "WCAG"));
}

const qaRows = QA_LEFT.map(
  (item) =>
    `| ${item.sc} ${item.level} | ${item.title} | ${item.why} | ${item.qa} |`,
).join("\n");

const qaLeft = `---
title: "What a person still tests"
permalink: /findings/qa-left/
---

# What a person still tests

ClickMonkey soaks chrome, locators, HTML/axe, form Tab (2.1.2 trap, 2.4.3 order), and the layout extras. It does **not** replace someone who knows the product. This page is the leftover **WCAG 2.2 A/AA** list — use it as a session checklist on a real flow.

2.1.2 and 2.4.3 are **not** here: a form Tab walk covers those ([A-2.1.2](../A-2.1.2/), [A-2.4.3](../A-2.4.3/)). AAA is out of scope.

| SC | Gap | Why the walker skips it | What you do |
|---|---|---|---|
${qaRows}

Catalog: [finding ids](../)
`;
writeFileSync(join(outDir, "qa-left.md"), qaLeft);

const index = `---
title: Finding catalog
permalink: /findings/
---

${catalogIndexMarkdown().trim()}

Site: ${FINDINGS_SITE}/findings/
`;
writeFileSync(join(outDir, "index.md"), index);
console.log(`wrote finding pages under docs/findings/`);
