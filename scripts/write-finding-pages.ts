import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogIndexMarkdown, HTML_SPEC_RULES } from "../src/reports/catalog-lists.js";
import { CHECKS, FINDINGS_SITE } from "../src/reports/check-catalog.js";
import { QA_LEFT } from "../src/reports/qa-left.js";
import { specLink } from "../src/reports/spec-links.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs", "findings");
mkdirSync(outDir, { recursive: true });

const HTML_SPEC_SET = new Set<string>(HTML_SPEC_RULES);

function pageMarkdown(check: (typeof CHECKS)[number]): string {
  const spec = specLink(check.rule);
  return `---
title: "${check.id} ${check.title}"
permalink: /findings/${check.id}/
---

# ${check.id} — ${check.title}

**Chapter:** ${check.chapter}  
**Rule:** \`${check.rule}\`  
${spec ? `**Spec:** [${spec.label}](${spec.href})` : "**Spec:** ClickMonkey catalog."}

${check.summary}

${check.detail}

This id is **stable**. Reports link here so T/V/Q classes do not shuffle when a soak ranks differently.
`;
}

for (const check of CHECKS) {
  if (check.sc || HTML_SPEC_SET.has(check.rule)) continue;
  writeFileSync(join(outDir, `${check.id}.md`), pageMarkdown(check));
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

2.1.2 and 2.4.3 are covered by the form Tab walk. Spec: [WCAG 2.1.2](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html), [WCAG 2.4.3](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html). AAA is out of scope.

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
