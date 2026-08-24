# Walkers: jobs, modes, fog

ClickMonkey is an RTS map. **Jobs** are who you send. **Modes** are what they
do on the tile they are standing on. **Fog** is how hungry they are to go
there, and which mode they pick once they arrive. Inspect (HTML, axe, layout,
testability) runs on whoever lands — it is not a job and not a mode. Catalog:
[issue-classes.md](issue-classes.md). Fog ledger and hunger: [fog.md](fog.md).
Host-LLM MCP: [mcp.md](mcp.md).

## Jobs

Parallel runs merge into one `clickmonkey/map.json`. Rings on the dashboard
are live units. Each job has its own last-land clock per page.

| Job | Command | Does |
|---|---|---|
| Scout | `clickmonkey map` | Lift fog: unseen doors, then rooms this scout has not stood on recently. Never fill or submit. |
| NPC | `clickmonkey unleash` | Pathfind to mapped forms this NPC has not filled recently, fill, submit. |
| Rogue | `clickmonkey unleash --nasty` | Same hunt on the **nasty** clock — pages the NPC already walked still look hungry to the rogue. |
| Paladin | `clickmonkey explore` / `mcp` | One charter. Not a soak. Does not stamp a job clock. CLI explore is exploratory testing without MCP. How to run MCP: [mcp.md](mcp.md). |
| Spec | MCP `spec_save` / `spec_run`, CLI `clickmonkey spec` | Frozen fences, still a real walk. MCP freeze+replay is why you would use MCP besides explore. |
| Replay | `clickmonkey replay` | Comparison vs a report, not a unit. |

Do not add a list-monkey or tab-monkey as a fourth army. Lists, tabs, empty
states, and layout bugs are **modes or loot on the tile**. Fog on the job
sends a walker there; fog on the mode picks what they do.

## Modes

The NPC and paladin pick a mode from the current view. **Wizard locks** while
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
| **nav** | Nothing else applies | Stay clicks or hop. Scout also uses nav-shaped clicks to lift fog. |

Wizard vs list: Previous+Next with other list chrome is a **pager**. Next on a
stepper with fields is **wizard**. Last wizard step (Save, no Next) falls
through to **form**.

Not modes: empty-required (a playbook), replay, prune, inspect.

## Fog

Fog is hunger: who goes to a room, and which mode they run once there.
Unexplored doors, stale job clocks, and stale modes. Ledger, formula,
vision skip, and how to schedule jobs: [fog.md](fog.md).
