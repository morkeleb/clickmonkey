# ClickMonkey 2

ClickMonkey is the same idea it always was: point it at a URL, let it drive the
UI, and keep a tape you can replay when something is wrong. v2 is that product
without the JRE, the local proxy, or a WebdriverIO `intro` callback.

The leash is one JSON file. The sitemap, ledgers, and run tapes live next to
it in `clickmonkey/`. The log is a line DSL. The view is what a brain
(human or model) sees — ids, values, actions, a scoped accessibility
snapshot, and a `look` block (font palette + hit-tested cover) — not HTML.

What it harvests vs what QA still owns: [docs/issue-classes.md](docs/issue-classes.md).

0.0.7 stays tagged. Those configs will not run here.

## Install

```bash
npm install -g clickmonkey
# or from this repo
npm install
npm install --prefix web
npx playwright install chromium
npm run build
npm run link
```

`npm run link` puts `clickmonkey` on your PATH and installs zsh completions. Type `click<TAB>`, not `cli<TAB>` (`cli` is `clippy-driver`). After linking, run `rehash` or open a new terminal. The launcher is `bin/clickmonkey.mjs`: it runs `src/` via tsx until you `npm run build`, then it uses `dist/`. `clickmonkey ui` needs `web/dist` from `npm run build` (CLI `tsc` plus the Vite app).

Node 22.22+ or 24.8+. No JRE.

## Getting started (fixtures)

Serve a fixture, then map it and run the playbook:

```bash
# from the repo, any static server on the fixture folder
npx --yes serve fixtures/sites/accepts-empty -l 4173

clickmonkey init --url http://127.0.0.1:4173/
clickmonkey inspect
clickmonkey view
clickmonkey playbook empty-required
clickmonkey report --all
clickmonkey replay clickmonkey/reports/<id>/findings.md
```

`page.ready` prefers a unique `data-testid` when one exists, then a unique
landmark or heading, then `document`. Sites under test are not required to
add test ids — Google and example.com work — but a visible field or click
target with no `id` / `data-testid` (or `data-cy` / `data-test`) is a
`missingStableId` **warn**. That is the hook classical e2e tools use. It
does not block the walk.

`fixtures/sites/validates` is the same form with client-side validation. The
playbook should pass there and write no findings.

`clickmonkey step 'click page.open_create'` runs one line against the live
page and appends it to `clickmonkey/runs/<id>/log.txt`.

The map is fog of war. Walkers have jobs — they are not the same random clicker:

```bash
clickmonkey map --steps 80               # scout — grow pages/surfaces, never fill
clickmonkey unleash --steps 200          # NPC — hunt mapped forms, fill, submit
clickmonkey unleash --nasty --steps 200  # rogue — junk in those forms (site you own)
clickmonkey explore --charter "…"        # paladin — do the job in the charter (needs brain)
clickmonkey mcp                          # same paladin, host LLM via stdio
```

**Map** is the scout. It clicks unseen doors (unvisited pages and unopened
dialogs) and pathfinds toward rooms it has not stood on, instead of grinding
the same sidebar. It never fills and never clicks submit/save/delete. After
it, the others have legal ids.

**Unleash** is an NPC on that map. It pathfinds toward forms (fields + submit),
fills them, and watches what happens. Forms already filled this run drop in
priority but stay in the pool. A little local chrome still gets a poke.
`--nasty` is the rogue version of the same hunt: XSS/SQLi/overlong junk and
missed validation, only on a site you own.

**Explore** is the paladin. A charter (ticket, `git log`) says what “doing the
job” means; the model walks legal ids toward that, not toward random forms.
MCP is the same role with the host LLM as the brain.

Explore pings `brain` before it opens a browser. If the model is unreachable
or the API key is missing, it exits 2 instead of walking blind. It will not
take a screenshot when the last step was already a screenshot.

## Files

