---
title: Fog of war
permalink: /fog/
---

# Fog of war

Fog is how ClickMonkey remembers **where a monkey last stood** and **which
mode last ran on that tile**. It is the scheduler: send **map** to rooms it
has not seen, send **unleash** to forms it has not filled, and once they
land pick the mode that is hungriest. Five monkeys (working names): map,
unleash, nasty, explore, mcp. Not a sixth monkey per UI pattern (no list-monkey).
Monkeys and modes: [walkers.md](walkers.md).

Inspect (HTML, axe, layout, testability) still runs on whoever lands. Quality
`foundAt` is first seen; fog uses **last land**.

## On the page

Fog is a field on the sitemap page (`clickmonkey/map.json`). There is not a
second map. Missing `fog` = full hunger.

```json
{
  "id": "home",
  "path": "/",
  "description": "Invoices dashboard",
  "fog": {
    "at": "2026-08-20T12:00:00.000Z",
    "jobs": { "map": "…", "unleash": "…", "nasty": "…" },
    "modes": { "form": "…", "list": "…" }
  },
  "surfaces": []
}
```

| Field | Meaning |
|---|---|
| `fog.at` | Last land by **any** job. Dashboard haze. Vision skip uses this snapshot at boot. |
| `fog.jobs.map` / `unleash` / `nasty` | Last land for **that** job only |
| `fog.spec` | Last spec or typed-test land. Coverage pip **s**, not a hunt job. Spec and `session()` share this clock. |
| `fog.modes.*` | Last time that mode did its work on this page |
| missing `fog` / missing clock | Full fog (40 days) |

A leftover `clickmonkey/lands.json` (the old sidecar) is absorbed onto matching
pages on load and deleted on the next map write. Inspect merges keep the later
clock; they do not wipe fog when the incoming tree has none.

Clocks on a committed map travel with the rooms. A page with no `fog` is hungry.
To force a full retest (CI, after a big deploy):

```bash
clickmonkey fog                     # print clocks on each sitemap page
clickmonkey fog --reset             # drop `fog` on every page — rooms stay
clickmonkey fog --reset --job nasty # drop only the nasty clock; `at` stays
clickmonkey fog --reset --job spec  # drop only the spec/typed-test coverage pip
```

`--job` leaves `at` and the other job/mode clocks, so vision skip and dashboard
haze can still look fresh. Full `--reset` is the “force a full retest” path.
The dashboard paints haze / heat pips from `page.fog`. It stays read-only.
How to read those marks: [map.md](map.md).

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
| **spec** / typed test (`session()`) | `fog.spec` (shared coverage pip, not a hunt job) | — |
| Replay | none | none |

Land is stamped **once per page stay** (`recordFog`, skipped on replay and
404). Mode is stamped **every exercise** (`recordMode`). Successful form
work is stamped per job per surface (`fog.forms.unleash.add_customer`) —
unleash and nasty do not share that clock. Brain names that stamp a job:
`map`, `unleash`, `unleash-nasty`. `explore` and `mcp` do not (they are
different live units on the map: **e** vs **c**). `spec` and `test` stamp
`fog.spec` on land (skip replay and 404) and do not feed hunt hunger.

Code: `src/schema/fog.ts`, `src/persist/fog.ts`.

## Hunger

Age of a clock:

| Age | `fogHunger` | Feel |
|---|---|---|
| missing / ≥ 40 days | `1` | full fog |
| 0 … 2 days | `0.35` → `0.65` | light haze |
| 2 … 40 days | `0.65` → `1` | thickening |

Room / form score:

`npcHunger(hitsThisRun, staleMs) = (1 / (1 + hits)) × fogHunger(staleMs)`

**map** weights that by path length (`hunger × (1 + 1/(1+dist))`) and stays
on the current hunt ~85% of the time, unless a reachable room is hungrier
(a never-landed page beats a leftover neighborhood target). Last-**land**
fog is the clock. Local `fogClicks` only lift **unmapped** doors and hops
to pages this job has **never** landed — a room from last run is not unseen.

**unleash / nasty** hunt mapped forms with the **form-work** clock
(`fog.forms[job][surface]`), mixed with a mild job-land spread so a
never-visited page beats a form this job already stood on. A land is still
not a fill — standing on a list to open its create dialog does not drop
that form below other never-filled rooms. They pick the hungriest reachable
form (argmax). Equal hunger:
if three or more forms tie (typical after `fog --reset`), pick among them
at random so parallel walkers do not all walk to the nearest form; two-way
ties are ~10% random, else fewer hops, then map order. A successful Save (or the
Save retry cap this run) spends that form so they walk to the next.
Walkers reload clocks from the sitemap each step so parallel runs see
each other's lands. Unleash filling a form does not feed nasty hunger.

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
forms (fields + submit) by last **form work** on that surface for that job,
with job land as a spread so last run's neighborhood does not win every
tie. A far untested form beats a near form this job already filled.
Landing on the list does not mark the create dialog filled.

**Stale mode** — the walker is already on the tile. Least-recent
applicable mode runs. That is how lists, tabs, dialogs, and empty states
get coverage without extra commands.

**Live** — a walker is on it (dashboard ring). Not a hunger input.

Typical schedule:

1. Several **map** runs until map fog is thin (unseen doors gone, rooms recently stood on).
2. Several **unleash** runs on unleash-stale forms.
3. A **nasty** pass on nasty-stale forms (site you own). Pages unleash already walked still look hungry to nasty.
4. One **explore** only when a ticket names the job. Charter, not soak. Mode stamps still help the next unleash.

Dashboard haze uses `at` (last land, including explore/mcp/spec), opacity when
`fogHunger ≥ 0.4`. Dialogs stay clear. Four heat pips on each page:
**m** map, **u** unleash, **n** nasty, **s** spec — same `fogHunger` as
hunt: green today, yellow at 2 days, then more red until 40 days / never.
Spec and typed tests share **s** and do
not hunt. **explore** and **mcp** have no pip. Live units on a page are a
**colored letter** (instance hue): m / u / n / **e** explore / **c** mcp /
**s** spec / **t** test. Tooltip is `mcp · amber-otter` so two of the same
kind still tell apart. How the dashboard draws that: [map.md](map.md).

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
| `clickmonkey/map.json` | rooms, doors, descriptions, and `page.fog` clocks |
| leftover `clickmonkey/lands.json` | old sidecar; absorbed then deleted |
| `src/schema/fog.ts` | breakpoints, hunger, job/mode names |
| `src/persist/fog.ts` | stamp/reset `page.fog` |
| `src/brains/npc.ts` | `npcHunger`, pathfind |
| `src/brains/map-scout.ts` | unseen doors, then stale rooms |
| `src/brains/form-hunt.ts` | stale mapped forms |
| `src/brains/walker-mode.ts` | least-recent mode on the tile |
| `web/src/lib/fog.ts` | dashboard haze |
