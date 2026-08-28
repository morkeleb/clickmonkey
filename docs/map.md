---
title: Reading the map
permalink: /map/
---

# Reading the map

The dashboard map is the sitemap (`clickmonkey/map.json`). Each card is a
page. Edges are doors the walker has used. Click a card for clocks and
description source. Scheduler (who goes where): [fog.md](fog.md). What
each monkey does: [walkers.md](walkers.md).

## A card

Title is the page. The line under it is the description (inspect writes a
mechanical line; explore or vision may polish it). The source of that
line is on the sheet after you click, not on the card.

`entry` is the start URL. Dialog cards are smaller and stay clear — they
do not take haze or heat pips.

Red and amber counts are finding folders on that page (errors / warnings).
Open the card or a run in the sidebar to read them. Spec names for those
findings: [catalog](findings/).

Search (top left) filters cards by title and path.

## Haze

The card darkens when **nobody** has landed recently. That clock is
`fog.at` — last land by any job, including explore and mcp. Haze is not
per-monkey.

| Look | Meaning |
|---|---|
| Clear | Landed in the last ~2 days |
| Light veil | A few days stale |
| Dark | Weeks stale, or never visited |

Dialogs stay clear. Hover the card for “visited Nh ago”.

## Heat pips — fog per monkey

Three dots on the right of every **page** card. Each is one job clock.
Green is fresh; red is hungry (missing clock = never, also red). A map
landing does **not** turn unleash green. Clocks do not share.

| Letter | Monkey | Clock |
|---|---|---|
| **m** | map | last time `clickmonkey map` stood here |
| **u** | unleash | last time `clickmonkey unleash` stood here |
| **n** | nasty | last time `clickmonkey nasty` stood here |

**explore**, **mcp**, spec, and typed tests have no job clock, so no pip.
Hover the row of dots for the three ages. Click the card — **Last land**
lists the same three clocks with color.

That is how you see “map already walked this, unleash has not filled it
yet” without opening JSON.

## Live letters

A pulsing colored ring means a run is **on that page right now**. The
small letter on the ring is which monkey. Color is the run’s hue, so two
map runs still tell apart. Hover: `mcp · amber-otter`.

| Letter | Monkey |
|---|---|
| **m** | map |
| **u** | unleash |
| **n** | nasty |
| **e** | explore |
| **c** | mcp |
| **s** | spec (run mode, not an m/u/n pip) |
| **t** | test (run mode, not an m/u/n pip) |

Live is not hunger. A ring can sit on a red **u** pip: unleash is here
now, but that does not yet mean the clock is fresh (the stamp is last
completed land). After the run moves on, the ring drops; the pip keeps
the new time.

## Click the page

The sheet is the rest of the explanation:

- **Description** and a badge for who wrote it (`inspect` / `vision` / …)
- **Last land** — overall age, then map / unleash / nasty with the same
  green→red colors as the pips
- Screenshot, findings, testability, HTML/axe/layout

## Typical read

1. Dark cards with red **m** — map has not stood there. Run map until
   those pips go green and unseen doors are gone.
2. Clear cards, green **m**, red **u** — mapped, unleash has not filled
   recently. Run unleash.
3. Green **u**, red **n** — unleash already walked it; nasty still treats
   it as hungry. Site you own.
4. A live **e**, **c**, **s**, or **t** — exploring, MCP, spec, or typed
   tests on that tile. Not a soak clock.
