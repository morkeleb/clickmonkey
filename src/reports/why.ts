import type { FindingKind } from "../schema/finding.js";

/** One copy-paste paragraph: why this class is worth fixing. Finite set of check results. */
const RULE_WHY: Record<string, string> = {
  // testability
  duplicateName:
    "Two controls share this name, so clicks and screen readers hit the first one. Nested items (a people list under an Employees expander) never get opened or mapped.",
  missingStableId:
    "There is no stable id. The next walk, spec, or retry may not find this control even when it is still on screen.",
  clickableNonWidget:
    "A non-interactive tag has a click handler. Keyboard and screen-reader users cannot reach it, and the walker cannot harvest it as a button or link.",
  opaqueControl:
    "The control has no accessible name. Assistive tech announces a blank widget, and the map cannot give it a stable id.",
  unlabeledField:
    "The field has no label. Users cannot tell what to type, and autofill, specs, and junk-fill targeting all miss.",
  unnamedControl:
    "The control has no name. People using a keyboard or a reader skip it; the walker cannot click it on purpose.",
  unnamedDialog:
    "The dialog has no accessible name. Screen readers say “dialog” with no title, and inspect cannot tell two modals apart.",
  noMain:
    "There is no main landmark. Skip-to-content and the walker’s “this is the page” heuristic fall back to chrome, so the real pane is easy to miss.",
  occludedWidget:
    "A control is covered by another layer. Sighted users may still guess; the walker and keyboard users cannot activate it.",
  // html-validate (seen in Filevine / Milkshake walks)
  "element-permitted-content":
    "Invalid nesting (often a block inside a button). Browsers repair the tree; layout, focus, and clicks then disagree with the source.",
  "attribute-misuse":
    "An attribute is on the wrong element. Assistive tech and validators ignore or misread it, so the intended name or state never arrives.",
  "no-multiple-main":
    "More than one main landmark. Skip-to-content and screen-reader “main” jump to the wrong region — usually a leftover shell.",
  "aria-label-misuse":
    "aria-label sits on a node that does not support it (often a wrapper). The name is dropped; the inner control stays unnamed.",
  "attribute-allowed-values":
    "The attribute value is not allowed. React’s default form action=javascript:… is framework noise; anything else is a real invalid state.",
  "element-required-attributes":
    "A required attribute is missing. The element does not mean what the author thought, so a11y trees and forms break.",
  "no-dup-id":
    "Two nodes share an id. Labels, hrefs, and tests bind to the first; the rest are unreachable.",
  "close-order":
    "Tags close in the wrong order. The DOM the browser builds is not the DOM that was written, so CSS and focus look random.",
  "element-required-content":
    "A required child is missing (often a title-less head). Tabs, search, and readers get an empty document name.",
  "void-content":
    "A void element has children. Browsers discard or hoist them; the visible layout is not the source.",
  // axe
  "nested-interactive":
    "A button or link is inside another. Keyboard users tab twice to one control; the inner action is easy to miss or fire twice.",
  "color-contrast":
    "Text fails contrast. Low-vision users cannot read it; this is almost always a theme token, so one fix covers the shell.",
  "aria-required-parent":
    "A child ARIA role sits outside its required parent (option without listbox). Screen readers never expose the widget.",
  "aria-required-children":
    "A composite widget is missing required children. The control is announced but cannot be used.",
  "aria-hidden-focus":
    "An aria-hidden node is still focusable. Keyboard users land in a black hole (leftover overlay or SVG tabindex).",
  "aria-allowed-attr":
    "This ARIA attribute is not allowed on this role. Readers ignore or mis-announce the state.",
  "button-name":
    "The button has no discernible text. Icon-only chrome with no name is silent to assistive tech and to the map.",
  "link-name":
    "The link has no discernible text. Users and crawlers cannot tell where it goes.",
  label: "A form control is not labeled. Users cannot tell what the field is for.",
  "select-name":
    "The select has no accessible name. Keyboard users get a combo box with no purpose.",
  "scrollable-region-focusable":
    "A scrollable region cannot take focus. Keyboard users cannot scroll to the rest of the content.",
  listitem: "A list item is not inside a list. Screen readers lose the “1 of N” context.",
  tabindex:
    "tabindex is greater than 0. Keyboard order no longer follows the page, so users skip or land in the wrong control.",
  "heading-order":
    "A heading level was skipped (h1 then h3). Screen-reader users hunting by heading miss the section.",
  "skip-link":
    "The skip link does not point at a focusable target. Keyboard users cannot jump past chrome.",
  "empty-heading":
    "A heading has no text. Outline navigation announces a blank section.",
  "label-title-only":
    "The field’s only name is title or a hidden label. Sighted users see a blank control; the accessible name is easy to miss.",
  "aria-dialog-name":
    "The dialog has no accessible name. Screen readers say “dialog” with no title, and inspect cannot tell two modals apart.",
  "label-content-name-mismatch":
    "The visible label is not in the accessible name. Voice control that speaks what is on screen misses the widget (WCAG 2.5.3).",
  "document-title":
    "This route never sets document.title. Every tab and search snippet looks the same.",
  // seo (also axe document-title)
  "document-title-placeholder":
    "The tab still says a framework default (Create Next App, Vite). Search and shared links look unfinished.",
  "document-title-long":
    "The title is longer than ~60 characters and will truncate in search results and tabs.",
  "document-title-same":
    "Every tab shows the same name. Screen readers, search, and people with many tabs cannot tell routes apart.",
  "document-title-instance":
    "Different records share one tab title. Two customer tabs should not both say Customer — put the record name in the title.",
  "meta-description":
    "No unique meta description. Search snippets and social fallbacks are empty or generic.",
  "og-title": "Open Graph title is missing. Shares look untitled.",
  "og-description": "Open Graph description is missing. Shares get no summary.",
  "og-image": "Open Graph image is missing. Shares get no preview picture.",
  "og-url": "Open Graph url is missing. Shares may point at the wrong canonical.",
  canonical: "No rel=canonical. Duplicate URLs can split search ranking.",
  // runtime
  "console.error":
    "JavaScript or a network call failed on this page. The UI may look fine while a save, load, or widget is already broken.",
  "console.warning":
    "The runtime logged a warning. Most are library noise; read the message before treating it as a product bug.",
  pageError:
    "Uncaught JavaScript (`pageerror`). This is not console.error and not a field message — the script crashed.",
  // visual
  overlap: "Two things occupy the same pixels. Users mis-click or cannot read a label.",
  overflow: "Content leaks out of its card, table, or the viewport. It looks broken and can hide a control.",
  clip: "Text or a control is cut off mid-glyph, not a clean ellipsis. Names and amounts become unreadable.",
  zIndex: "A control is covered so it cannot be read or used. The click hits whatever is on top.",
  align: "A row or column is clearly broken, not a 1px taste difference. The eye cannot scan the list.",
  scanline:
    "Repeating items do not share an edge. Scanning a list becomes hunting; it usually means a wrapping cell or mixed padding.",
  sparse:
    "The main pane is left-locked: the form or column stops short and more than half the width is empty on the right. Centered cards are not this; it is unused canvas, not a layout choice.",
  targetSize:
    "The control is smaller than 24×24 CSS pixels and too close to another target, so taps miss or hit the neighbor. Isolated tiny icons with a 24px-clear circle still pass; inline text links are not this.",
  contrast: "Text is unreadable on its background in the screenshot, not only in the WCAG math.",
  broken: "A missing image, empty icon hole, or obvious placeholder instead of content.",
  focusObscured:
    "The control is entirely hidden when it receives keyboard focus (WCAG 2.4.11). Keyboard users cannot see where they are; sticky chrome or a cookie/chat widget ate the focus.",
  focusVisible:
    "The control takes keyboard focus but shows no ring, glow, or border change (WCAG 2.4.7). Keyboard users cannot tell which control is active.",
  textOcclusion:
    "Text is hidden under a control, icon, or badge. Labels and values become unreadable even when the DOM still has the full string.",
  fontSize:
    "Body copy is under 12 CSS pixels. Users zoom or skip the pane; this is not a brand font choice.",
  textSpacing:
    "When line-height, letter-spacing, and word-spacing are increased to WCAG 1.4.12 values, text clips or the pane overflows. Low-vision users who space letters cannot read the control.",
  deadHash:
    "An in-page link points at an id that is not on this screen. Skip-to-content and “jump to section” land nowhere.",
  implicitSubmit:
    "A <button> with no type inside a form defaults to submit. Cancel or a toolbar icon can send the form by accident.",
  noopener:
    "target=_blank without rel=noopener lets the new page rewrite window.opener (tabnabbing) and share the process.",
  scrollPadding:
    "Sticky/fixed header is taller than scroll-padding-top, so keyboard focus and in-page jumps tuck under the chrome (WCAG 2.4.11 companion).",
  pointerEvents:
    "The control is shown and enabled but pointer-events is none, so a mouse click never hits it. Keyboard may still focus it.",
  other: "A user-visible rendering defect that does not fit overlap, clip, or overflow.",
};

