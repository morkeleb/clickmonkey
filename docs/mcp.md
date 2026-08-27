---
title: MCP
permalink: /mcp/
---

# MCP: host-LLM walk, then freeze a spec

Five monkeys (working names): **map**, **unleash**, **nasty**, **explore**, **mcp**.
`clickmonkey explore` is unattended exploratory testing (needs `brain`). **mcp**
is a different monkey: you (Grok, Claude, Cursor, …) walk, then freeze/replay
a spec. ClickMonkey still owns the browser, fence, map, and tape. Visits are
compact (pagemap, mode, look) — no page HTML. That compact visit is the default.
`explore_visit` with `full: true` lists every mapped widget, including disabled
Save. `explore_start` can load a sitemap other than `clickmonkey/map.json` via
`map`. `config.brain` is not required.

That freeze+replay is why you would use MCP instead of explore-only. Map,
unleash, and nasty stay CLI. Monkeys and modes: [walkers.md](walkers.md). Fog:
[fog.md](fog.md). What to harvest vs leave to QA: [issue-classes.md](issue-classes.md).

## Before you connect

From the **application** folder (the product under test, not the ClickMonkey
git repo):

```bash
clickmonkey init --url http://127.0.0.1:3000/
clickmonkey inspect
clickmonkey map --steps 40
```

`clickmonkey` must be on `PATH` (`npm run link` from this repo, or a global
install). Grow the map before the host walks — a one-page map is a thin
leash. Login belongs in `clickmonkey.json` `intro` (`$CLICKMONKEY_*`
tokens), not in a spec.

Or call `explore_init` from MCP with the same `url` if the json is missing.

## Wire the host

The stdio server is `clickmonkey mcp`. The **browser starts on
`explore_start`**, not when the MCP process connects. Playwright cold start
can exceed a 30s MCP startup timeout — raise it.

Default leash is `./clickmonkey.json` in the MCP process cwd. Pin it with
`--config /abs/path/clickmonkey.json` if cwd is wrong. The workspace is
always `dirname(that json)/clickmonkey/`.

**Grok** — put this *in the folder that has `clickmonkey.json`*:

```toml
# my-app/.grok/config.toml
[mcp_servers.clickmonkey]
command = "clickmonkey"
args = ["mcp"]
startup_timeout_sec = 60
```

Or pin the leash from `~/.grok/config.toml` if you start Grok from other
directories:

```toml
[mcp_servers.clickmonkey]
command = "clickmonkey"
args = ["mcp", "--config", "/abs/path/to/my-app/clickmonkey.json"]
startup_timeout_sec = 60
```

Then `grok mcp list` / `grok mcp doctor clickmonkey`. Open Grok with cwd in
`my-app/` (or always pass `--config`).

**Claude Code** (`~/.claude.json` or project `.mcp.json`) and **Cursor**:

```json
{
  "mcpServers": {
    "clickmonkey": {
      "command": "clickmonkey",
      "args": ["mcp"],
      "cwd": "/abs/path/to/my-app"
    }
  }
}
```

If the client has no `cwd` field, pass
`"args": ["mcp", "--config", "/abs/path/to/my-app/clickmonkey.json"]`.

Optional: from the same folder, `clickmonkey ui`. Live MCP walks show up as
a monkey on the map (`brain: mcp`). `explore_start` with `headed: true` if
you want to watch the browser.

## Skills (prompts and resources)

MCP is how ClickMonkey ships tester skill to the host. **Read the prompt
before you act.** `explore_start` prints the prompt names and
`clickmonkey://spec`.

| Kind | Name | What it is |
|---|---|---|
| Prompt / resource | `clickmonkey` / `clickmonkey://guide` | Product menu (jobs, leash, MCP loop) |
| Prompt / resource | `explore_tester` / `clickmonkey://oracles` | RST: oracles, good, next, done |
| Prompt | `explore_plan` | Time-box a session as JSON items |
| Prompt | `explore_report` | Digest visits/notes/goods/shots after finish |
| Prompt / resource | `spec_writer` / `clickmonkey://spec` | How to freeze a contract, not a walk diary |
| Resource | `clickmonkey://map` | Sitemap JSON (legal page ids) |
| Resource | `clickmonkey://session` | Live `session.md` (or a summary until finish) |
| Resource | `clickmonkey://nasty` | Payload catalogs (site you own) |

Ask the host (or yourself):

1. Read `clickmonkey` and `explore_tester` before the first `explore_step`.
2. Read `clickmonkey://map` before `explore_set_plan`.
3. Read `spec_writer` before `spec_save`. Do not invent widget ids.

`explore_start` `skills` is architecture context (`clickmonkey/explore-context.md`),
not a second charter and not a substitute for these prompts. Copy
`examples/explore-context.md` into the app repo and describe *this* site.

## Explore loop

Charter = the job (ticket, `git log`), not test steps.

1. `explore_start` with a charter (optional `skills`, `headed`, `map` path to a sitemap JSON)
2. `explore_set_plan` from sitemap cards (`clickmonkey://map`) — goal plus 2–6 items
3. `explore_step` with one legal DSL line from the visit (`Mode:` is wizard / form / list / tab / dialog / empty / nav). Optional `note` / `good` / `done`
4. `explore_note` / `explore_good` when you are not stepping. `explore_finding` to file a product bug with a screenshot (resets to the seed page)
5. `explore_shot` when you need pixels. `explore_findings` / `explore_quality` for this run
6. `explore_finish` with `summary` (what you tried, what you trust). Writes `session.md` and a findings report. Disconnect writes the report if you skip finish

