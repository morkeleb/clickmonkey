# Fog of war

Fog is how ClickMonkey remembers **where a job last stood** and **which
mode last ran on that tile**. It is the scheduler: send the scout to rooms
it has not seen, send the NPC to forms it has not filled, and once they
land pick the mode that is hungriest. It is not a fourth army per UI
pattern (no list-monkey, no tab-monkey). Jobs and modes: [walkers.md](walkers.md).

Inspect (HTML, axe, layout, testability) still runs on whoever lands. Quality
`foundAt` is first seen; fog uses **last land**.

## Ledger

`clickmonkey/lands.json` (gitignored, local to this workspace):

```json
{
  "schemaVersion": 2,
  "pages": {
    "home": {
      "at": "2026-08-20T12:00:00.000Z",
      "jobs": { "map": "…", "unleash": "…", "nasty": "…" },
      "modes": { "form": "…", "list": "…" }
    }
  }
}
```

| Field | Meaning |
|---|---|
| `at` | Last land by **any** job. Dashboard haze. Vision skip uses this snapshot at boot. |
| `jobs.map` / `jobs.unleash` / `jobs.nasty` | Last land for **that** job only |
| `modes.*` | Last time that mode did its work on this page |
| missing clock | Full fog (40 days) |

v1 `{ "pages": { "home": "<iso>" } }` upgrades on read (`at` only, empty jobs/modes). A corrupt file is left unread and not overwritten.

A **fresh clone or CI job without this file is full fog** — every room looks
hungry. That is the default. Cache `lands.json` across pipelines only if you
want hunger to carry over.

## Clocks do not share

A scout landing does not lift unleash fog. An NPC fill does not lift nasty
fog. After a form burst on a page that is also a list, the **list** clock is
still old, so the next decide on that tile is list.

| Who | Job clock | Mode clock |
|---|---|---|
| Scout (`clickmonkey map`) | `jobs.map` on land | — |
| NPC (`unleash`) | `jobs.unleash` on land | stamp when the note is that mode’s work |
| Rogue (`unleash --nasty`) | `jobs.nasty` on land | same as NPC |
| Paladin (`explore` / MCP) | **none** | stamp when the DSL line did that mode’s work (`lineMatchesMode`) |
| Spec / replay | none | none |

Land is stamped **once per page stay** (`recordLand`, skipped on replay and
404). Mode is stamped **every exercise** (`recordMode`). Brain names that
stamp a job: `map`, `unleash`, `unleash-nasty`. `explore` and `mcp` do not.

Code: `src/schema/fog.ts`, `src/persist/lands.ts`.

## Hunger

Age of a clock:

| Age | `fogHunger` | Feel |
|---|---|---|
| missing / ≥ 40 days | `1` | full fog |
| 0 … 2 days | `0.35` → `0.65` | light haze |
| 2 … 40 days | `0.65` → `1` | thickening |

Room / form score:

`npcHunger(hitsThisRun, staleMs) = (1 / (1 + hits)) × fogHunger(staleMs)`

The planner (`planNpc`) weights that by path length:
`hunger × (1 + 1 / (1 + dist))`, and stays on the current hunt ~85% of the
time. Hits this run keep a walker from grinding one form; last-land fog
pulls it back days later.

Mode pick (NPC/paladin, on the tile they already stand on): **wizard
locks** while the stepper is up. Other applicable modes compete by
`fogHunger` of `page/mode`. Equal hunger keeps table order: form, list,
tab, dialog, empty. Nav is the fallback. Wizard Next is repeatable (same
id every step); it is not pagination.

## How it guides testing

**Unexplored** — no map node, or a door with no `opens` yet. The scout
clicks that door here (`fogClicks`) before pathfinding. Grow the map first.

**Stale job** — mapped, but *this* job has not landed recently. Scout
pathfinds to rooms by `jobs.map`. NPC/rogue pathfind to mapped forms
(fields + submit) by `jobs.unleash` / `jobs.nasty`. Distance matters, but
a far stale form beats a near form you already filled this run.

**Stale mode** — the walker is already on the tile. Least-recent
applicable mode runs. That is how lists, tabs, dialogs, and empty states
get coverage without extra commands.

**Live** — a walker is on it (dashboard ring). Not a hunger input.

Typical schedule:

1. Several scouts until map fog is thin (unseen doors gone, rooms recently stood on).
2. Several NPCs on **unleash-stale** forms.
3. A rogue pass on **nasty-stale** forms (site you own). Pages the NPC already walked still look hungry to the rogue.
4. One paladin only when a ticket names the job. Charter, not soak. Mode stamps still help the next NPC.

Dashboard haze uses `at` (latest land of any job), opacity when
`fogHunger ≥ 0.4`. Dialogs stay clear. Tooltip is “visited Nd ago”.

## Vision

Boot snapshots `at` into `fogAtStart` so **this stay** does not look fresh
to the VLM.

Skip extras when **all** of: last land *before this run* ≤ ~2 days, PNG hash
matches the last scan, and this run already tried that hash. Still call when
the page was never captioned, the frame looks like loading, or Sight is
required. A **stale** tile still asks even if the pixels match. DOM layout
may skip a matching PNG hash on its own; a scanner throw does not replace
the previous DOM row.

## Files

| Path | Role |
|---|---|
| `clickmonkey/lands.json` | clocks (gitignored) |
| `clickmonkey/map.json` | rooms and doors the scout grows |
| `src/schema/fog.ts` | breakpoints, hunger, job/mode names |
| `src/persist/lands.ts` | read/migrate/stamp |
| `src/brains/npc.ts` | `npcHunger`, pathfind |
| `src/brains/map-scout.ts` | unseen doors, then stale rooms |
| `src/brains/form-hunt.ts` | stale mapped forms |
| `src/brains/walker-mode.ts` | least-recent mode on the tile |
| `web/src/lib/fog.ts` | dashboard haze |