const FINDING_WHY: Record<FindingKind, string> = {
  pageError:
    "The page script crashed. Users cannot continue and unsaved work is lost.",
  httpError:
    "The UI asked the server for something and the server failed. The screen can look fine while data never loaded or never saved.",
  notFound:
    "A link, hop, or redirect led to a missing page. Users hit a dead end; the rest of that path is dropped from the map.",
  expectFailed:
    "The screen did not match the step. Either the flow is broken for users, or invalid input was accepted and stored.",
  fenceViolation:
    "The walker left the allowed app. That is leash control, not a product bug — unless a real user can follow the same link out.",
  unknownId:
    "The map named a control that is not on this screen. Walks and specs that depend on it fail even when the product still works.",
  unresolvedId:
    "The locator no longer matches anything. Retries and replay cannot find the control.",
  driftId:
    "The control is still there but its name or locator moved. Old tapes and specs click the wrong widget or none.",
  locatorAmbiguous:
    "Two controls share a locator, so the click hits the first match. The intended action — often a nested nav item — is skipped.",
  writePolicyBlocked:
    "ClickMonkey refused a write because required fields were already filled. That is policy, not a user-facing defect.",
  uiIssue:
    "A human or charter marked this screenshot as a UI problem. Confirm it is still what users see.",
  visualIssue:
    "The layout is broken in the pixels: text or controls collide, clip, or cannot be read. People bounce or mis-click.",
};

