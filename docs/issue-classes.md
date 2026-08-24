# What ClickMonkey finds vs what QA still owns

ClickMonkey harvests **classes of defects that repeat across pages** so people stop re-walking chrome, locators, and crash paths. It does not replace someone who knows the product.

A report counts **sites** (pages that show the class), not “10 unique bugs.” One illegal `div` in a button in the shell can be 50 page-instances. That is the point: fix once.

## How to use the split

1. **Map** (scout) then **unleash** (NPC) on staging — soak chrome, crashes, locatability, HTML/axe, empty-required. Fog sends them to rooms and forms they have not stood on recently ([fog.md](fog.md)). On a tile the NPC is in wizard / form / list / tab / dialog / empty / nav mode ([walkers.md](walkers.md)). `--nasty` is the rogue pass for junk and missed validation. Engineers fix classes.
2. **Explore** (paladin) with a charter from the ticket (`git log`, “can Test Mode start a Salesforce → Filevine flow”). CLI `clickmonkey explore` is exploratory testing without MCP. MCP is the same walk plus freeze/replay of a spec ([mcp.md](mcp.md)). A person still aims the monkey.
3. **Specs** for paths you will not debate again (login lands, empty create is invalid) — MCP `spec_save` / `spec_run`, or CLI `clickmonkey spec`.
4. **Humans** on money, permissions, “does this customer’s data look right,” and anything that needs a second user or an inbox.

`data-testid` is an upgrade (unique, stable). It is not required. Role + accessible name, field `name`, and `<label>` are enough to walk a random site. Unnamed icon buttons, duplicate names, and disabled/covered controls are the real limits.

## Classes ClickMonkey takes

These merge into per-run ledgers (`quality.json`, `testability.json`, `broken.json`) and finding folders. `clickmonkey report` collapses repeats.

| Class | What it catches | How |
|---|---|---|
| **Runtime** | Uncaught JS, HTTP 4xx/5xx on document/XHR/fetch, 404 (including soft SPA 404) | Walk oracles |
| **HTML validity** | Illegal nesting, duplicate ids, … | html-validate after inspect |
| **A11y scanners** | WCAG 2.0/2.1 A/AA (contrast, names, ARIA, labels, …) plus a small extra allowlist — not all axe `best-practice` | axe-core after inspect |
| **SEO hygiene** | Missing title/description/OG on public paths; the same title on every route | `seo` on the leash |
| **Testability** | Unlabeled fields, unnamed controls, click on `<svg>`/`<div>`, no `main`, occluded widgets, duplicate names, missing stable ids | Inspect audit |
| **Layout / DOM extras** | Overflow (1280, 375, 320), clip, overlap, z-index, scanline, sparse, broken images, hit targets, focus-obscured, focus rings, text occlusion, tiny type, text-spacing, dead hashes, implicit submit, noopener, scroll-padding, pointer-events:none | DOM on every inspect (no model). High confidence → finding folder; medium → quality ledger |
| **Empty required** | Blank required field + submit must look invalid | Playbook `empty-required` |
| **Junk not invalid** | `--nasty` / typed junk + submit **sent those values or left the form** without `aria-invalid` / visible error / HTML5 constraint validation | Unleash after submit |
| **Throw instead of invalid** | Fill then uncaught `pageerror` (e.g. `Invalid time value`) | Runtime oracle |
| **Map / harness** | Unknown or drifted ids, ambiguous locators | Inspect + replay |
| **Shallow payload** | XSS/SQLi/overlong in fields on a site you own | `unleash --nasty` / `nasty_*` |
| **Explore oracles** | Claim vs behavior, purpose, consistency, interruption, affordance | MCP / `explore` when the host files them |
| **Frozen contracts** | Path, text, value, visible/hidden, invalid | MCP `spec_save` / `spec_run`, CLI `clickmonkey spec` fences |
| **Regression** | Same finding tape still fails or is fixed | `clickmonkey replay` (STILL / FIXED / LOOK) |

### A11y extras (axe, not the full best-practice dump)

On top of `wcag2a` / `wcag2aa` / `wcag21a` / `wcag21aa`, inspect enables these rules only (landmarks / `region` / `frame-tested` stay off):

| Rule | What it catches |
|---|---|
| **tabindex** | `tabindex` greater than 0 |
| **heading-order** | Skipped heading level (h1 then h3) |
| **skip-link** | Skip link whose target is missing or not focusable |
| **empty-heading** | Heading with no discernible text |
| **label-title-only** | Field named only by `title` / hidden label |
| **aria-dialog-name** | Dialog / alertdialog with no accessible name |
| **label-content-name-mismatch** | Visible label not in the accessible name (WCAG 2.5.3) |

