import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHECKS, FINDINGS_SITE } from "../src/reports/check-catalog.js";
import { QA_LEFT } from "../src/reports/qa-left.js";
import { specLink } from "../src/reports/spec-links.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs", "findings");
mkdirSync(outDir, { recursive: true });

function pageMarkdown(check: (typeof CHECKS)[number]): string {
  const spec = specLink(check.rule);
  const specLine = spec ? `[${spec.label}](${spec.href})` : "ClickMonkey catalog (no WCAG/HTML spec URL).";
  return `---
title: "${check.id} ${check.title}"
permalink: /findings/${check.id}/
---

# ${check.id} — ${check.title}

**Chapter:** ${check.chapter}${check.sc ? ` · WCAG ${check.sc} ${check.level ?? ""}`.trimEnd() : ""}  
**Rule:** \`${check.rule}\`  
**Spec:** ${specLine}

${check.summary}

${check.detail}

This id is **stable**. Reports link here so T/V/Q classes (and A-2.1.1) do not shuffle when a soak ranks differently.
`;
}

for (const check of CHECKS) {
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

# Finding catalog

Stable ids for ClickMonkey-owned checks. Accessibility axe hits use **A-{SC}** (WCAG Understanding). HTML-validate keeps its own rule URLs. These pages cover testability, visual, quality, and keyboard extras (2.1.1, 2.1.2, 2.4.3).

**Human leftover:** [What a person still tests](qa-left/) — WCAG 2.2 A/AA the walker does not run.

| Id | Rule | Chapter |
|---|---|---|
${CHECKS.map((c) => `| [${c.id}](${c.id}/) | \`${c.rule}\` | ${c.chapter} |`).join("\n")}

Site: ${FINDINGS_SITE}/findings/
`;
writeFileSync(join(outDir, "index.md"), index);
console.log(`wrote ${CHECKS.length + 2} pages under docs/findings/`);
