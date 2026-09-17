---
name: add-clickmonkey-ci
description: >
  Add ClickMonkey to CI — GitHub Actions or GitLab — so a preview URL is walked
  on each push, with replay as the cheap gate and explore as the dear one. Use
  when the user asks for ClickMonkey in CI, GitHub Actions, GitLab CI, a PR
  walk, or a preview-URL pipeline. Slash command /add-clickmonkey-ci.
license: MIT
metadata:
  homepage: https://github.com/morkeleb/clickmonkey
---

# Add ClickMonkey to CI

Copy the example into the **application** repo (not the ClickMonkey git repo). The job needs a **deployed preview URL** for this push.

- GitHub: copy `examples/github-actions.yml` → `.github/workflows/clickmonkey.yml`
- GitLab: copy `examples/gitlab-ci.yml` into `.gitlab-ci.yml` (or `include` it)

Also copy `examples/explore-context.md` → `clickmonkey/explore-context.md` and describe **this** site (chrome vs main, where billing lives). The charter is `git log` for the push — ticket titles, not test steps.

## Two speeds

| Gate | Command | LLM |
|---|---|---|
| Cheap | `clickmonkey replay clickmonkey/reports/<id>/findings.md --url "$PREVIEW_URL"` | no |
| Dear | `clickmonkey explore --url "$PREVIEW_URL" --charter "$(git log …)" --skills clickmonkey/explore-context.md` then `report --all --quality-full` | yes (`brain` + key) |

Replay needs that report’s tapes **and** a live preview. You cannot replay from the bundle zip alone. Keep `clickmonkey/reports/` as an artifact (or in the repo) if the next job should replay.

Start with explore + bundle if there is no prior report. Add a replay job once a report exists.

## Secrets

- `PREVIEW_URL` — this push’s deploy
- `$CLICKMONKEY_*` used in leash `intro`
- The env named in `clickmonkey.json` `brain.apiKeyEnv`

## Exit codes

- `0` clean
- `1` findings — walk succeeded. Examples treat this as a yellow/allow-failure job so the pipeline still publishes the bundle. Remove that if findings should block merge.
- `2` setup (no brain, missing key, no `explore-context.md`) — must fail
- `3` live `ready` failed before start — must fail

The example scripts still `report` + `bundle` after explore exit `1`, then exit `1`.

Artifacts: `clickmonkey-bundle/` and `clickmonkey/reports/`. Serve the bundle with `python3 -m http.server 4174` in that folder; do not open `index.html` as `file://`.
