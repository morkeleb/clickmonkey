# What ClickMonkey finds vs what QA still owns

ClickMonkey harvests **classes of defects that repeat across pages** so people stop re-walking chrome, locators, and crash paths. It does not replace someone who knows the product.

A report counts **sites** (pages that show the class), not “10 unique bugs.” One illegal `div` in a button in the shell can be 50 page-instances. That is the point: fix once.

## How to use the split

1. **map** then **unleash** on staging — soak chrome, crashes, locatability, HTML/axe, empty-required. Fog sends them to rooms and forms they have not stood on recently ([fog.md](fog.md)). On a tile unleash is in wizard / form / list / tab / dialog / empty / nav mode ([walkers.md](walkers.md)). **nasty** (`clickmonkey nasty`) is the junk + missed-validation pass. Engineers fix classes.
2. **explore** with a charter from the ticket (`git log`, “can Test Mode start a Salesforce → Filevine flow”). CLI `clickmonkey explore` is exploratory testing without MCP. MCP is the same walk plus freeze/replay of a spec ([mcp.md](mcp.md)). A person still aims the monkey.
3. **Specs** for paths you will not debate again (login lands, empty create is invalid) — MCP `spec_save` / `spec_run`, or CLI `clickmonkey spec`.
4. **Humans** on money, permissions, “does this customer’s data look right,” and anything that needs a second user or an inbox.

`data-testid` is an upgrade (unique, stable). It is not required. Role + accessible name, field `name`, and `<label>` are enough to walk a random site. Unnamed icon buttons, duplicate names, and disabled/covered controls are the real limits.

## Classes ClickMonkey takes

These merge into per-run ledgers (`quality.json`, `testability.json`, `broken.json`) and finding folders. `clickmonkey report` collapses repeats.