WCAG 2.2 `target-size` is **not** taken from axe — the DOM **targetSize** rule owns 2.5.8.

### Layout (DOM, always)

Inspect measures boxes, overflow, hit-testing, and a few markup defects on the live page. It does **not** need `vision`. DOM hits stamp `via: dom` and **win** if the model later files the same rule. High confidence → finding folder; medium → quality ledger only.

| Rule | What it catches | Not this |
|---|---|---|
| **overflow** | Page or container leaking past its edge (document wider than the viewport past the scrollbar gutter; ~40px+ is high). Also at **375px** (phone) and **320px** (WCAG 1.4.10 reflow) | Intended `overflow: auto` / `scroll`, closed off-canvas drawers, sticky `100vh` chrome, `overflow: hidden` clip (that is **clip**), data tables that need two-axis scroll |
| **clip** | Text cut mid-word with no `…` — table cells, fields, tabs, chips, headings | Clean ellipsis, scrollable panes, roomy inputs whose letters are readable |
| **overlap** | Two actable controls sharing ≥8×8 px | Parent/child, labels on labels, an open menu covering the page |
| **zIndex** | `elementFromPoint` at a control's center is something else | Sticky header/nav, an open dialog/menu covering the page behind it |
| **scanline** | Repeating list or table row titles/icons whose edges do not line up (≥16px) | Nested nav indent, masonry / multi-column cards, items inside a menu |
| **sparse** | Main pane is left-locked and the content column uses ≤50% of the width (~30% is high) | Centered cards/login, a second column on the right, small dialogs |
| **broken** | Visible `<img>` that finished loading with `naturalWidth === 0` | `data:` placeholders, hidden/empty `src`, still loading |
| **targetSize** | Actable control smaller than 24×24 CSS px on **both** axes, unless a 24px circle around it misses every other target (WCAG 2.5.8 spacing) | Inline text links, native checkbox/radio/file, isolated icons with enough gap, disabled, a wrapping label ≥24×24 |
| **focusObscured** | Focused control is **entirely** hidden (sticky header, cookie/chat) — WCAG 2.4.11 | Partial cover; open modal covering the page |
| **focusVisible** | Focused control has no outline, box-shadow, border, or fill change — WCAG 2.4.7 | Native checkbox/radio/range; author `:focus-visible` ring |
| **textOcclusion** | Heading/body text fully covered by a painted sibling (badge, overlay) | Partial corner overlap; clip inside the same box; actable overlap |
| **fontSize** | Body copy in main under 12px (&lt;10px is high) | `code`/`pre`, nav chrome |
| **textSpacing** | Clip or overflow after WCAG 1.4.12 spacing (line-height 1.5, letter-spacing 0.12em, word-spacing 0.16em) | Wrapping body copy that still fits; axe `avoid-inline-spacing` (inline styles that *block* spacing) |
| **deadHash** | Visible `a[href="#id"]` whose id/`name` is not on the page | `href="#"`, `#top`, hidden links, hash-router state (`#/route`, `#!/app`, `#tab=x`) |
| **implicitSubmit** | `<button>` with no `type` that owns a form (HTML default is submit) | Explicit `type="button|submit|reset"`; buttons outside a form; toolbar chrome |
| **noopener** | `target="_blank"` without `rel` containing `noopener` or `noreferrer` | Same-tab links; hidden; either token is a pass |
| **scrollPadding** | Sticky/fixed top chrome taller than `scroll-padding-top` | Static headers; padding ≥ header height |
| **pointerEvents** | Shown, enabled actable with computed `pointer-events: none` | Disabled/`aria-hidden`; child with `auto` under a `none` parent |

### Vision (optional)

`vision` adds sitemap blurbs, Sight, and **pixel-only** defects. It does not re-file DOM-owned rules. Parse drops geometry restated as `other`.

| Hunt | What it catches | Not this |
|---|---|---|
| **contrast** | Type unreadable in this screenshot | WCAG ratio (axe `color-contrast`) |
| **align** | One control in a row obviously stepped vs siblings | 1px taste; stacked label above its field |
| **other** | Empty-vs-broken, toast chrome, missing mapped widgets, icon collision, canvas/icon-font holes, abnormal ellipsis, mojibake/tofu, chart labels cut, leftover lorem/TODO | Overflow/clip/overlap (DOM); hash-router state; `--nasty` catalog strings |

Fence bounce (`/logout`, off-app URL) is leash control, not a product finding.

