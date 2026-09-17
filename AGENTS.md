# ClickMonkey — agent guide

ClickMonkey maps a site and drives it through a line DSL. This file is for coding agents that want to **run** it against an app, **fix** its findings, or **wire CI**.

Install the skills:

```bash
npx skills add morkeleb/clickmonkey
```

- `walk-with-clickmonkey` — init/map/unleash or explore a live URL, then `report --all --quality-full`
- `fix-clickmonkey-findings` — patch product bugs; prove with `clickmonkey replay` of the same tape (not another unleash)
- `add-clickmonkey-ci` — GitHub Actions / GitLab on a preview URL

Work in the **application** folder (`clickmonkey.json` leash). Login is leash `intro` + `$CLICKMONKEY_*`, not the charter.

Two ways to walk:

- **CLI (this is the default for agents):** `map` / `unleash` / `explore` / `report` / `replay`. Headless. Use `--all` and `--quality-full` so nothing prompts.
- **MCP:** `clickmonkey mcp` when the host should click along, then `spec_save` / `spec_run`. See [docs/mcp.md](docs/mcp.md).

Exit codes: `0` clean, `1` findings, `2` setup, `3` live `ready` failed.

`--nasty` only on a site the user owns.

Docs: [README.md](README.md), [docs/walkers.md](docs/walkers.md), [docs/issue-classes.md](docs/issue-classes.md).
