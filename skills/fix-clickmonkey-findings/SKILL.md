---
name: fix-clickmonkey-findings
description: >
  Fix product bugs from a ClickMonkey report and prove them with replay of the
  same tape (same fills). Use after a walk writes findings, or when the user
  asks to patch, remediate, or verify ClickMonkey findings, ik_ keys, or a
  findings.md report. Slash command /fix-clickmonkey-findings.
license: MIT
metadata:
  homepage: https://github.com/morkeleb/clickmonkey
---

# Fix ClickMonkey findings and replay the tape

Work in the **application** repo. The preview/staging URL in `clickmonkey.json` must still be up.

## 1. Triage

Read the newest `clickmonkey/reports/<id>/findings.md`. Each open card has an `ik_…` (the bug) and `fnd_*` (that run’s folder).

Evidence is `clickmonkey/runs/<runId>/findings/<fnd_id>/`: `finding.json`, `report.md`, screenshot, `replay.log`.

Order by severity on the report (critical → suggestion). Skip harness noise unless the user asks: `unknownId`, `unresolvedId`, `driftId`, fence bounce, walker screenshot notes. `clickmonkey prune <reportId> --ids ik_…` if those are false positives — that does not patch the product.

`## Fixed` is already replay-confirmed. Do not re-fix those unless a later walk filed the same `ik_` again.

## 2. Patch the product

Fix the **root cause** in app code, not one payload. Keep the diff small. Do not invent ClickMonkey widget ids or edit `clickmonkey/map.json` for a product bug.

A 404 room that should leave the sitemap is `clickmonkey pages`, not a code fix.

## 3. Prove it with the same fills

A later `unleash` / `nasty` / `explore` land is **not** a retest — those walks type different values.

```bash
clickmonkey replay clickmonkey/reports/<id>/findings.md --url "$URL"
```

- **FIXED** — same tape did not reproduce; `ik_` goes into `clickmonkey/fixed.json`.
- **STILL** — bug came back (clears a prior fixed mark). Iterate.
- **LOOK** — compare before/after shots (`screenshot ui`); a person decides.
- **ERROR** — tape could not run (setup, unknown id). Fix the leash/map, not the product.

Exit `1` on STILL or ERROR. Next `clickmonkey report --all --quality-full` moves replay-FIXED cards to **Fixed** unless a later walk files that `ik_` again.

Optional: run the app’s own tests so the patch does not break behavior.

## 4. Report

Per finding: `ik_`, what you changed (file), replay verdict. No secrets in the write-up.