| Class | What it catches | How |
|---|---|---|
| **Runtime** | Uncaught JS, HTTP 5xx, 401/403, GET 4xx, 404 (including soft SPA 404); console error/warning | Walk oracles. Catalog **Q-14…Q-18**. |
| **HTML validity** | Illegal nesting, duplicate ids, … | html-validate after inspect |
| **A11y scanners** | WCAG 2.0/2.1 A/AA (contrast, names, ARIA, labels, keyboard 2.1.1, …) plus a small extra allowlist — not all axe `best-practice` | axe-core after inspect; **clickableNonWidget** is DOM 2.1.1 |
| **SEO hygiene** | Missing title/description/OG on public paths; the same title on every route | `seo` on the leash. Catalog **Q-04…Q-13**. |
| **Testability** | Unlabeled fields, unnamed controls, no `main`, occluded widgets, duplicate names, missing stable ids | Inspect audit. Findings explain why. Stable ids **T-01…T-08**: [catalog](https://morkeleb.github.io/clickmonkey/findings/). |
| **Keyboard 2.1.1** | **clickableNonWidget**: click on a `div`/`span`/`svg` (onclick, React onClick, `addEventListener`) or a `role=button` that is not tabbable | Inspect audit. Report chapter **A-2.1.1**. List rows and `#root` are not mapped as actions. |
| **Keyboard 2.1.2 / 2.4.3** | Form Tab walk: **keyboardTrap** (Tab cannot leave a field), **focusOrder** (next stop sits a row above) | DOM on inspect when a form has two+ tabbables — not a full-page Tab session. **A-2.1.2** / **A-2.4.3**. |
| **Layout / DOM extras** | Overflow (1280, 375, 320), clip, overlap, z-index, scanline, sparse, broken images, hit targets, focus-obscured, focus rings, text occlusion, tiny type, text-spacing, dead hashes, implicit submit, noopener, scroll-padding, pointer-events:none | DOM on every inspect (no model). High confidence → finding folder; medium → quality ledger |
| **Silent Save** | Submit/Save: no navigation, no write request, and no accessible invalid (`aria-invalid`, `{id}-error`, HTML5 constraint). WCAG 3.3.1 | Unleash after submit |
| **Invalid accepted** | Required blank or junk: after Save the field is not invalid, **and** the form sent that value or left the page | Unleash / `empty-required`. Catalog **Q-02**. |
| **Server refused submit** | Write (POST/PUT/PATCH/DELETE) returned 400/409/422: the UI let Save go and the API refused the value | HTTP oracle. Catalog **Q-01**. |
| **Threw instead of invalid** | Fill then uncaught `pageerror` (e.g. `Invalid time value`) instead of a field error | Runtime oracle. Catalog **Q-03**. |
| **Map / harness** | Unknown or drifted ids, ambiguous locators | Inspect + replay. Catalog **T-09…T-12**. |
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

WCAG 2.2 `target-size` is **not** taken from axe — the DOM **targetSize** rule owns 2.5.8. **2.1.1 Keyboard** is the DOM **clickableNonWidget** check (click on a non-control, or `role=button` that is not tabbable), not an axe rule. **2.1.2** / **2.4.3** are the form Tab walk (`keyboardTrap`, `focusOrder`).

Reports tag issues by **spec name** (WCAG success criteria, HTML authoring, or catalog titles). Permalinks stay `A-1.4.3` / `T-01` / `T-09` / `V-03` / `V-17` / `Q-01` / `Q-04`… on [the catalog](https://morkeleb.github.io/clickmonkey/findings/).

### WCAG 2.2 A/AA a person still tests

Leftover A/AA (media, sequence of prose, shortcuts, pointer/drag, consistent nav, error suggestion, authentication, live regions, AAA) is a **human checklist**, not a report chapter: [What a person still tests](https://morkeleb.github.io/clickmonkey/findings/qa-left/).

### Layout (DOM, always)

Inspect measures boxes, overflow, hit-testing, and a few markup defects on the live page. It does **not** need `vision`. DOM hits stamp `via: dom` and **win** if the model later files the same rule. High confidence → finding folder; medium → quality ledger only.

| Rule | What it catches | Not this |
|---|---|---|
| **overflow** | Page or container leaking past its edge (document wider than the viewport past the scrollbar gutter; ~40px+ is high). Also at **375px** (phone) and **320px** (WCAG 1.4.10 reflow) | Intended `overflow: auto` / `scroll`, closed off-canvas drawers, sticky `100vh` chrome, `overflow: hidden` clip (that is **clip**), data tables that need two-axis scroll |
| **clip** | Text cut mid-word with no `…` — table cells (including overflow on an inner span, not only the `td`), **column headers that collide or overflow into the next header**, fields, tabs, chips, headings. Also a value or tab title whose glyphs collide with a trailing icon / `$` / `%` inside a box that still “fits” | Clean ellipsis, scrollable panes, roomy inputs whose letters are readable; native date/color UA picker icons; a table cell whose only overflow is the editor input (that is field clip); a header that wraps onto two lines inside its own column |
| **overlap** | Two actable controls sharing ≥8×8 px | Parent/child, labels on labels, an open menu covering the page |
| **zIndex** | `elementFromPoint` at a control's center is something else | Sticky header/nav, an open dialog/menu covering the page behind it |
| **scanline** | Repeating list/table row edges; card/list trailing values shoved by variable-width titles; tab titles in a strip that do not share a left inset; form field chrome (outlined/combobox/custom select, including a hidden native `<select>` whose labeled button is the painted control) on a row that does not share a top; side-label first-line ink vs the value; a column of fields/labels that does not share a left; a column header that does not line up with its cells (box or first-line text, ≥16px) | Nested nav indent, masonry / multi-column cards, items inside a menu, a floating/stacked label vs its *own* outline, right-locked amounts (`space-between` / grid), left-aligned values that only grow to the right, wrapped filter toolbars, fields in different settings cards, fields on the page behind an open dialog, header text vs padded inputs in an editable grid, repeating two-column field grids (code \| description rows), two-column details grids (each field already has a row partner) |
| **sparse** | Main pane is left-locked and the content column uses ≤50% of the width (~30% is high) | Centered cards/login, a second column on the right, small dialogs |
| **broken** | Visible `<img>` that finished loading with `naturalWidth === 0` | `data:` placeholders, hidden/empty `src`, still loading |
| **targetSize** | Actable control smaller than 24×24 CSS px on **both** axes, unless a 24px circle around it misses every other target (WCAG 2.5.8 spacing) | Inline text links, native checkbox/radio/file, isolated icons with enough gap, disabled, a wrapping label ≥24×24 |
| **focusObscured** | Focused control is **entirely** hidden (sticky header, cookie/chat) — WCAG 2.4.11 | Partial cover; an open dialog, menu, or popover covering the page behind it |
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
| **align** | One control in a row obviously stepped vs siblings. Catalog **V-17**. | 1px taste; stacked label above its field |
| **other** | Empty-vs-broken, toast chrome, missing mapped widgets, icon collision, canvas/icon-font holes, abnormal ellipsis, mojibake/tofu, chart labels cut, leftover lorem/TODO | Overflow/clip/overlap (DOM); hash-router state; `--nasty` catalog strings |

Fence bounce (`/logout`, off-app URL) is leash control, not a product finding.

`--nasty` leftover text in a field is content, not a visual bug. The vision prompt lists catalog samples and tells the model to ignore them; parse still drops a finding that *quotes* a catalog string (we typed it). A table column that shears a product name mid-word (no `…`) is clip even when a nearby cell is leftover junk.

Native `<select>` only accepts its `<option>` list. Unleash (and `--nasty`) pick one of those values. A spec fill that is not in the `<option>` list fails immediately and names the options. ARIA comboboxes / typeaheads (`role="combobox"`, `aria-autocomplete`, `<datalist>`) are driven from the live list, not from Faker. The executor opens the widget (click / ArrowDown) **without typing** — a virtual list can throw if it is filtered by a keystroke. If rows appear, it clicks a match or any listed row. Unmatched Faker/catalog clicks the painted row first (name matching after a chip is selected can sit for minutes because `input.value` is empty). A token chip plus Clear still counts as a filled value. Form mode Escape-closes the list after a pick so the next field is not covered. It does not type a filter string into a list that already has rows. Form mode does the same when mapped `option_*` actions are live: click **one** row from the open list, then Escape so the menu does not cover the next field. Another list (industry, then attorney) can still get a click; walking every `option_*` in the same dropdown is a marathon. HTML5 Save often focuses the empty combobox and opens the list. Inner `<input>`s of a combobox map as `combobox`, not `text`. If opening paints no rows, it probes `a` / `e` / `s`, a digit (`1`), then two-character tokens (`an`, `in`, `st`, `11`) for a debounced list — never the planned Faker/catalog string, and not at all when that string was `--nasty` catalog junk. A listed row is clicked so the form can submit. Empty list after that is a miss unless the planned string was catalog junk (the list correctly has no XSS/SQL option). A painted list that could not be clicked is still a miss. The list is found via `aria-controls` / `aria-owns` on the input or its closest combobox — including a listbox portaled to `document.body`. Catalog junk still goes into text, textarea, and type-in comboboxes under `--nasty`.

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

A `pageerror` after a fill is **Q-03**, not Q-02: validation did not mark the field invalid, and the page **threw an uncaught JavaScript error**. `Invalid time value` is that crash, not “you typed a bad date.” The report names the field and value and says the throw means validation is missing or does not wrap parsing.

Unleash and explore **prefer empty then invalid then a plausible value**. After `--nasty` junk and a submit, if the form **sent those values or left** and the field is still not invalid, that is a finding. A click on submit that does not send **and** paints `aria-invalid` / a visible `{id}-error` / HTML5 constraint validation (form not `novalidate`) is not a miss: client-side validation blocked the write. A click on submit that does not send, does not navigate, **and paints no accessible invalid** is a finding (WCAG 3.3.1 Error Identification): users get no error and think Save worked. That is not **implicitSubmit** (a `<button>` with no `type` that can submit by accident). Disabled Save is `page.button_save is disabled`. A `pageerror` on that fill is reported as a crash because validation is missing.

Unleash fills every empty field on the form (no field-count cap) then Save. Repeating child rows (`lineitems_0__…`, `items[0].…`, `row_0_…`) stay at **one** row — extra rows are not filled, and Add Line/Row is not clicked once a row exists. Once any body field has a value and empties remain, the walker stays in form — it does not hop Active tabs / list chrome. After fills it clicks **Save** (including a mapped Save that is still disabled). If Save does not enable, the executor `requestSubmit`s the nearest `<form>` (or clicks `type=submit`) so constraint validation still runs. Native `type=date` stays ISO; letter-token placeholders (`MM/DD/YYYY`, `dd.mm.yyyy`) get that layout. `--nasty` uses a Faker date on those controls (not catalog XSS); typeaheads still pick a listed row. A masked or native date that refuses a non-date string (SQL, XSS, `<img src=x onerror=alert(1)>`) and stays on the placeholder is the control working, not a fill miss. Catalog junk that does not stick in a type-in field is the same: not a fill miss. A real date (`2026-01-31` / `01/31/2026`) that does not stick is. Faker is scored from field id/label, HTML `type` / `autocomplete` / `inputmode`, and live `min` / `max` / `minlength` / `maxlength` / `step` / `pattern`. Native `<select>` and ARIA typeaheads still use the option list. `--nasty` still uses catalog junk on type-in fields. A click on Save that does not send is not 3.3.1 if **any** visible field is already HTML-invalid (`validity.valid === false` on a validating form, or `aria-invalid`), including fields the walker has not filled yet.

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
| `map` | Pages/surfaces, testability, quality + DOM layout on navigate-only |
| `unleash` | Hunt mapped forms; wizard/form/list/nav on the tile; same layout pass |
| `nasty` | Same hunt on the nasty clock; junk fills; site you own (`unleash --nasty` is the same) |
| `playbook empty-required` | Blank required + submit → invalid |
| `explore` | Unattended charter walk (needs `brain`) |
| `mcp` | Host LLM walk, then spec freeze/replay |
| `spec` | Fences as a real walk; findings still harvest unless you only care about PASS |
| `replay` | Comparison vs a report, not a new survey |
| `report` | Shareable markdown in the same chapters as the sitemap page sheet: Findings, Testability, Accessibility, Visual, Quality (HTML/SEO/Runtime). Default caps unique-to-a-route pages with issues at 8; `--quality-full` lists every such page. By page is a report-only index (default: those pages; full: every labeled ledger page) |

ClickMonkey shrinks the **recurring survey**. It does not own **“is this the right system for this customer.”**
