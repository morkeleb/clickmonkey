# Spec pack

A spec is a frozen contract, not a walk diary. One job per file. You walk it with mapped ids, then `spec_save` writes the fence. Do not invent widget ids. Do not write the fence by hand.

## When

Freeze a path you will not debate again: login lands, empty create is invalid, save stays on `/customers`, the dialog closes.
Do not freeze exploratory wander, `--nasty` junk, `screenshot ui` findings, or a soak. Those are explore / unleash / report.

## Walk

Name the contract before the first click. That string is the `spec_save` title.
Use only ids from the map (`clickmonkey://map`). `open` a page or click to it, fill, click, then `expect`.
Every spec needs at least one `expect` — that is the contract. A tape of clicks with no expect is still a wander.
Stay on this job. Do not hop "to see". Do not file findings unless they block the contract.
Login belongs in `clickmonkey.json` intro (`$CLICKMONKEY_*`), not in the fence. `spec_save` drops intro and wander before the last `open` / hopped nav click.
Fills must be deterministic: `""`, a fixed token, or `$ENV`. No nasty catalog, no one-off random names.

Legal lines:

- `open <page>`
- `click surface.id` (`nav` only when it is a landmark hop)
- `fill surface.id <value>`
- `expect surface.id invalid`
- `expect surface.id text|value "…"`
- `expect surface visible|hidden`
- `expect path /…`
- `expect text "…"`

`screenshot` / `screenshot ui` are explore, not a spec oracle.

## Fence

`spec_save` writes `clickmonkey/specs/<slug>.md`. The playable part is a `clickmonkey` fence only.
Title (heading) *is* the contract: "Add customer requires a name", not "Click save".
Prose, mermaid, and photos stay outside the fence (why it matters, who cares).
One fence per file unless two contracts share a setup you cannot put in intro.

```clickmonkey
open home
click page.open_create
fill createDialog.name ""
click createDialog.submit
expect createDialog.name invalid
```

## Prove

`spec_check` — ids exist on the map (offline).
`spec_run` — live browser replay (same as CLI `clickmonkey spec`). That freeze+replay is why MCP exists besides `clickmonkey explore`.
PASS with layout/visual extras is still PASS. A failed expect, bounce off the leash, unknown id, or empty/intro-only fence is FAIL.
If `spec_run` fails, the walk was not a contract yet: fix the steps or the expect, walk again, `spec_save` with `file` to overwrite.
Commit `clickmonkey/specs/*.md` with the leash and the map.
