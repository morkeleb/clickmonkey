# ClickMonkey 2

ClickMonkey is the same idea it always was: point it at a URL, let it drive the
UI, and keep a tape you can replay when something is wrong. v2 is that product
without the JRE, the local proxy, or a WebdriverIO `intro` callback.

One JSON file is the leash and the map. The log is a line DSL. The view is
what a brain (human or model) sees — ids, values, actions — not HTML.

0.0.7 stays tagged. Those configs will not run here.

## Install

```bash
npm install -g clickmonkey
# or from this repo
npm install
npx playwright install chromium
```

Node 22+. No JRE.

## Getting started (fixtures)

Serve a fixture, then map it and run the playbook:

```bash
# from the repo, any static server on the fixture folder
npx --yes serve fixtures/sites/validates -l 4173

clickmonkey init --url http://127.0.0.1:4173/
clickmonkey inspect
clickmonkey view
clickmonkey playbook empty-required
clickmonkey replay runs/<id>/replay.log
```

`fixtures/sites/accepts-empty` is the same form without client-side validation.
The playbook should fail there and write `replay.log` plus a finding JSON.

`clickmonkey step 'click page.open_create'` runs one line against the live
page and appends it to `out/log.txt`.

## Config

`clickmonkey.json` is the only settings file:

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
  "map": { "schemaVersion": 1, "app": "app", "generation": 0, "pages": [] }
}
```

- **url** — where the run starts.
- **fence** — pathname prefix plus blacklist substrings. Crossing it is a finding.
- **intro** — DSL lines run after `goto`, before inspect/playbook/replay. Not a function.
- **$VAR / ${VAR}** — fill values resolved from the environment. The log keeps the token.
- **writePolicy** — `validationOnly` refuses a submit when required fields are filled.
- **map** — the page model `inspect` grows. Extra widgets never fail a replay.

`clickmonkey init` writes this file. If it already exists: `monkey settings already exists: <path>`.

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
clickmonkey replay <log> [--config] [--url] [--out]
clickmonkey compact <log> [--out <file>]
```

Defaults: config `clickmonkey.json`, out `runs/<id>/`.

Exit codes: `0` success no findings, `1` run completed with findings, `2` usage /
schema / unknown command / legacy config, `3` live-validate of `ready` failed
before start.

## Fence

`fence.path` is a pathname prefix with a segment boundary (`/app` matches
`/app/x`, not `/application`). `fence.blacklist` is a list of URL substrings.
Leaving the fence records `fenceViolation` and skips the post-step inspect.

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