```
clickmonkey.json                 # leash: url, fence, intro, writePolicy, screenshots, brain, vision, seo
clickmonkey/
  map.json                       # living sitemap — parallel monkeys merge here
  testability.json               # legacy workspace ledger (inspect without a run)
  quality.json                   # legacy workspace ledger (inspect without a run)
  broken.json                    # legacy workspace ledger (inspect without a run)
  runs/<id>/                     # tape, shots, findings, nav.jsonl for one walk
  runs/<id>/quality.json         # HTML, a11y, JS, SEO, visual extras for that walk
  runs/<id>/testability.json     # locatability for that walk
  runs/<id>/broken.json          # 404s seen on that walk
  runs/<id>/verbose/             # --verbose only: per-step HTML + view.txt (safe to delete)
  reports/<id>/findings.md       # shareable reports (one folder per report)
  replays/<id>/comparison.md     # before/after vs that report
  explore-context.md             # optional: app architecture for explore --skills
  specs/*.md                     # replayable clickmonkey fences
```

### Git

Commit the leash, the map, specs, and explore context. Ignore generated walks (screenshots, verbose DOM, presence) — they are large and local.

```gitignore
# ClickMonkey
clickmonkey/runs/
clickmonkey/replays/
clickmonkey/bundle/
clickmonkey/reports/
clickmonkey/dev-origin
clickmonkey/ui.pid
clickmonkey/**/*.json.lock
clickmonkey/**/*.json.tmp
```

Leave `clickmonkey.json`, `clickmonkey/map.json`, `clickmonkey/specs/`, and `clickmonkey/explore-context.md` tracked. Secrets in the leash are `$CLICKMONKEY_*` tokens, not values.

`reports/` is optional to ignore: markdown without `runs/` has no screenshots. CI should keep reports as job artifacts (`examples/gitlab-ci.yml`). Commit a single `findings.md` only if you want a paper trail.

Do not gitignore the whole `clickmonkey/` folder.

`clickmonkey.json` is the file you edit:

```json
{
  "url": "http://127.0.0.1:4173/",
  "fence": { "path": "/", "blacklist": ["/logout"] },
  "intro": [
    "fill login.user $CLICKMONKEY_USER",
    "fill login.password $CLICKMONKEY_PASSWORD",
    "click login.submit"
  ],
  "writePolicy": "validationOnly",
  "seo": { "private": ["/app"] }
}
```

The `seo` block is optional. Leave it off for an app-only site. Use `private` prefixes for a site that is half marketing, half signed-in app.

