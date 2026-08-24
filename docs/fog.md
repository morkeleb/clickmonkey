# Fog of war

Fog is how ClickMonkey remembers **where a monkey last stood** and **which
mode last ran on that tile**. It is the scheduler: send **map** to rooms it
has not seen, send **unleash** to forms it has not filled, and once they
land pick the mode that is hungriest. Five monkeys (working names): map,
unleash, nasty, explore, mcp. Not a sixth monkey per UI pattern (no list-monkey).
Monkeys and modes: [walkers.md](walkers.md).

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

A map landing does not lift unleash fog. An unleash fill does not lift nasty
fog. After a form burst on a page that is also a list, the **list** clock is
still old, so the next decide on that tile is list.

| Who | Job clock | Mode clock |
|---|---|---|
| **map** | `jobs.map` on land | — |
| **unleash** | `jobs.unleash` on land | stamp when the note is that mode’s work |
| **nasty** (`clickmonkey nasty`) | `jobs.nasty` on land | same as unleash |
| **explore** | **none** | stamp when the DSL line did that mode’s work (`lineMatchesMode`) |
| **mcp** | **none** | same as explore |
| Spec / replay | none | none |

Land is stamped **once per page stay** (`recordLand`, skipped on replay and
404). Mode is stamped **every exercise** (`recordMode`). Brain names that
stamp a job: `map`, `unleash`, `unleash-nasty`. `explore` and `mcp` do not
(they are different live units on the map: **e** vs **c**).

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

Mode pick (unleash / nasty / explore / mcp, on the tile they already stand on): **wizard
locks** while the stepper is up. Other applicable modes compete by
`fogHunger` of `page/mode`. Equal hunger keeps table order: form, list,
tab, dialog, empty. Nav is the fallback. Wizard Next is repeatable (same
id every step); it is not pagination.

## How it guides testing

**Unexplored** — no map node, or a door with no `opens` yet. **map**
clicks that door here (`fogClicks`) before pathfinding. Grow the map first.

**Stale job** — mapped, but *this* monkey has not landed recently. **map**
pathfinds to rooms by `jobs.map`. **unleash** / **nasty** pathfind to mapped
forms (fields + submit) by `jobs.unleash` / `jobs.nasty`. Distance matters,
but a far stale form beats a near form you already filled this run.

**Stale mode** — the walker is already on the tile. Least-recent
applicable mode runs. That is how lists, tabs, dialogs, and empty states
get coverage without extra commands.

**Live** — a walker is on it (dashboard ring). Not a hunger input.

Typical schedule:

1. Several **map** runs until map fog is thin (unseen doors gone, rooms recently stood on).
2. Several **unleash** runs on unleash-stale forms.
3. A **nasty** pass on nasty-stale forms (site you own). Pages unleash already walked still look hungry to nasty.
4. One **explore** only when a ticket names the job. Charter, not soak. Mode stamps still help the next unleash.

Dashboard haze uses `at` (last land, including explore/mcp), opacity when
`fogHunger ≥ 0.4`. Dialogs stay clear. Three heat pips on each page:
**m** map, **u** unleash, **n** nasty — green when that monkey stood here
recently, red when it is hungry. **explore** and **mcp** have no job clock,
so no heat pip. Live units on a page are a **colored letter**
(instance hue): m / u / n / **e** explore / **c** mcp. Tooltip is
`mcp · amber-otter` so two of the same kind still tell apart.

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
| `clickmonkey/map.json` | rooms and doors the map monkey grows |
| `src/schema/fog.ts` | breakpoints, hunger, job/mode names |
| `src/persist/lands.ts` | read/migrate/stamp |
| `src/brains/npc.ts` | `npcHunger`, pathfind |
| `src/brains/map-scout.ts` | unseen doors, then stale rooms |
| `src/brains/form-hunt.ts` | stale mapped forms |
| `src/brains/walker-mode.ts` | least-recent mode on the tile |
| `web/src/lib/fog.ts` | dashboard haze |
