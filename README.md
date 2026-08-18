# ClickMonkey 2

ClickMonkey is the same idea it always was: point it at a URL, let it drive the
UI, and keep a tape you can replay when something is wrong. v2 is that product
without the JRE, the local proxy, or a WebdriverIO `intro` callback.

The leash is one JSON file. The sitemap, ledgers, and run tapes live next to
it in `clickmonkey/`. The log is a line DSL. The view is what a brain
(human or model) sees — ids, values, actions, a scoped accessibility
snapshot, and a `look` block (font palette + hit-tested cover) — not HTML.

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
clickmonkey replay clickmonkey/findings.md
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

The map is fog of war. Three walkers lift or poke it:

```bash
clickmonkey map --steps 80          # navigate only — grow pages/surfaces
clickmonkey unleash --steps 200     # click + fill + submit
clickmonkey explore --charter "…"   # LLM, needs brain in clickmonkey.json
```

`map` never fills and never clicks submit/save/delete. It follows links and
dialog openers, then `open`s a known page when the current surface has nothing
left to walk. After it, `unleash` and `explore` see more legal ids.

## Files

```
clickmonkey.json                 # leash: url, fence, intro, writePolicy, brain
clickmonkey/
  map.json                       # living sitemap — parallel monkeys merge here
  testability.json               # locatability (opaque controls, unlabeled, …)
  quality.json                   # HTML, a11y (axe), JS console / pageerror
  broken.json
  runs/<id>/                     # tape, shots, findings, nav.jsonl for one walk
  runs/<id>/verbose/             # --verbose only: per-step HTML + view.txt (safe to delete)
  findings.md                    # shareable report
  replays/<id>/comparison.md     # before/after vs that report
```

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
  "writePolicy": "validationOnly"
}
```

- **url** — where the run starts.
- **fence** — pathname prefix plus blacklist substrings. Crossing it bounces the walker back to seed; it is not a website finding.
- **intro** — DSL lines run after `goto`, before inspect/playbook/replay. Not a function.
- **$VAR / ${VAR}** — fill values resolved from the environment. The log keeps the token.
- **writePolicy** — `validationOnly` refuses a submit when required fields are filled.
- **skip** — extra widget id/label substrings the walker will not click. Sign out, log out, and close panel are skipped by default.

v1 used `fence.blacklist` only for **URLs** (e.g. `#/login` after the monkey logged itself out). That is still the fence. `skip` is the widget denylist.

Duplicate accessible names (two **Settings** buttons) are a `duplicateName` **warn** on the page, not a reason to skip the control. The walker clicks the first uncovered match.

`clickmonkey/map.json` is the page model `inspect` / `map` grow. Extra widgets never fail a replay. Several processes may share that file: each step takes a short lock, unions the trees, and writes back. That is cheap next to Playwright and the LLM.

As the monkey walks, each inspect updates `testability.json` (can we locate the controls?) and `quality.json` (html-validate for HTML, axe-core for WCAG, plus JS `console` / `pageerror` with merge counts). `clickmonkey report` prints those ledgers under **Quality** without calling an LLM. Console warnings are ledger-only; the first uncaught `pageerror` per message is still a finding.

A page that lives on another host than the leash `url` (SSO, IdP) gets an `origin`. Pages seen during intro (login, callback) are marked `entry`. Walkers only hop to leash-origin pages that have widgets, are not `entry`, and would not cross the fence. `open` uses the page origin so a path like `/u/login` is not rewritten onto the app host. Intro waits until the browser has left the start URL and landed on a real app page before the walk starts.

`clickmonkey init` writes the leash and an empty map. If the leash already exists: `monkey settings already exists: <path>`. A one-file `clickmonkey.json` that still contains `map` still loads (an empty seeded `map.json` yields to a richer inline map); the next persist writes `clickmonkey/map.json`.

## Line DSL

```
open home
click page.open_create
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

`clickmonkey compact <log>` drops everything before the last `open` and keeps
the bug header and comments.

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
clickmonkey report [--config] [--runs id,id] [--all] [--out]
clickmonkey replay <log|report.md> [--config] [--url] [--out]
clickmonkey compact <log> [--out <file>]
clickmonkey ui
```

`clickmonkey ui` reads `clickmonkey.json` in the current directory (or `--config`) and serves a localhost-only dashboard on `127.0.0.1:4174`. It never binds a public interface. `--port` and `--no-open` are optional. After a clone, `npm install --prefix web && npm run build` once so `web/dist` exists.

`--nasty` fills fields from a catalog of XSS, SQLi, format, and overlong junk. It is for a site you own (your staging). Do not point it at anyone else's production.

`clickmonkey report` writes `clickmonkey/findings.md`: summary, findings by severity, screenshot links, and a ` ```clickmonkey ` tape per issue. With `brain` configured it adds titles and expected/actual; the tapes stay the ones from the run. `--all` takes every run that has findings; `--runs id,id` is explicit; a TTY with neither asks which runs.

Each run writes `nav.jsonl` (and echoes timestamped lines on stderr): every DSL step (`step` / `ok` / `fail`) plus main-frame redirects, document loads, and in-page URL changes. Gaps between `step` and `ok` are waits. That is not the replay tape — `log.txt` stays click/fill/`open` only.

`--verbose` writes `verbose/NNN.html` (live DOM) and `verbose/NNN.view.txt` (what the walker extracted) plus `verbose/index.jsonl`. Compare those two to see naming/locator drift. Delete the folder anytime: `rm -rf clickmonkey/runs/*/verbose`.

A **run** is a walk (`map` / `unleash` / `explore` / playbook). A **report** (`clickmonkey report`) is the shareable markdown of those findings. A **replay of a report** is not a third walk — it is a **comparison** against that report: same tapes, new shots, `comparison.md` with before/after.

`clickmonkey replay clickmonkey/findings.md` writes `clickmonkey/replays/<id>/comparison.md`. **STILL** = the bug came back. **FIXED** = it did not. **LOOK** = a human has to compare the pictures (UI / `screenshot ui`). Exit 1 only on STILL or ERROR.

Defaults: config `clickmonkey.json`, out `clickmonkey/runs/<id>/`.

Exit codes: `0` success no findings, `1` run completed with findings, `2` usage /
schema / unknown command / legacy config, `3` live-validate of `ready` failed
before start.

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