Legal step lines are the same DSL as the CLI: `open <page>`, `click surface.id`,
`fill surface.id <value>`, `expect …`, `screenshot` / `screenshot ui "…"`.
Ids only from the current visit / map. Unknown ids are harness, not product bugs.

`nasty_fill` is for a site you own (your staging). Do not point it at anyone
else's production.

## Freeze and prove

This is the MCP extra. After a **good** walk of one contract — not after a
soak — read `spec_writer`, then:

1. `explore_finish` if a session is still live (`spec_run` refuses a live explore)
2. `spec_save` with a **title that is the contract** ("Add customer requires a name", not "Click save")
3. `spec_check` — ids exist on the map (offline, same as `clickmonkey spec --check`)
4. `spec_run` — live browser replay (same as CLI `clickmonkey spec`)

`spec_save` writes `clickmonkey/specs/<slug>.md`. It compact-drops leash intro
and wander before the last `open` / hopped nav click. Every spec needs at
least one `expect`. Do not write the fence by hand.

Optional `spec_save` args:

- `file` — basename under `clickmonkey/specs/` (overwrites). Without it, a
  new slug increments (`go-home.md`, `go-home-2.md`)
- `log` — freeze a `log.txt` from a previous run instead of the last MCP walk

`spec_run` PASS with layout/visual extras is still PASS. A failed expect,
bounce off the leash, unknown id, or empty/intro-only fence is FAIL. If it
fails, the walk was not a contract yet: fix the steps or the expect, walk
again, `spec_save` with `file` to overwrite.

CLI `clickmonkey spec` is the same live walk for CI. PASS with findings is
exit 0 unless `--fail-on-findings`. `clickmonkey replay` is something else:
comparison vs a findings **report**, not a spec.

Commit `clickmonkey.json`, `clickmonkey/map.json`, `clickmonkey/specs/`, and
`clickmonkey/explore-context.md`. Ignore runs, replays, reports, bundle.

## Tools

| Tool | When |
|---|---|
| `explore_init` | Create the leash if `clickmonkey.json` is missing |
| `explore_start` | Open the browser. Presence name is `mcp`. Optional `map` loads that sitemap JSON instead of `clickmonkey/map.json` |
| `explore_step` | One DSL line on the live session |
| `explore_visit` | Compact snapshot (default, no HTML, no PNG). `full: true` dumps mapped fields/actions including disabled |
| `explore_shot` | Latest (or given) PNG |
| `explore_set_plan` / `explore_advance` | Plan items |
| `explore_note` / `explore_good` | Oracle / positive observation |
| `explore_finding` | Host-filed bug + screenshot |
| `explore_findings` / `explore_quality` | This run's folders / current-page digest |
| `explore_finish` | Close the browser, write session + report |
| `spec_list` | Specs under `clickmonkey/specs/` |
| `spec_save` | Freeze the walk (or a log) as a fence |
| `spec_check` | Ids vs the map (offline) |
| `spec_run` | Live replay. Finish explore first |
| `nasty_list` / `nasty_samples` / `nasty_fill` | Payload catalog, site you own |

## Stays CLI

Do not expect MCP to drive these. Shell them, or ask the human:

- `clickmonkey map` — grow the sitemap
- `clickmonkey unleash` — hunt mapped forms
- `clickmonkey nasty` — junk hunt on the nasty clock (or `unleash --nasty`)
- `clickmonkey explore` — unattended explore (needs `brain`)
- `clickmonkey spec` — CI replay of frozen fences
- `clickmonkey replay` — STILL / FIXED / LOOK vs a report
- `clickmonkey report` / `prune` / `bundle` / `ui`

## Files

```
my-app/                            # cwd for `clickmonkey` and `clickmonkey mcp`
  clickmonkey.json                 # leash: url, fence, intro, …
  clickmonkey/
    map.json
    explore-context.md             # optional architecture for skills
    specs/*.md                     # replayable fences (commit these)
    runs/<id>/                     # this MCP walk
    reports/<id>/findings.md
```

Optional `clickmonkey/dev-origin` is one line (`http://127.0.0.1:3001`). When
that file exists, load keeps the leash **path** and replaces scheme/host/port.
Gitignore it. No sidecar → the leash `url` is used as written.

## Pitfalls

- **Wrong folder.** MCP cwd is not the app → it creates or reads a different
  `clickmonkey.json`. Pass `--config` or set `cwd`.
- **Thin map.** `explore_start` will say so. Run `clickmonkey map` before
  walking. Pass `map` to `explore_start` to use a different sitemap JSON.
- **Disabled Save.** Compact visit hides disabled controls. `explore_visit` with
  `full: true` after filling the form shows `button_save  [disabled]`.
- **Invented ids.** Only `open` / `click` / `fill` ids from the visit or
  `clickmonkey://map`. Sight and page blurbs are context, not locators.
- **Empty or intro-only tape.** `spec_save` refuses. Walk the contract,
  including an `expect`, then save.
- **`spec_run` while exploring.** Finish first. Two browsers will not share
  the session.
- **Login in the fence.** Intro stays in the leash. `spec_save` strips it.
- **Freezing a soak.** Wander, nasty fills, and `screenshot ui` findings are
  not specs. Read `spec_writer`.
- **`--nasty` on someone else's production.** Don't.