`--nasty` leftover text in a field is content, not a visual bug. The vision prompt lists catalog samples and tells the model to ignore them; parse still drops a finding that *quotes* a catalog string (we typed it). A table column that shears a product name mid-word (no `…`) is clip even when a nearby cell is leftover junk.

Native `<select>` only accepts its `<option>` list. Unleash (and `--nasty`) pick one of those values. A spec fill that is not in the `<option>` list fails immediately and names the options. ARIA comboboxes / typeaheads (`role="combobox"`, `aria-autocomplete`, `<datalist>`) are harvested live. If opening the widget paints no rows, harvest types short probes (`a`, `e`, `s`) and waits for a debounced search to fill `[role="option"]`. Unleash then picks a listed option and clicks it so the form can submit. If the planned fill is not in the open list, the executor clicks a listed row instead of filing “has no option”. The list is found via `aria-controls` / `aria-owns` on the input or its closest combobox — including a listbox portaled to `document.body`. Catalog junk still goes into text, textarea, and type-in comboboxes under `--nasty`.

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

Unleash and explore **prefer empty then invalid then a plausible value**. After `--nasty` junk and a submit, if the form **sent those values or left** and the field is still not invalid, that is a finding. A click on submit that does not send is not a miss: client-side validation blocked the write even if it did not paint invalid marks. A `pageerror` on that fill is reported as a crash because validation is missing.

Unleash fills with Faker, scored from field id/label, HTML `type` / `autocomplete` / `inputmode`, and live `min` / `max` / `minlength` / `maxlength` / `step` / `pattern`. Native `<select>` and ARIA typeaheads still use the option list. `--nasty` still uses catalog junk on type-in fields.

Unleash after submit also flags **typed junk** the control should not accept: HTML `type` (email/url/number/date), `pattern`, `min`/`max`/`minlength`/`maxlength`, and `--nasty` catalog payloads. If the form sent those values or left without marking the fields invalid, that is the same class as empty-required. The `empty-required` playbook still `expect`s visible invalid marks even when the form stays put.

Not automatic:

- Cross-field rules (end after start)
- “Next stays disabled until the step is valid” as its own oracle (disabled Next is omitted from `actions:` until a fill enables it)
- Proving the **database write** did not happen (we watch whether a request carried the filled values or the form left, not the backend)

`writePolicy: validationOnly` is a **leash**, not a validator. It blocks submit/save/delete when required fields are already filled so a random walk does not commit. `allow` will submit.

Wizard Next below the Playwright viewport is still a live action; click scrolls it into view. Disabled is still skipped.

## What stays with the QA engineer

ClickMonkey has no domain brain unless you put it in a **charter**, **skills** (`clickmonkey/explore-context.md`), or a **spec fence**.

| Stays with QA | Why |
|---|---|
| **Business correctness** | Wrong total, wrong tenant, wrong binding. Specs pin a path you already know; they do not invent the rule. |
| **Authz policy** | HTTP 403 + “You do not have access” is often the product working. Whether that nav item should exist for this role is a human call. Do not mute 403s with an allowlist — the interesting bug is **200 where this role must not go**. Use `skip` / fence if this leash should not walk it. |
| **Triage** | Axe/html noise vs a user-visible break; 1px align / brand tokens; `--nasty` false friends; expected empty states. |
| **Journeys the walker will not finish alone** | Multi-user, email/PDF, payments, long wizards that need real org data, races, load. |
| **Security beyond junk-in-fields** | Not a pentest. No CSRF, IDOR campaigns, session fixation. `--nasty` is only for a site you own. |
| **Taste and intent** | Copy, information architecture, “is this the right wizard.” |
| **Coverage strategy** | Which role, leash, charter, and which fences to freeze after a good walk. |

## Commands → classes

| Command | Harvests |
|---|---|
| `map` | Scout: pages/surfaces, testability, quality + DOM layout on navigate-only |
| `unleash` | NPC: hunt mapped forms; wizard/form/list/nav on the tile; `--nasty` rogue; same layout pass |
| `playbook empty-required` | Blank required + submit → invalid |
| `explore` / `mcp` | Paladin: charter-driven walk + host oracles; `explore_finding` / `screenshot ui` |
| `spec` | Fences as a real walk; findings still harvest unless you only care about PASS |
| `replay` | Comparison vs a report, not a new survey |
| `report` | Shareable markdown: findings first (each with Why it matters), then quality digest (Start here, Chrome, clusters, every page with leftover issues) |

ClickMonkey shrinks the **recurring survey**. It does not own **“is this the right system for this customer.”**
