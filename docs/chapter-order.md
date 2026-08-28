---
title: Why report chapters are in this order
permalink: /chapter-order/
---

# Why report chapters are in this order

Reports list **Quality → Visual → Accessibility → Testability**. That is an audience order: who is stuck, not an alphabet and not “a11y last because leftover.”

There is no W3C or ISO table that ranks these four ClickMonkey chapters. What does exist is a stable split: **how broken is it for a user** vs **how urgently to spend a sprint**. Severity vs priority shows up the same way in ISTQB-style QA writing, [CivicActions / Deque a11y classification](https://accessibility.civicactions.com/guide/defect-priority), [Nielsen UX debt](https://www.nngroup.com/articles/ux-debt/), and treating tech debt as developer-facing rather than user-facing.

| Rank | Chapter | Who is stuck | Analogue |
|---|---|---|---|
| 1 | Quality | Anyone trying to do the job | High severity: crash, data loss, core flow fails |
| 2 | Visual | Anyone looking at the screen | High priority on the main path even if “only cosmetic” |
| 3 | Accessibility | Keyboard / AT users on that same job | Page-level block (trap, no keyboard) is do-now; component noise is next release |
| 4 | Testability | The team, next walk or spec | Dev-facing debt: fix after user-facing work unless it blocks finding (1)–(3) |

**Start here** still ranks by error and path-family clusters, not by this chapter list. A keyboard trap can outrank an html-validate chrome row even though Quality is chapter 1.

## Why not Testability before Accessibility

Missing `data-testid` is how the team gets better. A keyboard trap or unlabeled submit is how a person cannot finish the voucher. Those are not leftovers. Nielsen: don’t drain the sprint on internal hygiene while users still fail.

## Why Accessibility is not automatically first

[GOV.UK / GDS](https://www.gov.uk/guidance/accessibility-requirements-for-public-sector-websites-and-apps) treat WCAG 2.2 AA as a legal bar for public services, and still separate “user cannot complete the task” from heading-order / landmark chrome. Functional a11y (2.1.1 click on a `div`, 2.1.2 trap, 3.3.1 silent Save) belongs with Quality in spirit. Axe `heading-order` on nine pages does not.

## Quality is a mix

Uncaught JS, a 409 on Save, and silent submit are rank 1. `html-validate no-multiple-main` on seventy pages is chrome hygiene — closer to Testability than “the product is bad.” The chapter still opens Quality-first so runtime and refused submits sit at the top of the digest; chrome html-validate rides along. Use Start here when the 70-page html-validate row is not the thing to fix today.

Issue classes the walker harvests: [issue-classes](issue-classes/). Finding catalog: [findings](findings/).
