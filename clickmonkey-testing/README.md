# ClickMonkey testing (example setup)

Two leashes in this repo: one soaks the finding catalog GitHub Pages publishes
from `docs/`, one soaks the dashboard (`clickmonkey ui`). Same layout you would
copy into an application repo.

```
clickmonkey-testing/
  pages.sh                 # map + report the catalog
  ui.sh                    # start the dashboard, map it, report
  pages/clickmonkey.json   # leash (url, fence, writePolicy, seo)
  pages/clickmonkey/       # workspace (map, runs, reports)
  ui/clickmonkey.json
  ui/clickmonkey/
```

`--config` points at the leash. The workspace is always the `clickmonkey/`
folder next to that file. Do not put two targets in one workspace.

## Prereqs

From the repo root:

```bash
npm install
npm install --prefix web
npx playwright install chromium
npm run build
```

`ui.sh` needs `web/dist` (or `dist/ui`). Local catalog preview (`PAGES_LOCAL=1`)
needs `web/node_modules/marked`.

## GitHub Pages catalog — `./pages.sh`

The leash url is the [generated site](https://morkeleb.github.io/clickmonkey/).
`fence.path` is `/clickmonkey` so catalog links to W3C / Deque bounce instead of
leaving the project. `skip` drops GitHub’s “Improve this page” (it is not our UI).
`writePolicy` is `validationOnly`. `seo` is on: public docs should have real titles.

```bash
./pages.sh
PAGES_LOCAL=1 ./pages.sh                                          # current docs/ tree
PAGES_URL=https://morkeleb.github.io/clickmonkey/ ./pages.sh      # explicit live url
STEPS=40 ./pages.sh
```

`PAGES_LOCAL=1` serves `docs/` with the same permalinks and `baseurl` as GitHub
Pages (`serve-docs.mjs`). Map persist reloads the leash url from disk, so a local
preview can bounce back to the live origin after the first inspect — keep the
leash url pointed at the host you mean to soak, or use the live site.

## Dashboard — `./ui.sh`

Starts `clickmonkey ui --no-open` on 4174, maps `http://127.0.0.1:4174/`, then
`--stop`. `skip` includes `Restart UI` so the walker does not respawn the server.

```bash
./ui.sh
UI_PORT=4176 STEPS=20 ./ui.sh
```

The UI process and the walker share this leash. Runs land in `ui/clickmonkey/runs/`
and show up on the dashboard while the walk is going.

## Commands these scripts wrap

```bash
clickmonkey map --config pages/clickmonkey.json --steps 100
clickmonkey report --config pages/clickmonkey.json --runs <id> --quality-full

clickmonkey ui --config ui/clickmonkey.json --port 4174 --no-open
clickmonkey map --config ui/clickmonkey.json --steps 50
clickmonkey ui --config ui/clickmonkey.json --stop
```

`report --all` needs at least one run with findings; these scripts pass `--runs`
for the walk they just started and `--quality-full` so they never prompt.

Exit 1 means the report has findings (the point of the soak). Exit 2 is setup
(preview down, UI not built, bad flags).

## Git

Commit the leashes and maps. Ignore generated walks — `.gitignore` in this
folder is the same pattern as the [repo README](../README.md#git).

Fog clocks on `map.json` change as monkeys walk. `clickmonkey fog --reset --config …`
drops clocks and keeps rooms if you do not want hunger in git.
