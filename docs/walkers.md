# Walkers: monkeys, modes, fog

Five monkeys (working names — they may change): **map**, **unleash**,
**nasty**, **explore**, **mcp**. **Modes** are what they do on the tile they are
standing on. **Fog** is how hungry they are to go there, and which mode they
pick once they arrive. Inspect (HTML, axe, layout, testability) runs on
whoever lands — it is not a monkey and not a mode. Catalog:
[issue-classes.md](issue-classes.md). Fog ledger and hunger: [fog.md](fog.md).
Host-LLM MCP: [mcp.md](mcp.md).

## Monkeys

Parallel runs merge into one `clickmonkey/map.json`. Rings on the dashboard
are live units. map, unleash, and nasty each have their own last-land clock
per page. explore and mcp do not — they still show as different live letters
(**e** / **c**) when they stand on the same page.

| Monkey | Command | Does |
|---|---|---|
| **map** | `clickmonkey map` | Unseen doors, then rooms this map run has not stood on recently. Never fill or submit. |
| **unleash** | `clickmonkey unleash` | Pathfind to mapped forms this unleash run has not filled recently, fill, submit. |
| **nasty** | `clickmonkey nasty` | Same hunt on the **nasty** clock — pages unleash already walked still look hungry. Junk payloads. Site you own. `unleash --nasty` is the same call. |
| **explore** | `clickmonkey explore` | One charter. Unattended LLM. Not a soak. Needs `brain`. |
| **mcp** | `clickmonkey mcp` | Host LLM walks (`explore_start` …), then freeze/replay a spec. Not `clickmonkey explore`. [mcp.md](mcp.md). |

Spec (`clickmonkey spec` / MCP `spec_save` / `spec_run`) and replay are not
monkeys. Spec is frozen fences, still a real walk. Replay is comparison vs a
report.

Do not add list or tab as a sixth monkey. Lists, tabs, empty states, and
layout bugs are **modes or loot on the tile**. Fog on the monkey sends a
walker there; fog on the mode picks what they do.

## Modes

unleash, nasty, explore, and mcp pick a mode from the current view. **Wizard locks** while
the stepper is up. Other modes that apply compete by **least-recent stamp**
on that page (`UNLEASH_MODES` in `src/brains/walker-mode.ts`). Nav is the
fallback when nothing else applies. Equal fog keeps the table order (form
before list before tab before dialog before empty).

| Mode | When | Legal moves |
|---|---|---|
| **wizard** | Body fields + Next/Continue, and it is not a list pager | Fill empties, then Next/Continue. No sidebar hop, no form hunt, until Finish/Save or the stepper is gone. |
| **form** | Fields + submit/save/create | Burst-fill empties, then submit (or rarely dismiss). Do not fill one field and leave. |
| **list** | Filters/sort/search/rows/pager (score ≥ 2) | Sample each chrome kind once, then a row. Can share a surface with a form; the staler mode wins. Pagination is list chrome, not wizard Next. |
| **tab** | Tab / tablist controls | Click a tab. |
| **dialog** | Mapped dialog opener on the page (not already inside a dialog) | Click an opener, preferring a dialog this run has not stood in. Form/wizard take over once the dialog is open. |
| **empty** | Empty-state CTA (“Create your first …”), search not active | Click the empty-state action. |
| **nav** | Nothing else applies | Stay clicks or hop. **map** also uses nav-shaped clicks to lift fog. |

Wizard vs list: Previous+Next with other list chrome is a **pager**. Next on a
stepper with fields is **wizard**. Last wizard step (Save, no Next) falls
through to **form**.

Not modes: empty-required (a playbook), replay, prune, inspect.

## Fog

Fog is hunger: who goes to a room, and which mode they run once there.
Unexplored doors, stale job clocks, and stale modes. Clocks live on the
sitemap page (`page.fog` in `map.json`) — wipe them with
`clickmonkey fog --reset` without losing rooms. Formula, vision skip,
and how to schedule jobs: [fog.md](fog.md).