export function whyRule(rule: string): string | undefined {
  return RULE_WHY[rule];
}

export function whyFinding(kind: FindingKind, message: string): string {
  if (kind === "expectFailed") {
    if (/accepted empty|did not catch|validation did not/i.test(message)) {
      return "Invalid or empty input was accepted. Bad data can be stored, billed, or shown to other users.";
    }
    if (/was not found|Timeout \d+ms exceeded|locator\./i.test(message)) {
      return "The walker could not find or click the control. Users may still see it, but specs and retries will flake, and a duplicate name often means the wrong match was targeted.";
    }
    if (/\bis disabled\b/i.test(message)) {
      return "Save (or another primary action) stayed disabled. The form is usually still on screen; the button is off until a change is registered, validation passes, or a section is unlocked.";
    }
  }
  if (kind === "pageError" && /validation is missing|junk value that crashes/i.test(message)) {
    return "A junk value should show a field error, not crash the tab. The same input in production takes the page down.";
  }
  if (kind === "httpError" && /\b403\b/.test(message)) {
    return "The API refused this user. If the nav item is still visible, people click into a dead end; if 403 is expected, the link should not be there.";
  }
  return FINDING_WHY[kind];
}

export function whyFindingBlock(kind: FindingKind, message: string, override?: string): string {
  const why = (override?.trim() || whyFinding(kind, message)).trim();
  return why
    .split(/\n+/)
    .map((line) => `> ${line}`)
    .join("\n");
}


