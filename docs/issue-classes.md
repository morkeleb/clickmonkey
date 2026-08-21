# What ClickMonkey finds vs what QA still owns

ClickMonkey harvests **classes of defects that repeat across pages** so people stop re-walking chrome, locators, and crash paths. It does not replace someone who knows the product.

A report counts **sites** (pages that show the class), not “10 unique bugs.” One illegal `div` in a button in the shell can be 50 page-instances. That is the point: fix once.

## How to use the split

1. **Map + unleash** on staging — soak chrome, crashes, locatability, HTML/axe, empty-required. Engineers fix classes.
2. **Explore / MCP** with a charter from the ticket (`git log`, “can Test Mode start a Salesforce → Filevine flow”). A person still aims the monkey.
3. **Specs** for paths you will not debate again (login lands, empty create is invalid).
4. **Humans** on money, permissions, “does this customer’s data look right,” and anything that needs a second user or an inbox.

`data-testid` is an upgrade (unique, stable). It is not required. Role + accessible name, field `name`, and `<label>` are enough to walk a random site. Unnamed icon buttons, duplicate names, and disabled/covered controls are the real limits.

## Classes ClickMonkey takes

These merge into per-run ledgers (`quality.json`, `testability.json`, `broken.json`) and finding folders. `clickmonkey report` collapses repeats.

| Class | What it catches | How |
|---|---|---|
| **Runtime** | Uncaught JS, HTTP 4xx/5xx on document/XHR/fetch, 404 (including soft SPA 404) | Walk oracles |
| **HTML validity** | Illegal nesting, duplicate ids, … | html-validate after inspect |
| **A11y scanners** | Contrast, `aria-hidden` + focus, button-name, … | axe-core |
| **SEO hygiene** | Missing title/description/OG on public paths; the same title on every route | `seo` on the leash |
| **Testability** | Unlabeled fields, unnamed controls, click on `<svg>`/`<div>`, no `main`, occluded widgets, duplicate names, missing stable ids | Inspect audit |
| **Layout** | Overlap, clip, overflow, z-index, scanline, contrast in the pixels | Vision model; high-confidence extras become findings |
| **Empty required** | Blank required field + submit must look invalid | Playbook `empty-required` |
| **Junk not invalid** | `--nasty` / typed junk + submit still not `aria-invalid` / visible error / HTML5 constraint validation | Unleash after submit |
| **Throw instead of invalid** | Fill then uncaught `pageerror` (e.g. `Invalid time value`) | Runtime oracle |
| **Map / harness** | Unknown or drifted ids, ambiguous locators | Inspect + replay |
| **Shallow payload** | XSS/SQLi/overlong in fields on a site you own | `unleash --nasty` / `nasty_*` |
| **Explore oracles** | Claim vs behavior, purpose, consistency, interruption, affordance | MCP / `explore` when the host files them |
| **Frozen contracts** | Path, text, value, visible/hidden, invalid | `clickmonkey spec` fences |
| **Regression** | Same finding tape still fails or is fixed | `clickmonkey replay` (STILL / FIXED / LOOK) |

Fence bounce (`/logout`, off-app URL) is leash control, not a product finding.

`--nasty` leftover text in a field is content, not a visual bug, unless that text overflows or clips.

Native `<select>` only accepts its `<option>` list. Unleash (and `--nasty`) pick one of those values. Catalog junk still goes into text, textarea, and type-in comboboxes — `selectOption("x")` is not an XSS test, it is Playwright waiting for an option that does not exist. A spec fill that is not in the list fails immediately and names the options.

### Forms (empty-required)

After inspect, `clickmonkey playbook empty-required` walks every mapped surface that has a submit and **required** fields (HTML `required`). For each required field:

```
open <page>
click <opener>          # if the field lives in a dialog
fill <surface>.<field> ""
click <submit>
expect <surface>.<field> invalid
```

Invalid means `aria-invalid="true"`, a visible `{id}-error` node, or HTML5 constraint validation when the form is not `novalidate`. Native `validity.valid === false` on a `novalidate` form is not a visible error. Silent accept of a blank required field is a finding. A pass is not.

A `pageerror` after a fill is the worse case of the same class: validation did not mark the field invalid, and the page **threw an uncaught JavaScript error**. `Invalid time value` is that crash, not “you typed a bad date.” The report names the field and value and says the throw means validation is missing or does not wrap parsing.

Unleash and explore **prefer empty then invalid then a plausible value**. After `--nasty` junk and a submit, if the field is still not invalid, that is a finding. A `pageerror` on that fill is reported as a crash because validation is missing.

Unleash fills with Faker, scored from field id/label, HTML `type` / `autocomplete` / `inputmode`, and live `min` / `max` / `minlength` / `maxlength` / `step` / `pattern`. Native `<select>` still uses the option list. `--nasty` still uses catalog junk on type-in fields.

Unleash after submit also flags **typed junk** the control should not accept: HTML `type` (email/url/number/date), `pattern`, `min`/`max`/`minlength`/`maxlength`, and `--nasty` catalog payloads. If those fields are still not invalid, that is the same class as empty-required.

Not automatic:

- Cross-field rules (end after start)
- “Next stays disabled until the step is valid” as its own oracle (disabled Next is omitted from `actions:` until a fill enables it)
- Proving the **write did not happen** (we check the control, not the database)

`writePolicy: validationOnly` is a **leash**, not a validator. It blocks submit/save/delete when required fields are already filled so a random walk does not commit. `allow` will submit.

Wizard Next below the Playwright viewport is still a live action; click scrolls it into view. Disabled is still skipped.

## What stays with the QA engineer

ClickMonkey has no domain brain unless you put it in a **charter**, **skills** (`clickmonkey/explore-context.md`), or a **spec fence**.

| Stays with QA | Why |
|---|---|
| **Business correctness** | Wrong total, wrong tenant, wrong binding. Specs pin a path you already know; they do not invent the rule. |
| **Authz policy** | HTTP 403 + “You do not have access” is often the product working. Whether that nav item should exist for this role is a human call. Do not mute 403s with an allowlist — the interesting bug is **200 where this role must not go**. Use `skip` / fence if this leash should not walk it. |
| **Triage** | Axe/html noise vs a user-visible break; visual LOOK; `--nasty` false friends; expected empty states. |
| **Journeys the walker will not finish alone** | Multi-user, email/PDF, payments, long wizards that need real org data, races, load. |
| **Security beyond junk-in-fields** | Not a pentest. No CSRF, IDOR campaigns, session fixation. `--nasty` is only for a site you own. |
| **Taste and intent** | Copy, information architecture, “is this the right wizard.” |
| **Coverage strategy** | Which role, leash, charter, and which fences to freeze after a good walk. |

## Commands → classes

| Command | Harvests |
|---|---|
| `map` | Pages/surfaces, testability, quality on navigate-only |
| `unleash` | The above plus fill/submit; `--nasty` payloads |
| `playbook empty-required` | Blank required + submit → invalid |
| `explore` / `mcp` | Stochastic survey + host oracles; `explore_finding` / `screenshot ui` |
| `spec` | Fences as a real walk; findings still harvest unless you only care about PASS |
| `replay` | Comparison vs a report, not a new survey |
| `report` | Shareable markdown: findings first, then quality digest (Start here, Chrome, clusters) |

ClickMonkey shrinks the **recurring survey**. It does not own **“is this the right system for this customer.”**
