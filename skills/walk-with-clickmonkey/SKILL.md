---
name: walk-with-clickmonkey
description: >
  Walk a live web app with ClickMonkey — map rooms, fill forms, write a findings
  report. Use when the user wants to run ClickMonkey, walk a preview/staging URL,
  map a site, unleash/explore, or collect UI findings. Slash command /walk-with-clickmonkey.
license: MIT
metadata:
  homepage: https://github.com/morkeleb/clickmonkey
---

# Walk a live URL with ClickMonkey

ClickMonkey drives a browser against **one leash URL**. Work in the **application** folder (the product under test), not the ClickMonkey git repo.

MCP (`clickmonkey mcp`) is a live host-LLM walk. This skill is the unattended CLI. Prefer CLI unless the user wants to click along.

## Preconditions

- Node 22.22+ or 24.8+. `clickmonkey` on `PATH` (`npm install -g clickmonkey`, or `npm run link` from a clone).
- Chromium: `npx playwright install chromium`.
- A **running** app URL the user owns or has permission to test.
- Login belongs in `clickmonkey.json` `intro` with `$CLICKMONKEY_*` env vars — never in the charter.

If `clickmonkey.json` is missing:

```bash
clickmonkey init --url "$URL"
```

Then put leash `intro` and `fence` in that json. Copy `examples/explore-context.md` to `clickmonkey/explore-context.md` and describe **this** site if you will run `explore`.

## Walk

Mechanical (no LLM):

```bash
clickmonkey inspect
clickmonkey map --steps 80
clickmonkey unleash --steps 200
```

Charter walk (needs `brain` in the leash + API key env):

```bash
clickmonkey explore --url "$URL" --charter "$CHARTER" --skills clickmonkey/explore-context.md --steps 40 --minutes 15
```

Charter = ticket or `git log`, not DSL. `--skills` here is **site architecture**, not this file.

`clickmonkey nasty` is the same hunt with junk payloads. Only on a site the user owns (their staging). Do not point it at anyone else's production.

Then:

```bash
clickmonkey report --all --quality-full
```

Exit codes: `0` no findings, `1` findings (the walk succeeded), `2` usage/setup (missing config, no brain, bad URL), `3` live `ready` failed before start. On `1`, keep going — read the report. On `2`/`3`, stop.

## Read results

- Newest report: `clickmonkey/reports/<id>/findings.md` (ids sort newest first).
- Per-bug folders: `clickmonkey/runs/<run>/findings/fnd_*/` (`finding.json`, `report.md`, screenshot, `replay.log`).
- Loc line `ik_…` is the bug across runs; `fnd_*` is that run’s folder.

Dashboard: `clickmonkey ui` (needs `web/dist`). Static copy: `clickmonkey bundle --out clickmonkey-bundle`.

To patch findings, use **fix-clickmonkey-findings**. To wire a pipeline, use **add-clickmonkey-ci**.

Monkeys and fog: repo `docs/walkers.md`. What it harvests: `docs/issue-classes.md`.