- **url** — where the run starts.
- **fence** — pathname prefix plus blacklist substrings. Crossing it bounces the walker back to seed; it is not a website finding.
- **intro** — DSL lines run after `goto`, before inspect/playbook/replay. Not a function.
- **$VAR / ${VAR}** — fill values resolved from the environment. The log keeps the token.
- **writePolicy** — `validationOnly` (default) refuses a submit when required fields are filled, so the monkey does not create/update data. `allow` fills empty fields then clicks submit in one burst (it does not click away mid-form). Use `allow` only on a disposable test instance.
- **skip** — extra widget id/label substrings the walker will not click. Sign out, log out, and close panel are skipped by default.
- **screenshots** — per-step screenshots, default on. `"screenshots": false` turns auto shots off.
- **seo** — optional. Scan the live `<head>` for title, meta description, Open Graph, and canonical problems. Off when omitted. See [SEO / meta](#seo--meta).
- **vision** — optional. Same connection shape as `brain` (`baseUrl`, `model`, `apiKeyEnv`). Mix models (qwen text + qwen-vl on another host). `model` is required and is never copied from `brain`. `baseUrl` inherits when omitted. `apiKeyEnv` inherits only when `vision.baseUrl` is also omitted; `"apiKeyEnv": false` means no key. Per-step screenshots must stay on. `issues` (default true) writes extras into that run's `quality.json` (overlap, overflow, clip, covered controls, alignment, scanline/list edges, unreadable contrast, sheared or off-baseline type — not font taste, broken images). Each visual extra has `high`/`medium` confidence; `low` guesses are dropped. High-confidence extras are also filed as findings with the step screenshot (the walk does not stop). Medium stays on the quality ledger. If a visual report quotes a `--nasty` catalog payload in a cell, that is treated as leftover test data, not a defect; overflow or clip from that text still counts. `assist` (default true) adds explore sight notes. decide stays text-only.

v1 used `fence.blacklist` only for **URLs** (e.g. `#/login` after the monkey logged itself out). That is still the fence. `skip` is the widget denylist.

Duplicate accessible names (two **Employees** buttons) are a `duplicateName` **warn**. Collect keeps both: the first match stays the plain locator, the rest get `nth` so the walker can open the child list, not only the section expander.

`clickmonkey/map.json` is the page model `inspect` / `map` grow. Each page gets a one-line `description` (path, heading, fields, dialogs). With `vision` configured, a page-level screenshot upgrades that to what is actually on screen (dashboard, list, form, details) — not a modal shot. Explore may still polish with the text brain. Extra widgets never fail a replay. Several processes may share that file: each step takes a short lock, unions the trees, and writes back. That is cheap next to Playwright and the LLM.

As the monkey walks, each inspect updates that run's `testability.json` (can we locate the controls?) and `quality.json` (html-validate for HTML, axe-core for WCAG, plus JS `console` / `pageerror` with merge counts). A report also flags when most walked pages share one `document.title` (tabs, screen readers, and search cannot tell routes apart). A 404 goes in that run's `broken.json`. The shared sitemap stays in `map.json`. Testability, HTML, and axe issues keep a short `where` (accessible name, testid, id, or compacted CSS — not XPath). Per-step screenshots are on by default (`shots/step-NNN.png`). With `vision` configured, a second model may add visual extras to that run's ledger and a short Sight note for explore. High-confidence visual extras are also findings (with the screenshot); medium stays on the ledger. `clickmonkey report` combines quality/testability from the selected runs so two reports can be compared. Console warnings are ledger-only; the first uncaught `pageerror` per message is still a finding.

A page that lives on another host than the leash `url` (SSO, IdP) gets an `origin`. Pages seen during intro (login, callback) are marked `entry`. Walkers only hop to leash-origin pages that have widgets, are not `entry`, and would not cross the fence. `open` uses the page origin so a path like `/u/login` is not rewritten onto the app host. Intro waits until the browser has left the start URL and landed on a real app page before the walk starts.

`clickmonkey init` writes the leash and an empty map. If the leash already exists: `monkey settings already exists: <path>`. A one-file `clickmonkey.json` that still contains `map` still loads (an empty seeded `map.json` yields to a richer inline map); the next persist writes `clickmonkey/map.json`.

## Line DSL

```
open home
click page.open_create
click page.projects nav
fill create.name ""
click create.submit
expect create.name invalid
expect create visible
expect path /
```

A log is those lines, plus optional headers:

```
# bug: empty name is accepted on create
# found: 2026-08-14T12:00:00.000Z
```

`clickmonkey compact <log>` drops everything before the last `open` or
nav-landmark click (`click page.x nav`) and keeps the bug header and comments.
A nav click is a state reset in typical apps, same as `open`.

## Commands

```
clickmonkey init [--url <url>] [--config <path>]
clickmonkey inspect [--config] [--url] [--headed] [--timeout]
clickmonkey view [--config] [--url] [--headed]
clickmonkey step '<line>' [--config] [--url] [--out]
clickmonkey playbook empty-required [--config] [--url] [--out]
clickmonkey map [--config] [--url] [--out] [--steps] [--verbose]
clickmonkey unleash [--config] [--url] [--out] [--steps] [--nasty]
clickmonkey explore [--config] [--url] [--out] [--steps] [--minutes] [--charter] [--skills]
clickmonkey mcp [--config]
clickmonkey report [--config] [--runs id,id] [--all] [--out]
clickmonkey replay <log|report.md> [--config] [--url] [--out]
clickmonkey spec [file.md] [--check] [--fail-on-findings]
clickmonkey compact <log> [--out <file>]
clickmonkey bundle [--config] [--out]
clickmonkey ui
clickmonkey ui --stop
```

`clickmonkey ui` reads `clickmonkey.json` in the current directory (or `--config`) and serves a localhost-only dashboard on `127.0.0.1:4174`. It never binds a public interface. `--port` and `--no-open` are optional. After a clone, `npm install --prefix web && npm run build` once so `web/dist` exists. If the banner says the UI is stale, use **Restart UI** in that banner, or `clickmonkey ui --stop` then `clickmonkey ui`. A report page has **Copy** (markdown + inlined screenshots for pasting into a model) next to **Print**.

`clickmonkey bundle` writes a static copy of that dashboard (default `clickmonkey/bundle/`). It does not need the CLI to view: serve the folder (`python3 -m http.server 4174`) or upload it to GitLab Pages. Do not open `index.html` as `file://` — fetch is blocked. A GitLab job example is `examples/gitlab-ci.yml`.

## Exploratory testing via MCP

The host LLM (Grok, Claude, Cursor, …) decides the next click. ClickMonkey still owns the browser, fence, map, and run tape. Visits are compact (pagemap, mode, look) — no page HTML. `config.brain` is not required; the host is the brain.

Prompt `clickmonkey` and resource `clickmonkey://guide` are the product menu (map / unleash / explore / spec / replay). Map, unleash, spec, and replay stay CLI.

Unattended CI still uses `clickmonkey explore` and needs `brain` in the leash.

### Where files live

The MCP server uses the **same folder as the CLI**. Settings are `clickmonkey.json` (the leash). The sitemap, runs, and reports sit next to it in `clickmonkey/`. That folder is *the product under test* (or a testing sibling), not the ClickMonkey git repo.

```
my-app/                            # cwd for `clickmonkey` and for `clickmonkey mcp`
  clickmonkey.json                 # leash: url, fence, intro, …
  clickmonkey/
    map.json
    explore-context.md             # optional architecture for --skills
    specs/*.md                     # replayable fences (commit these)
    runs/<id>/                     # this MCP walk
    reports/<id>/findings.md
```

Default config path is `./clickmonkey.json` in the MCP process cwd. `--config /abs/path/clickmonkey.json` (CLI flag or `explore_start` argument) pins the leash even if cwd is wrong. The workspace is always `dirname(that json)/clickmonkey/`. Gitignore for that folder is under [Git](#git).

Optional `clickmonkey/dev-origin` is one line (`http://127.0.0.1:3001`). When that file exists, load keeps the leash **path** and replaces scheme/host/port. It is not written back into `clickmonkey.json`. Tools that assign ports (for example `fde dev up`) write this file; gitignore it. No sidecar → the leash `url` is used as written.

### 1. Leash

From the app (or testing) folder:

```bash
clickmonkey init --url http://127.0.0.1:3000/
# optional: grow the sitemap before the host walks
clickmonkey inspect
clickmonkey map --steps 40
```

Or call `explore_init` from MCP with the same `url` (creates the json + folder if they are missing).

`clickmonkey` must be on `PATH` (`npm run link` from this repo, or a global install).

### 2. Wire the host

The stdio server is `clickmonkey mcp`. The **browser starts on `explore_start`**, not when the MCP process connects. Playwright cold start can exceed a 30s MCP startup timeout — raise it.

**Grok** (project-scoped — put this *in the folder that has `clickmonkey.json`* so cwd is correct):

```toml
# my-app/.grok/config.toml
[mcp_servers.clickmonkey]
command = "clickmonkey"
args = ["mcp"]
startup_timeout_sec = 60
```

Or pin the leash from `~/.grok/config.toml` if you start Grok from other directories:

```toml
[mcp_servers.clickmonkey]
command = "clickmonkey"
args = ["mcp", "--config", "/abs/path/to/my-app/clickmonkey.json"]
startup_timeout_sec = 60
```

Then `grok mcp list` / `grok mcp doctor clickmonkey`. Open Grok with cwd in `my-app/` (or always pass `--config`).

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

If the client has no `cwd` field, pass `"args": ["mcp", "--config", "/abs/path/to/my-app/clickmonkey.json"]`.

### 3. Optional dashboard

From the same folder: `clickmonkey ui`. Live MCP walks show up as a monkey on the map (`brain: mcp`).

### 4. Loop

1. `explore_start` with a charter (and `skills` from `clickmonkey/explore-context.md` if you have it)
2. `explore_set_plan` from the sitemap cards (`clickmonkey://map`)
3. `explore_step` / `nasty_fill` while reading `mode` (form vs list vs nav)
4. `explore_note` / `explore_good`; `explore_finding` to file a bug with a screenshot
5. `explore_shot` when you need pixels; `explore_findings` for this run’s persisted list
6. `explore_finish` with `summary` (what you tried, what you trust). Writes `session.md` and a findings report. Disconnect writes the report if you skip finish.

After a good walk, freeze the compact tape into `clickmonkey/specs/*.md` (`spec_writer`). Prose, mermaid, and photos stay outside the fence. `spec_check` or `clickmonkey spec --check` before claiming done. `clickmonkey spec` plays the fences as a real walk (not `replay`); the run writes `spec-results.md` only. PASS with findings is exit 0 unless `--fail-on-findings`.

`--nasty` / `nasty_*` is for a site you own.

## CI

ClickMonkey is headless by default. A pipeline that already deploys a preview URL can explore that URL, write a report, and ship a zip/Pages folder:

1. Deploy this push to staging / preview.
2. Keep `clickmonkey/explore-context.md` (copy `examples/explore-context.md` and describe how *this* site is put together: chrome vs main, which nav item is billing, where a “fix invoice rounding” commit should land). The charter is `git log` for the push — ticket titles, not test steps. The context file is how the model translates those commits into walks.
3. `clickmonkey explore --url "$PREVIEW_URL" --charter "$(git log …)" --skills clickmonkey/explore-context.md` (needs `brain` + `$CLICKMONKEY_*` CI variables).
4. `clickmonkey report --all`
5. `clickmonkey bundle --out clickmonkey-bundle`
6. Upload `clickmonkey-bundle/` as a job artifact (and optionally GitLab Pages).

Explore exit `1` means findings, not a crash — mark the job `allow_failure`. Exit `2` means the model was unreachable or the API key is missing (not findings). Replay of a previous report is the cheap gate (no LLM). See `examples/gitlab-ci.yml`. Downloading the artifact: `python3 -m http.server 4174` in `clickmonkey-bundle/` and open http://127.0.0.1:4174/. You cannot replay from the zip unless the preview URL is still up.

`--nasty` fills fields from a catalog of XSS, SQLi, format, and overlong junk. It is for a site you own (your staging). Do not point it at anyone else's production.

`clickmonkey report` writes `clickmonkey/reports/<id>/findings.md` plus `report.json` (which runs it covers). A TTY asks which runs to combine (checkbox, none pre-selected), then **Quality section?** — digest (Start here, chrome, pages) or full (per-page HTML/a11y/SEO/JS). `--runs id,id` is explicit; `--all` takes every run that has findings. `--quality-full` skips the quality prompt (scripts). Findings come first (severity, page, url, screenshot, compacted tape), then the Quality section. Compact drops the leash intro (replay runs it from config) and keeps the path from the last `open` or nav-landmark click. Findings and quality rows include a short **Why it matters** paragraph (copy-pasteable). With `brain` configured it adds titles and expected/actual. `--out` also copies the markdown to a path you name. The dashboard lists every report and has Print (browser Save as PDF) and Copy (text + screenshots).

`clickmonkey prune` is human review: pick a report, then checkbox findings to drop as false positives. Finding folders on disk stay; the report markdown is rewritten and ids/fingerprints go into `clickmonkey/dismissed.json` so later `report` runs skip them. With `brain` configured the model reads the report first and pre-checks likely walker noise (you can uncheck). Scripts: `clickmonkey prune <reportId> --ids fnd_3_expectFailed,fnd_10_visualIssue`.

Each run writes `nav.jsonl` (and echoes timestamped lines on stderr): every DSL step (`step` / `ok` / `fail`) plus main-frame redirects, document loads, and in-page URL changes. Gaps between `step` and `ok` are waits. That is not the replay tape — `log.txt` stays click/fill/`open` only.

`--verbose` writes `verbose/NNN.html` (live DOM) and `verbose/NNN.view.txt` (what the walker extracted) plus `verbose/index.jsonl`. Compare those two to see naming/locator drift. Delete the folder anytime: `rm -rf clickmonkey/runs/*/verbose`.

A **run** is a walk (`map` / `unleash` / `explore` / playbook). A **report** (`clickmonkey report`) is the shareable markdown of those findings. A **replay of a report** is not a third walk — it is a **comparison** against that report: same tapes, new shots, `comparison.md` with before/after.

`clickmonkey replay clickmonkey/reports/<id>/findings.md` writes `clickmonkey/replays/<id>/comparison.md`. Use the path that `report` printed. **STILL** = the bug came back. **FIXED** = it did not. **LOOK** = a human has to compare the pictures (UI / `screenshot ui`). Exit 1 only on STILL or ERROR.

Defaults: config `clickmonkey.json`, out `clickmonkey/runs/<id>/`.

Exit codes: `0` success no findings, `1` run completed with findings, `2` usage /
schema / unknown command / legacy config, `3` live-validate of `ready` failed
before start.

## SEO / meta

Off until you add `seo` to the leash. Then each inspect reads the live `<head>` (what a renderer sees, not `view-source`) and writes a **SEO** group into that run's `quality.json`. Not findings — same ledger as HTML/a11y.

```json
"seo": { "private": ["/app", "/login"] }
```

`private` is pathname prefixes with a segment boundary (`/app` matches `/app/x`, not `/application`). Pages under those prefixes skip the scan. `"/"` matches every path, so `"private": ["/"]` turns the scan off. Omit `seo` for the same effect. `"private": []` scans every path.

A page with `meta name="robots"` / `googlebot` `noindex` is skipped even when it is not in `private`.

Checks (public pages only):

- title missing, empty, a framework placeholder (`Create Next App`, `Vite App`, …), or longer than ~60 characters
- at report time: the same `document.title` on most walked pages (browser tabs and screen readers cannot tell routes apart; search sees one title too)
- at report time: two records on a parametric path (`/customers/:id1`) that still share one title (two customer tabs both say “Customer”)
- meta description missing, a copy of the title, or outside ~20–160 characters
- Open Graph: missing `og:title`, `og:description`, `og:image`, `og:url`; `og:image` / `og:url` not an absolute `http(s)` URL
- `rel=canonical` missing, not absolute, or a different origin than the live page

App shells should stay in `private`. Marketing `/` and `/docs` stay out of it.

## Fence

`fence.path` is a pathname prefix with a segment boundary (`/app` matches
`/app/x`, not `/application`). `fence.blacklist` is a list of URL substrings.
Leaving the fence skips the post-step inspect and returns to the seed page. That is leash control, not a website finding.

## Playbook: empty-required

After inspect, ClickMonkey clicks page actions to learn which dialogs they
open, then for each required field on a reachable surface:

```
open <page>
click <opener>          # if the field lives in a dialog
fill <surface>.<field> ""
click <submit>
expect <surface>.<field> invalid
```

A passing expect is not a finding. A failing expect writes `replay.log`, a
screenshot, and a finding JSON. Replay that log with no brain in the loop.
Format rules, cross-field checks, and “Next stays disabled” are specs (or a
human), not this playbook — see [docs/issue-classes.md](docs/issue-classes.md).

## Migrating from 0.0.7

The 0.0.7 tag is the old tool. v2 will not load those files.

| 0.0.7 | v2 |
| --- | --- |
| JRE + Selenium | Playwright / Chromium only |
| local HTTP proxy | page + HTTP oracles on the browser |
| `clickmonkey.js` (`intro` function, `proxy_port`) | `clickmonkey.json` |
| default command `unleash` | no default; pick a command |
| WebdriverIO intro | DSL `intro[]` with `$ENV` secrets |
| random clicker | inspect + playbook + replay |

Run `clickmonkey init` and rewrite the intro as lines. Secrets stay out of the log.

## License

MIT

## Contributing

Less is more. Small, readable changes. The monkey should keep a tape, not a
framework. Pull requests are welcome; expect discussion.
