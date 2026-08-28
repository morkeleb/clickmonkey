---
title: Finding catalog
permalink: /findings/
---

# Finding catalog

Rules this walker reports. ClickMonkey pages exist only when there is no official spec. AXE, WCAG, html-validate, and HTML link the canonical page — we do not republish it.

- [ClickMonkey](#clickmonkey) — classes we named
- [AXE](#axe) — [axe 4.13](https://dequeuniversity.com/rules/axe/4.13)
- [WCAG](#wcag) — DOM checks we run (not axe)
- [html-validate](#html-validate) — [html-validate rules](https://html-validate.org/rules/)
- [HTML](#html) — [HTML Living Standard](https://html.spec.whatwg.org/multipage/)
- [What a person still tests](qa-left/) — leftover WCAG 2.2 A/AA

## ClickMonkey

These pages are the spec. No W3C / Deque / html-validate / WHATWG page covers them.

| Id | Rule | Chapter | Title |
|---|---|---|---|
| [T-01](T-01/) | `missingStableId` | testability | Missing stable id |
| [T-02](T-02/) | `duplicateName` | testability | Duplicate accessible name |
| [T-03](T-03/) | `opaqueControl` | testability | Opaque control |
| [T-04](T-04/) | `unlabeledField` | testability | Unlabeled field |
| [T-05](T-05/) | `unnamedControl` | testability | Unnamed control |
| [T-06](T-06/) | `unnamedDialog` | testability | Unnamed dialog |
| [T-07](T-07/) | `noMain` | testability | No main landmark |
| [T-08](T-08/) | `occludedWidget` | testability | Occluded widget |
| [T-09](T-09/) | `unknownId` | testability | Unknown map id |
| [T-10](T-10/) | `unresolvedId` | testability | Unresolved locator |
| [T-11](T-11/) | `driftId` | testability | Drifted locator |
| [T-12](T-12/) | `locatorAmbiguous` | testability | Ambiguous locator |
| [V-01](V-01/) | `overflow` | visual | Overflow |
| [V-02](V-02/) | `clip` | visual | Clip |
| [V-03](V-03/) | `overlap` | visual | Overlap |
| [V-04](V-04/) | `zIndex` | visual | Covered hit target |
| [V-05](V-05/) | `scanline` | visual | Broken scanline |
| [V-06](V-06/) | `sparse` | visual | Sparse main pane |
| [V-07](V-07/) | `broken` | visual | Broken image |
| [V-08](V-08/) | `contrast` | visual | Unreadable contrast (pixels) |
| [V-09](V-09/) | `textOcclusion` | visual | Text occlusion |
| [V-10](V-10/) | `fontSize` | visual | Tiny body type |
| [V-11](V-11/) | `deadHash` | visual | Dead in-page link |
| [V-14](V-14/) | `scrollPadding` | visual | Scroll padding vs sticky header |
| [V-15](V-15/) | `pointerEvents` | visual | pointer-events none |
| [V-16](V-16/) | `other` | visual | Other visual |
| [V-17](V-17/) | `align` | visual | Broken alignment |
| [Q-01](Q-01/) | `serverRefusedSubmit` | quality | Server refused submit |
| [Q-02](Q-02/) | `acceptedInvalid` | quality | Invalid input accepted |
| [Q-03](Q-03/) | `throwInsteadOfInvalid` | quality | Threw instead of invalid |
| [Q-04](Q-04/) | `document-title-placeholder` | quality | Placeholder tab title |
| [Q-05](Q-05/) | `document-title-long` | quality | Long tab title |
| [Q-06](Q-06/) | `document-title-same` | quality | Same tab title on every route |
| [Q-07](Q-07/) | `document-title-instance` | quality | Same tab title on every record |
| [Q-08](Q-08/) | `meta-description` | quality | Missing meta description |
| [Q-09](Q-09/) | `og-title` | quality | Missing Open Graph title |
| [Q-10](Q-10/) | `og-description` | quality | Missing Open Graph description |
| [Q-11](Q-11/) | `og-image` | quality | Missing Open Graph image |
| [Q-12](Q-12/) | `og-url` | quality | Missing Open Graph url |
| [Q-13](Q-13/) | `canonical` | quality | Missing canonical |
| [Q-14](Q-14/) | `console.error` | quality | Console error |
| [Q-15](Q-15/) | `console.warning` | quality | Console warning |
| [Q-16](Q-16/) | `pageError` | quality | Uncaught JavaScript |
| [Q-17](Q-17/) | `notFound` | quality | Not found |
| [Q-18](Q-18/) | `httpError` | quality | HTTP error |
| [Q-22](Q-22/) | `expectFailed` | quality | Step failed |

## AXE

axe-core after inspect (`wcag2a` / `wcag2aa` / `wcag21a` / `wcag21aa` plus extras). Reports tag **AXE {rule}**.

| Check | Rule | SC |
|---|---|---|
| [AXE area-alt](https://dequeuniversity.com/rules/axe/4.13/area-alt) | `area-alt` | 1.1.1 A |
| [AXE aria-allowed-attr](https://dequeuniversity.com/rules/axe/4.13/aria-allowed-attr) | `aria-allowed-attr` | 4.1.2 A |
| [AXE aria-braille-equivalent](https://dequeuniversity.com/rules/axe/4.13/aria-braille-equivalent) | `aria-braille-equivalent` | 4.1.2 A |
| [AXE aria-command-name](https://dequeuniversity.com/rules/axe/4.13/aria-command-name) | `aria-command-name` | 4.1.2 A |
| [AXE aria-conditional-attr](https://dequeuniversity.com/rules/axe/4.13/aria-conditional-attr) | `aria-conditional-attr` | 4.1.2 A |
| [AXE aria-deprecated-role](https://dequeuniversity.com/rules/axe/4.13/aria-deprecated-role) | `aria-deprecated-role` | 4.1.2 A |
| [AXE aria-dialog-name](https://dequeuniversity.com/rules/axe/4.13/aria-dialog-name) | `aria-dialog-name` | 4.1.2 A |
| [AXE aria-hidden-body](https://dequeuniversity.com/rules/axe/4.13/aria-hidden-body) | `aria-hidden-body` | 4.1.2 A |
| [AXE aria-hidden-focus](https://dequeuniversity.com/rules/axe/4.13/aria-hidden-focus) | `aria-hidden-focus` | 4.1.2 A |
| [AXE aria-input-field-name](https://dequeuniversity.com/rules/axe/4.13/aria-input-field-name) | `aria-input-field-name` | 4.1.2 A |
| [AXE aria-meter-name](https://dequeuniversity.com/rules/axe/4.13/aria-meter-name) | `aria-meter-name` | 1.1.1 A |
| [AXE aria-progressbar-name](https://dequeuniversity.com/rules/axe/4.13/aria-progressbar-name) | `aria-progressbar-name` | 1.1.1 A |
| [AXE aria-prohibited-attr](https://dequeuniversity.com/rules/axe/4.13/aria-prohibited-attr) | `aria-prohibited-attr` | 4.1.2 A |
| [AXE aria-required-attr](https://dequeuniversity.com/rules/axe/4.13/aria-required-attr) | `aria-required-attr` | 4.1.2 A |
| [AXE aria-required-children](https://dequeuniversity.com/rules/axe/4.13/aria-required-children) | `aria-required-children` | 1.3.1 A |
| [AXE aria-required-parent](https://dequeuniversity.com/rules/axe/4.13/aria-required-parent) | `aria-required-parent` | 1.3.1 A |
| [AXE aria-roles](https://dequeuniversity.com/rules/axe/4.13/aria-roles) | `aria-roles` | 4.1.2 A |
| [AXE aria-tab-name](https://dequeuniversity.com/rules/axe/4.13/aria-tab-name) | `aria-tab-name` | 4.1.2 A |
| [AXE aria-toggle-field-name](https://dequeuniversity.com/rules/axe/4.13/aria-toggle-field-name) | `aria-toggle-field-name` | 4.1.2 A |
| [AXE aria-tooltip-name](https://dequeuniversity.com/rules/axe/4.13/aria-tooltip-name) | `aria-tooltip-name` | 4.1.2 A |
| [AXE aria-valid-attr](https://dequeuniversity.com/rules/axe/4.13/aria-valid-attr) | `aria-valid-attr` | 4.1.2 A |
| [AXE aria-valid-attr-value](https://dequeuniversity.com/rules/axe/4.13/aria-valid-attr-value) | `aria-valid-attr-value` | 4.1.2 A |
| [AXE autocomplete-valid](https://dequeuniversity.com/rules/axe/4.13/autocomplete-valid) | `autocomplete-valid` | 1.3.5 AA |
| [AXE avoid-inline-spacing](https://dequeuniversity.com/rules/axe/4.13/avoid-inline-spacing) | `avoid-inline-spacing` | 1.4.12 AA |
| [AXE blink](https://dequeuniversity.com/rules/axe/4.13/blink) | `blink` | 2.2.2 A |
| [AXE button-name](https://dequeuniversity.com/rules/axe/4.13/button-name) | `button-name` | 4.1.2 A |
| [AXE bypass](https://dequeuniversity.com/rules/axe/4.13/bypass) | `bypass` | 2.4.1 A |
| [AXE color-contrast](https://dequeuniversity.com/rules/axe/4.13/color-contrast) | `color-contrast` | 1.4.3 AA |
| [AXE definition-list](https://dequeuniversity.com/rules/axe/4.13/definition-list) | `definition-list` | 1.3.1 A |
| [AXE dlitem](https://dequeuniversity.com/rules/axe/4.13/dlitem) | `dlitem` | 1.3.1 A |
| [AXE document-title](https://dequeuniversity.com/rules/axe/4.13/document-title) | `document-title` | 2.4.2 A |
| [AXE duplicate-id-aria](https://dequeuniversity.com/rules/axe/4.13/duplicate-id-aria) | `duplicate-id-aria` | 4.1.2 A |
| [AXE empty-heading](https://dequeuniversity.com/rules/axe/4.13/empty-heading) | `empty-heading` | — |
| [AXE form-field-multiple-labels](https://dequeuniversity.com/rules/axe/4.13/form-field-multiple-labels) | `form-field-multiple-labels` | 3.3.2 A |
| [AXE frame-focusable-content](https://dequeuniversity.com/rules/axe/4.13/frame-focusable-content) | `frame-focusable-content` | 2.1.1 A |
| [AXE frame-title](https://dequeuniversity.com/rules/axe/4.13/frame-title) | `frame-title` | 4.1.2 A |
| [AXE frame-title-unique](https://dequeuniversity.com/rules/axe/4.13/frame-title-unique) | `frame-title-unique` | 4.1.2 A |
| [AXE heading-order](https://dequeuniversity.com/rules/axe/4.13/heading-order) | `heading-order` | — |
| [AXE html-has-lang](https://dequeuniversity.com/rules/axe/4.13/html-has-lang) | `html-has-lang` | 3.1.1 A |
| [AXE html-lang-valid](https://dequeuniversity.com/rules/axe/4.13/html-lang-valid) | `html-lang-valid` | 3.1.1 A |
| [AXE html-xml-lang-mismatch](https://dequeuniversity.com/rules/axe/4.13/html-xml-lang-mismatch) | `html-xml-lang-mismatch` | 3.1.1 A |
| [AXE image-alt](https://dequeuniversity.com/rules/axe/4.13/image-alt) | `image-alt` | 1.1.1 A |
| [AXE input-button-name](https://dequeuniversity.com/rules/axe/4.13/input-button-name) | `input-button-name` | 4.1.2 A |
| [AXE input-image-alt](https://dequeuniversity.com/rules/axe/4.13/input-image-alt) | `input-image-alt` | 1.1.1 A |
| [AXE label](https://dequeuniversity.com/rules/axe/4.13/label) | `label` | 4.1.2 A |
| [AXE label-content-name-mismatch](https://dequeuniversity.com/rules/axe/4.13/label-content-name-mismatch) | `label-content-name-mismatch` | 2.5.3 AA |
| [AXE label-title-only](https://dequeuniversity.com/rules/axe/4.13/label-title-only) | `label-title-only` | — |
| [AXE link-in-text-block](https://dequeuniversity.com/rules/axe/4.13/link-in-text-block) | `link-in-text-block` | 1.4.1 A |
| [AXE link-name](https://dequeuniversity.com/rules/axe/4.13/link-name) | `link-name` | 4.1.2 A |
| [AXE list](https://dequeuniversity.com/rules/axe/4.13/list) | `list` | 1.3.1 A |
| [AXE listitem](https://dequeuniversity.com/rules/axe/4.13/listitem) | `listitem` | 1.3.1 A |
| [AXE marquee](https://dequeuniversity.com/rules/axe/4.13/marquee) | `marquee` | 2.2.2 A |
| [AXE meta-refresh](https://dequeuniversity.com/rules/axe/4.13/meta-refresh) | `meta-refresh` | 2.2.1 A |
| [AXE meta-viewport](https://dequeuniversity.com/rules/axe/4.13/meta-viewport) | `meta-viewport` | 1.4.4 AA |
| [AXE nested-interactive](https://dequeuniversity.com/rules/axe/4.13/nested-interactive) | `nested-interactive` | 4.1.2 A |
| [AXE no-autoplay-audio](https://dequeuniversity.com/rules/axe/4.13/no-autoplay-audio) | `no-autoplay-audio` | 1.4.2 A |
| [AXE object-alt](https://dequeuniversity.com/rules/axe/4.13/object-alt) | `object-alt` | 1.1.1 A |
| [AXE role-img-alt](https://dequeuniversity.com/rules/axe/4.13/role-img-alt) | `role-img-alt` | 1.1.1 A |
| [AXE scrollable-region-focusable](https://dequeuniversity.com/rules/axe/4.13/scrollable-region-focusable) | `scrollable-region-focusable` | 2.1.1 A |
| [AXE select-name](https://dequeuniversity.com/rules/axe/4.13/select-name) | `select-name` | 4.1.2 A |
| [AXE server-side-image-map](https://dequeuniversity.com/rules/axe/4.13/server-side-image-map) | `server-side-image-map` | 2.1.1 A |
| [AXE skip-link](https://dequeuniversity.com/rules/axe/4.13/skip-link) | `skip-link` | 2.4.1 A |
| [AXE summary-name](https://dequeuniversity.com/rules/axe/4.13/summary-name) | `summary-name` | 4.1.2 A |
| [AXE svg-img-alt](https://dequeuniversity.com/rules/axe/4.13/svg-img-alt) | `svg-img-alt` | 1.1.1 A |
| [AXE tabindex](https://dequeuniversity.com/rules/axe/4.13/tabindex) | `tabindex` | — |
| [AXE td-headers-attr](https://dequeuniversity.com/rules/axe/4.13/td-headers-attr) | `td-headers-attr` | 1.3.1 A |
| [AXE th-has-data-cells](https://dequeuniversity.com/rules/axe/4.13/th-has-data-cells) | `th-has-data-cells` | 1.3.1 A |
| [AXE valid-lang](https://dequeuniversity.com/rules/axe/4.13/valid-lang) | `valid-lang` | 3.1.2 AA |
| [AXE video-caption](https://dequeuniversity.com/rules/axe/4.13/video-caption) | `video-caption` | 1.2.2 A |

## WCAG

DOM detectors ClickMonkey runs itself. Reports tag **WCAG {sc}**. The W3C Understanding page is the spec.

| Check | Rule |
|---|---|
| [WCAG 1.4.12 Text spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html) | `textSpacing` |
| [WCAG 2.1.1 Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html) | `clickableNonWidget` |
| [WCAG 2.1.2 No keyboard trap](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html) | `keyboardTrap` |
| [WCAG 2.4.3 Focus order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html) | `focusOrder` |
| [WCAG 2.4.7 Focus visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) | `focusVisible` |
| [WCAG 2.4.11 Focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) | `focusObscured` |
| [WCAG 2.5.8 Target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | `targetSize` |
| [WCAG 3.3.1 Error Identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html) | `silentSubmit` |

## html-validate

html-validate:standard after inspect. Reports tag **html-validate {rule}**.

| Check | Rule |
|---|---|
| [html-validate element-permitted-content](https://html-validate.org/rules/element-permitted-content.html) | `element-permitted-content` |
| [html-validate attribute-misuse](https://html-validate.org/rules/attribute-misuse.html) | `attribute-misuse` |
| [html-validate no-multiple-main](https://html-validate.org/rules/no-multiple-main.html) | `no-multiple-main` |
| [html-validate aria-label-misuse](https://html-validate.org/rules/aria-label-misuse.html) | `aria-label-misuse` |
| [html-validate attribute-allowed-values](https://html-validate.org/rules/attribute-allowed-values.html) | `attribute-allowed-values` |
| [html-validate element-required-attributes](https://html-validate.org/rules/element-required-attributes.html) | `element-required-attributes` |
| [html-validate no-dup-id](https://html-validate.org/rules/no-dup-id.html) | `no-dup-id` |
| [html-validate close-order](https://html-validate.org/rules/close-order.html) | `close-order` |
| [html-validate element-required-content](https://html-validate.org/rules/element-required-content.html) | `element-required-content` |
| [html-validate void-content](https://html-validate.org/rules/void-content.html) | `void-content` |

## HTML

Reports tag the WHATWG name. `implicitSubmit` / `noopener` are how we detect them.

| Check | Rule |
|---|---|
| [HTML button type](https://html.spec.whatwg.org/multipage/form-elements.html#attr-button-type) | `implicitSubmit` |
| [HTML noopener](https://html.spec.whatwg.org/multipage/links.html#link-type-noopener) | `noopener` |

Site: https://morkeleb.github.io/clickmonkey/findings/
