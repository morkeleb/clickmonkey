import { DOCS_SITE } from "../schema/site.js";
import type { ChapterExtras, ReportChapter, WcagLevel } from "./wcag.js";
import { isOverflowAt320, wcagOf } from "./wcag.js";

/** Published catalog explainers. Stable path: /findings/{id}/ */
export const FINDINGS_SITE = DOCS_SITE;

export type CheckDef = {
  /** Stable report id (`T-01`, `V-03`, `A-2.1.1`, `Q-01`). Never reuse or renumber. */
  id: string;
  rule: string;
  chapter: ReportChapter;
  title: string;
  summary: string;
  detail: string;
  sc?: string;
  level?: WcagLevel;
};

/**
 * ClickMonkey-owned checks (not every axe rule). Rows with `sc` are WCAG
 * detectors: reports and catalog pages link the official Understanding doc.
 * Axe/html-validate keep their spec URLs. T/V/Q ids stay fixed so pages never shuffle.
 */
export const CHECKS = [
  {
    id: "A-2.1.1",
    rule: "clickableNonWidget",
    chapter: "accessibility",
    title: "Keyboard: clickable non-widget",
    sc: "2.1.1",
    level: "A",
    summary:
      "A click lives on a div/span/svg, or a role=button is not focusable. Mouse users can activate it; keyboard and screen-reader users never land on it, and the map skips it.",
    detail:
      "HTML onclick, React onClick, and addEventListener('click') on a non-control, or an ARIA button/link/tab that is not tabbable, fail WCAG 2.1.1 Keyboard. Put the handler on a <button> or <a href>, or give role=button a tabindex=0 and Enter/Space. List rows, #root, and real buttons are not this class.",
  },
  {
    id: "A-2.1.2",
    rule: "keyboardTrap",
    chapter: "accessibility",
    title: "Keyboard: no keyboard trap",
    sc: "2.1.2",
    level: "A",
    summary:
      "Tab cannot leave a form control. Keyboard users are stuck in the widget; mouse users still click away.",
    detail:
      "A form Tab walk (not a full-page session) presses Tab up to 16 times from the first field. If focus stays on the same control, that is 2.1.2. A modal that cycles its own tabbables and still closes with Escape is not this. Custom date pickers and widgets that preventDefault Tab are.",
  },
  {
    id: "A-2.4.3",
    rule: "focusOrder",
    chapter: "accessibility",
    title: "Keyboard: focus order",
    sc: "2.4.3",
    level: "A",
    summary:
      "Tab order in the form jumps up a row. Meaning and operability no longer follow what is on screen.",
    detail:
      "The same form Tab walk records boxes. A consecutive stop that sits a row or more above the previous one fails 2.4.3. Wrap from last field back to the first is not this. Same-row left/right reorder is not this. Reading order of prose (1.3.2) is still a human check.",
  },
  {
    id: "T-01",
    rule: "missingStableId",
    chapter: "testability",
    title: "Missing stable id",
    summary: "There is no stable id. The next walk, spec, or retry may not find this control even when it is still on screen.",
    detail:
      "Role + accessible name can still locate it, but duplicate names and renamed labels flake. A unique id, name, or data-testid makes replay and specs cheap.",
  },
  {
    id: "T-02",
    rule: "duplicateName",
    chapter: "testability",
    title: "Duplicate accessible name",
    summary:
      "Two controls share this name, so clicks and screen readers hit the first one. Nested items never get opened or mapped.",
    detail:
      "getByRole({ name }) returns the first match. Nested Settings, duplicate Save, or a list of identical row actions all collapse to one target.",
  },
  {
    id: "T-03",
    rule: "opaqueControl",
    chapter: "testability",
    title: "Opaque control",
    summary: "The control has no accessible name. Assistive tech announces a blank widget, and the map cannot give it a stable id.",
    detail: "Icon-only chrome without aria-label or a visible label cannot be mapped or activated on purpose.",
  },
  {
    id: "T-04",
    rule: "unlabeledField",
    chapter: "testability",
    title: "Unlabeled field",
    summary: "The field has no label. Users cannot tell what to type, and autofill, specs, and junk-fill targeting all miss.",
    detail: "A <label for>, aria-label, or wrapping label is enough. Placeholder-only is not a name.",
  },
  {
    id: "T-05",
    rule: "unnamedControl",
    chapter: "testability",
    title: "Unnamed control",
    summary: "The control has no name. People using a keyboard or a reader skip it; the walker cannot click it on purpose.",
    detail: "Buttons and links need discernible text or an aria-label. Icon-only without a name is this class.",
  },
  {
    id: "T-06",
    rule: "unnamedDialog",
    chapter: "testability",
    title: "Unnamed dialog",
    summary: "The dialog has no accessible name. Screen readers say “dialog” with no title, and inspect cannot tell two modals apart.",
    detail: "aria-label, aria-labelledby pointing at the title, or a data-testid on the dialog host is enough.",
  },
  {
    id: "T-07",
    rule: "noMain",
    chapter: "testability",
    title: "No main landmark",
    summary: "There is no main landmark. Skip-to-content and the walker’s “this is the page” heuristic fall back to chrome.",
    detail: "One <main> or role=main per page. Multiple mains are a quality/html-validate finding instead.",
  },
  {
    id: "T-08",
    rule: "occludedWidget",
    chapter: "testability",
    title: "Occluded widget",
    summary: "A control is covered by another layer. Sighted users may still guess; the walker and keyboard users cannot activate it.",
    detail: "Sticky chrome, leftover overlays, and stacked dialogs hide the click target. Open menus covering the page behind them are expected.",
  },
  {
    id: "T-09",
    rule: "unknownId",
    chapter: "testability",
    title: "Unknown map id",
    summary:
      "The map named a control, page, or surface that is not on this screen. Walks and specs that depend on it fail even when the product still works.",
    detail:
      "The id is missing from the map, so nothing can be clicked on purpose. Not this: the id exists but the locator matches nothing (T-10); the control is still there under a new name (T-11).",
  },
  {
    id: "T-10",
    rule: "unresolvedId",
    chapter: "testability",
    title: "Unresolved locator",
    summary: "The locator no longer matches anything. Retries and replay cannot find the control.",
    detail:
      "Inspect marked the widget unresolved: the stored locator hits zero nodes. Not this: the id is absent from the map (T-09); the control is still there under a new name (T-11).",
  },
  {
    id: "T-11",
    rule: "driftId",
    chapter: "testability",
    title: "Drifted locator",
    summary: "The control is still there but its name or locator moved. Old tapes and specs click the wrong widget or none.",
    detail:
      "Inspect marked the widget as drifted. Not this: zero matches (T-10); two widgets share one locator (T-12).",
  },
  {
    id: "T-12",
    rule: "locatorAmbiguous",
    chapter: "testability",
    title: "Ambiguous locator",
    summary:
      "Two controls share a locator, so the click hits the first match. The intended action — often a nested nav item — is skipped.",
    detail:
      "Give each control a unique accessible name or a stable test id. Not this: a missing map id (T-09); a locator that matches nothing (T-10).",
  },
  {
    id: "V-01",
    rule: "overflow",
    chapter: "visual",
    title: "Overflow",
    summary: "Content leaks out of its card, table, or the viewport. It looks broken and can hide a control.",
    detail:
      "Document wider than the viewport past the scrollbar gutter, or a box leaking past its edge. Intended scroll panes and 320px reflow (WCAG 1.4.10) are not this id — 320 overflow is A-1.4.10.",
  },
  {
    id: "V-02",
    rule: "clip",
    chapter: "visual",
    title: "Clip",
    summary: "Text or a control is cut off mid-glyph, not a clean ellipsis. Names and amounts become unreadable.",
    detail: "Table cells, colliding column headers, and a trailing icon sitting on the letters. Clean ellipsis is not this.",
  },
  {
    id: "V-03",
    rule: "overlap",
    chapter: "visual",
    title: "Overlap",
    summary: "Two things occupy the same pixels. Users mis-click or cannot read a label.",
    detail: "Two actable controls sharing a box. Parent/child and an open menu covering the page are not this.",
  },
  {
    id: "V-04",
    rule: "zIndex",
    chapter: "visual",
    title: "Covered hit target",
    summary: "A control is covered so it cannot be read or used. The click hits whatever is on top.",
    detail: "elementFromPoint at the control center is something else. Sticky nav and an open dialog covering the page behind it are expected.",
  },
  {
    id: "V-05",
    rule: "scanline",
    chapter: "visual",
    title: "Broken scanline",
    summary: "Repeating items or form chrome do not share an edge. Scanning becomes hunting.",
    detail: "List/table row edges, tab titles, form fields on a row, or a header vs its cells. Nested nav indent, masonry, and two-column details grids (each field already has a row partner) are not this.",
  },
  {
    id: "V-06",
    rule: "sparse",
    chapter: "visual",
    title: "Sparse main pane",
    summary: "The main pane is left-locked and more than half the width is empty on the right.",
    detail: "Unused canvas, not a centered card or a real second column.",
  },
  {
    id: "V-07",
    rule: "broken",
    chapter: "visual",
    title: "Broken image",
    summary: "A visible image finished loading with no pixels.",
    detail: "naturalWidth is 0 after load. Hidden empty src and still-loading images are not this.",
  },
  {
    id: "V-08",
    rule: "contrast",
    chapter: "visual",
    title: "Unreadable contrast (pixels)",
    summary: "Text is unreadable on its background in the screenshot, not only in the WCAG math.",
    detail: "Axe color-contrast is A-1.4.3. This id is a pixel-only miss the ratio check did not fire on.",
  },
  {
    id: "V-09",
    rule: "textOcclusion",
    chapter: "visual",
    title: "Text occlusion",
    summary: "Text is hidden under a control, icon, or badge.",
    detail: "Labels and values become unreadable even when the DOM still has the full string.",
  },
  {
    id: "V-10",
    rule: "fontSize",
    chapter: "visual",
    title: "Tiny body type",
    summary: "Body copy is under 12 CSS pixels.",
    detail: "Users zoom or skip the pane. code/pre and nav chrome are not this.",
  },
  {
    id: "V-11",
    rule: "deadHash",
    chapter: "visual",
    title: "Dead in-page link",
    summary: "An in-page link points at an id that is not on this screen.",
    detail: "Skip-to-content and jump-to-section land nowhere. Hash-router state is not this.",
  },
  {
    id: "V-12",
    rule: "implicitSubmit",
    chapter: "visual",
    title: "Implicit submit",
    summary: "A <button> with no type inside a form defaults to submit. Cancel can send the form by accident.",
    detail: "HTML default type is submit. Set type=button on non-submit actions.",
  },
  {
    id: "V-13",
    rule: "noopener",
    chapter: "visual",
    title: "Missing noopener",
    summary: "target=_blank without rel=noopener lets the new page rewrite window.opener.",
    detail: "Tabnabbing and a shared process. Either noopener or noreferrer is a pass.",
  },
  {
    id: "V-14",
    rule: "scrollPadding",
    chapter: "visual",
    title: "Scroll padding vs sticky header",
    summary: "Sticky/fixed header is taller than scroll-padding-top, so keyboard focus tucks under the chrome.",
    detail: "Companion to WCAG 2.4.11. Padding must be at least the sticky header height.",
  },
  {
    id: "V-15",
    rule: "pointerEvents",
    chapter: "visual",
    title: "pointer-events none",
    summary: "The control is shown and enabled but pointer-events is none, so a mouse click never hits it.",
    detail: "Keyboard may still focus it. Disabled/aria-hidden and a child with auto under a none parent are not this.",
  },
  {
    id: "V-16",
    rule: "other",
    chapter: "visual",
    title: "Other visual",
    summary: "A pixel-only rendering defect that is not overflow, clip, or overlap.",
    detail: "Empty-vs-broken, toast covering chrome, icon collision, mojibake, leftover lorem/TODO, chart labels cut on a canvas.",
  },
  {
    id: "V-17",
    rule: "align",
    chapter: "visual",
    title: "Broken alignment",
    summary: "A row or column is clearly broken, not a 1px taste difference. The eye cannot scan the list.",
    detail:
      "Vision-only: one control in a row of the same kind is obviously stepped versus its siblings. Not this: a 1px taste call; a stacked label above its field; scanline, overflow, or clip (those have their own ids).",
  },
  {
    id: "Q-01",
    rule: "serverRefusedSubmit",
    chapter: "quality",
    title: "Server refused submit",
    summary:
      "The UI let this submit; the server refused it. Users can pick or send a value that will not store, and only see an error after Save.",
    detail:
      "A write (POST, PUT, PATCH, or DELETE) returned 400, 409, or 422. The form offered or sent a value the API will not persist. Validate or filter before Save so the listed choice and the server agree. Not this: GET 4xx, 401/403/404, 5xx; Save that never sent (silent Save); junk that crashed the tab (Q-03); junk that stored with no field error (Q-02).",
  },
  {
    id: "Q-02",
    rule: "acceptedInvalid",
    chapter: "quality",
    title: "Invalid input accepted",
    summary:
      "A required field was blank, or a field held junk it should not accept. Save still sent that value or left the page, and the field never showed an error.",
    detail:
      "Example: Name is required and empty, or email is 'asdf'. After Save there is no aria-invalid, no visible {id}-error, and no HTML5 constraint error — and either a write carried that value or the form is gone. Empty required and typed junk are the same class. Not this: Save that stays put with no write and no error (silent Save, WCAG 3.3.1); the page crashing on that junk (Q-03); the server bouncing a write the UI allowed (Q-01).",
  },
  {
    id: "Q-03",
    rule: "throwInsteadOfInvalid",
    chapter: "quality",
    title: "Threw instead of invalid",
    summary:
      "A value that should have been a field error crashed the page instead (uncaught JavaScript). The tab can die; users never see a red field.",
    detail:
      "Example: a date or number field gets junk and the script throws (`Invalid time value`) instead of marking the field invalid. Same missing validation as Q-02, different outcome: crash, not stored data. A generic page crash with no junk fill is still `pageError`, not this id.",
  },
  {
    id: "Q-04",
    rule: "document-title-placeholder",
    chapter: "quality",
    title: "Placeholder tab title",
    summary: "The tab still says a framework default (Create Next App, Vite). Search and shared links look unfinished.",
    detail:
      "Replace the scaffold title with a name for this route. Not this: an empty title (WCAG 2.4.2 document-title); a real title that is only too long (Q-05).",
  },
  {
    id: "Q-05",
    rule: "document-title-long",
    chapter: "quality",
    title: "Long tab title",
    summary: "The title is longer than ~60 characters and will truncate in search results and tabs.",
    detail:
      "Keep the unique part first so a truncated tab still names the page. Not this: a missing title (WCAG 2.4.2); a leftover Create Next App / Vite string (Q-04).",
  },
  {
    id: "Q-06",
    rule: "document-title-same",
    chapter: "quality",
    title: "Same tab title on every route",
    summary:
      "Every route uses the same tab title, so screen readers, search, and people with many tabs cannot tell pages apart.",
    detail:
      "Each route needs a title that names that page. Not this: a missing document.title (WCAG 2.4.2); different records on one route sharing a title (Q-07).",
  },
  {
    id: "Q-07",
    rule: "document-title-instance",
    chapter: "quality",
    title: "Same tab title on every record",
    summary: "Different records share one tab title, so two customer tabs can both say Customer.",
    detail:
      "Put the record name in the title. Not this: every route in the app sharing one title (Q-06); a missing title (WCAG 2.4.2).",
  },
  {
    id: "Q-08",
    rule: "meta-description",
    chapter: "quality",
    title: "Missing meta description",
    summary: "No unique meta description. Search snippets and social fallbacks are empty or generic.",
    detail:
      "Add a one- or two-sentence description that is not a copy of the title. Not this: missing document.title (WCAG 2.4.2).",
  },
  {
    id: "Q-09",
    rule: "og-title",
    chapter: "quality",
    title: "Missing Open Graph title",
    summary: "Open Graph title is missing. Shares look untitled.",
    detail: "Set og:title so a pasted link has a name. Not this: document.title (the browser tab); a missing og:description (Q-10).",
  },
  {
    id: "Q-10",
    rule: "og-description",
    chapter: "quality",
    title: "Missing Open Graph description",
    summary: "Open Graph description is missing. Shares get no summary.",
    detail: "Set og:description. Not this: meta name=description (Q-08); a missing og:title (Q-09).",
  },
  {
    id: "Q-11",
    rule: "og-image",
    chapter: "quality",
    title: "Missing Open Graph image",
    summary: "Open Graph image is missing. Shares get no preview picture.",
    detail: "Set og:image so a pasted link has a preview. Not this: a missing og:title (Q-09).",
  },
  {
    id: "Q-12",
    rule: "og-url",
    chapter: "quality",
    title: "Missing Open Graph url",
    summary: "Open Graph url is missing. Shares may point at the wrong canonical.",
    detail: "Set og:url to the public address of this page. Not this: missing rel=canonical (Q-13).",
  },
  {
    id: "Q-13",
    rule: "canonical",
    chapter: "quality",
    title: "Missing canonical",
    summary: "No rel=canonical. Duplicate URLs can split search ranking.",
    detail: "Add an absolute http(s) canonical for this page. Not this: missing og:url (Q-12).",
  },
  {
    id: "Q-14",
    rule: "console.error",
    chapter: "quality",
    title: "Console error",
    summary:
      "JavaScript or a network call failed on this page. The UI may look fine while a save, load, or widget is already broken.",
    detail:
      "Read the console.error text. Not this: an uncaught script crash (Q-16); a console warning (Q-15).",
  },
  {
    id: "Q-15",
    rule: "console.warning",
    chapter: "quality",
    title: "Console warning",
    summary: "The runtime logged a warning. Most are library noise; read the message before treating it as a product bug.",
    detail: "A warning is not a crash. Not this: console.error (Q-14); uncaught JavaScript (Q-16).",
  },
  {
    id: "Q-16",
    rule: "pageError",
    chapter: "quality",
    title: "Uncaught JavaScript",
    summary:
      "Uncaught JavaScript crashed the page. This is not a console.error and not a field message — the script threw.",
    detail:
      "The tab can die; users cannot continue. Not this: a junk fill that should have been a field error (Q-03); a logged console.error while the page still runs (Q-14).",
  },
  {
    id: "Q-17",
    rule: "notFound",
    chapter: "quality",
    title: "Not found",
    summary: "A link, hop, or redirect led to a missing page, including a soft SPA 404. Users hit a dead end.",
    detail:
      "HTTP 404 and an in-app 404 page (the document can still return 200) are this class. The rest of that path is dropped from the map. Not this: a generic HTTP 4xx/5xx that is not 404 (Q-18).",
  },
  {
    id: "Q-18",
    rule: "httpError",
    chapter: "quality",
    title: "HTTP error",
    summary:
      "The UI asked the server for something and the server failed. The screen can look fine while data never loaded or never saved.",
    detail:
      "Generic HTTP 4xx/5xx on a request the UI made. Not this: a write that returned 400, 409, or 422 after Save (Q-01); HTTP 404 or an in-app 404 page (Q-17).",
  },
  {
    id: "Q-19",
    rule: "fenceViolation",
    chapter: "quality",
    title: "Fence violation",
    summary:
      "The walker left the allowed app. That is leash control, not a product bug — unless a real user can follow the same link out.",
    detail:
      "The fence blocked a hop or redirect off the allowed origin or path. Treat it as a product bug only when a person can take the same exit. Not this: a 404 inside the app (Q-17).",
  },
  {
    id: "Q-20",
    rule: "writePolicyBlocked",
    chapter: "quality",
    title: "Write policy blocked",
    summary: "ClickMonkey refused a write because required fields were already filled. That is policy, not a user-facing defect.",
    detail:
      "writePolicy=validationOnly (or equivalent) skipped a fill or submit. Not this: the product rejected a write (Q-01); Save did nothing (silent Save).",
  },
  {
    id: "Q-21",
    rule: "uiIssue",
    chapter: "quality",
    title: "Host UI issue",
    summary: "A human or charter marked this screenshot as a UI problem. Confirm it is still what users see.",
    detail:
      "Filed with screenshot ui / explore_finding, not a scanner rule. Re-check the shot. Not this: a measured visual class (V-*) or a form/runtime Q-id.",
  },
  {
    id: "Q-22",
    rule: "expectFailed",
    chapter: "quality",
    title: "Step failed",
    summary:
      "The screen did not match the step. Either the flow is broken for users, or a more specific class (silent Save, invalid accepted, typeahead miss) should have remapped this.",
    detail:
      "Leftover expectFailed: locator miss, disabled Save, or a listed picker that never committed. Silent Save is WCAG 3.3.1; accepted invalid is Q-02. Not this: uncaught JavaScript (Q-16).",
  },
] as const satisfies readonly CheckDef[];
export type CatalogRule = (typeof CHECKS)[number]["rule"];

const BY_RULE = new Map<string, CheckDef>(CHECKS.map((c) => [c.rule, c]));

export function checkByRule(rule: string, extras?: ChapterExtras): CheckDef | undefined {
  if (rule === "overflow" && isOverflowAt320(extras)) return undefined;
  return BY_RULE.get(rule);
}

export function checkById(id: string): CheckDef | undefined {
  return CHECKS.find((c) => c.id === id);
}

/** Stable report label: catalog id, else A-{SC} for axe, else undefined (ranked fallback). */
export function catalogIdFor(rule: string, extras?: ChapterExtras): string | undefined {
  const owned = checkByRule(rule, extras);
  if (owned) return owned.id;
  const wcag = wcagOf(rule, extras);
  if (wcag.chapter === "accessibility" && wcag.sc) return `A-${wcag.sc}`;
  return undefined;
}

export function catalogPageHref(id: string): string {
  return `${FINDINGS_SITE}/findings/${id}/`;
}

export function catalogLink(rule: string, extras?: ChapterExtras): { label: string; href: string } | undefined {
  const check = checkByRule(rule, extras);
  if (!check) return undefined;
  if (check.sc) return undefined;
  return { label: check.title, href: catalogPageHref(check.id) };
}
