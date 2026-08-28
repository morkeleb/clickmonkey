---
title: Finding catalog
permalink: /findings/
---

# Finding catalog

Rules this walker reports, grouped by who owns the spec. Original pages are in the other lists; ClickMonkey pages are only for classes we named.

- [ClickMonkey](#clickmonkey) — T/V/Q classes we own
- [AXE](#axe) — axe-core 4.13 ([rule list](https://dequeuniversity.com/rules/axe/4.13))
- [WCAG](#wcag) — DOM checks we run (not axe)
- [html-validate](#html-validate) — HTML authoring
- [HTML](#html) — WHATWG
- [What a person still tests](qa-left/) — leftover WCAG 2.2 A/AA

## ClickMonkey

These pages are the spec. Reports link here so T/V/Q ids do not shuffle.

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

axe-core after inspect (`wcag2a` / `wcag2aa` / `wcag21a` / `wcag21aa` plus extras). Original: Deque University.

| Rule | Original | SC |
|---|---|---|
| `area-alt` | [AXE area-alt](https://dequeuniversity.com/rules/axe/4.13/area-alt) | 1.1.1 A |
| `aria-allowed-attr` | [AXE aria-allowed-attr](https://dequeuniversity.com/rules/axe/4.13/aria-allowed-attr) | 4.1.2 A |
| `aria-braille-equivalent` | [AXE aria-braille-equivalent](https://dequeuniversity.com/rules/axe/4.13/aria-braille-equivalent) | 4.1.2 A |
| `aria-command-name` | [AXE aria-command-name](https://dequeuniversity.com/rules/axe/4.13/aria-command-name) | 4.1.2 A |
| `aria-conditional-attr` | [AXE aria-conditional-attr](https://dequeuniversity.com/rules/axe/4.13/aria-conditional-attr) | 4.1.2 A |
| `aria-deprecated-role` | [AXE aria-deprecated-role](https://dequeuniversity.com/rules/axe/4.13/aria-deprecated-role) | 4.1.2 A |
| `aria-dialog-name` | [AXE aria-dialog-name](https://dequeuniversity.com/rules/axe/4.13/aria-dialog-name) | 4.1.2 A |
| `aria-hidden-body` | [AXE aria-hidden-body](https://dequeuniversity.com/rules/axe/4.13/aria-hidden-body) | 4.1.2 A |
| `aria-hidden-focus` | [AXE aria-hidden-focus](https://dequeuniversity.com/rules/axe/4.13/aria-hidden-focus) | 4.1.2 A |
| `aria-input-field-name` | [AXE aria-input-field-name](https://dequeuniversity.com/rules/axe/4.13/aria-input-field-name) | 4.1.2 A |
| `aria-meter-name` | [AXE aria-meter-name](https://dequeuniversity.com/rules/axe/4.13/aria-meter-name) | 1.1.1 A |
| `aria-progressbar-name` | [AXE aria-progressbar-name](https://dequeuniversity.com/rules/axe/4.13/aria-progressbar-name) | 1.1.1 A |
| `aria-prohibited-attr` | [AXE aria-prohibited-attr](https://dequeuniversity.com/rules/axe/4.13/aria-prohibited-attr) | 4.1.2 A |
| `aria-required-attr` | [AXE aria-required-attr](https://dequeuniversity.com/rules/axe/4.13/aria-required-attr) | 4.1.2 A |
| `aria-required-children` | [AXE aria-required-children](https://dequeuniversity.com/rules/axe/4.13/aria-required-children) | 1.3.1 A |
| `aria-required-parent` | [AXE aria-required-parent](https://dequeuniversity.com/rules/axe/4.13/aria-required-parent) | 1.3.1 A |
| `aria-roles` | [AXE aria-roles](https://dequeuniversity.com/rules/axe/4.13/aria-roles) | 4.1.2 A |
| `aria-tab-name` | [AXE aria-tab-name](https://dequeuniversity.com/rules/axe/4.13/aria-tab-name) | 4.1.2 A |
| `aria-toggle-field-name` | [AXE aria-toggle-field-name](https://dequeuniversity.com/rules/axe/4.13/aria-toggle-field-name) | 4.1.2 A |
| `aria-tooltip-name` | [AXE aria-tooltip-name](https://dequeuniversity.com/rules/axe/4.13/aria-tooltip-name) | 4.1.2 A |
| `aria-valid-attr` | [AXE aria-valid-attr](https://dequeuniversity.com/rules/axe/4.13/aria-valid-attr) | 4.1.2 A |
| `aria-valid-attr-value` | [AXE aria-valid-attr-value](https://dequeuniversity.com/rules/axe/4.13/aria-valid-attr-value) | 4.1.2 A |
| `autocomplete-valid` | [AXE autocomplete-valid](https://dequeuniversity.com/rules/axe/4.13/autocomplete-valid) | 1.3.5 AA |
| `avoid-inline-spacing` | [AXE avoid-inline-spacing](https://dequeuniversity.com/rules/axe/4.13/avoid-inline-spacing) | 1.4.12 AA |
| `blink` | [AXE blink](https://dequeuniversity.com/rules/axe/4.13/blink) | 2.2.2 A |
| `button-name` | [AXE button-name](https://dequeuniversity.com/rules/axe/4.13/button-name) | 4.1.2 A |
| `bypass` | [AXE bypass](https://dequeuniversity.com/rules/axe/4.13/bypass) | 2.4.1 A |
| `color-contrast` | [AXE color-contrast](https://dequeuniversity.com/rules/axe/4.13/color-contrast) | 1.4.3 AA |
| `definition-list` | [AXE definition-list](https://dequeuniversity.com/rules/axe/4.13/definition-list) | 1.3.1 A |
| `dlitem` | [AXE dlitem](https://dequeuniversity.com/rules/axe/4.13/dlitem) | 1.3.1 A |
| `document-title` | [AXE document-title](https://dequeuniversity.com/rules/axe/4.13/document-title) | 2.4.2 A |
| `duplicate-id-aria` | [AXE duplicate-id-aria](https://dequeuniversity.com/rules/axe/4.13/duplicate-id-aria) | 4.1.2 A |
| `empty-heading` | [AXE empty-heading](https://dequeuniversity.com/rules/axe/4.13/empty-heading) | — |
| `form-field-multiple-labels` | [AXE form-field-multiple-labels](https://dequeuniversity.com/rules/axe/4.13/form-field-multiple-labels) | 3.3.2 A |
| `frame-focusable-content` | [AXE frame-focusable-content](https://dequeuniversity.com/rules/axe/4.13/frame-focusable-content) | 2.1.1 A |
| `frame-title` | [AXE frame-title](https://dequeuniversity.com/rules/axe/4.13/frame-title) | 4.1.2 A |
| `frame-title-unique` | [AXE frame-title-unique](https://dequeuniversity.com/rules/axe/4.13/frame-title-unique) | 4.1.2 A |
| `heading-order` | [AXE heading-order](https://dequeuniversity.com/rules/axe/4.13/heading-order) | — |
| `html-has-lang` | [AXE html-has-lang](https://dequeuniversity.com/rules/axe/4.13/html-has-lang) | 3.1.1 A |
| `html-lang-valid` | [AXE html-lang-valid](https://dequeuniversity.com/rules/axe/4.13/html-lang-valid) | 3.1.1 A |
| `html-xml-lang-mismatch` | [AXE html-xml-lang-mismatch](https://dequeuniversity.com/rules/axe/4.13/html-xml-lang-mismatch) | 3.1.1 A |
| `image-alt` | [AXE image-alt](https://dequeuniversity.com/rules/axe/4.13/image-alt) | 1.1.1 A |
| `input-button-name` | [AXE input-button-name](https://dequeuniversity.com/rules/axe/4.13/input-button-name) | 4.1.2 A |
| `input-image-alt` | [AXE input-image-alt](https://dequeuniversity.com/rules/axe/4.13/input-image-alt) | 1.1.1 A |
| `label` | [AXE label](https://dequeuniversity.com/rules/axe/4.13/label) | 4.1.2 A |
| `label-content-name-mismatch` | [AXE label-content-name-mismatch](https://dequeuniversity.com/rules/axe/4.13/label-content-name-mismatch) | 2.5.3 AA |
| `label-title-only` | [AXE label-title-only](https://dequeuniversity.com/rules/axe/4.13/label-title-only) | — |
| `link-in-text-block` | [AXE link-in-text-block](https://dequeuniversity.com/rules/axe/4.13/link-in-text-block) | 1.4.1 A |
| `link-name` | [AXE link-name](https://dequeuniversity.com/rules/axe/4.13/link-name) | 4.1.2 A |
| `list` | [AXE list](https://dequeuniversity.com/rules/axe/4.13/list) | 1.3.1 A |
| `listitem` | [AXE listitem](https://dequeuniversity.com/rules/axe/4.13/listitem) | 1.3.1 A |
| `marquee` | [AXE marquee](https://dequeuniversity.com/rules/axe/4.13/marquee) | 2.2.2 A |
| `meta-refresh` | [AXE meta-refresh](https://dequeuniversity.com/rules/axe/4.13/meta-refresh) | 2.2.1 A |
| `meta-viewport` | [AXE meta-viewport](https://dequeuniversity.com/rules/axe/4.13/meta-viewport) | 1.4.4 AA |
| `nested-interactive` | [AXE nested-interactive](https://dequeuniversity.com/rules/axe/4.13/nested-interactive) | 4.1.2 A |
| `no-autoplay-audio` | [AXE no-autoplay-audio](https://dequeuniversity.com/rules/axe/4.13/no-autoplay-audio) | 1.4.2 A |
| `object-alt` | [AXE object-alt](https://dequeuniversity.com/rules/axe/4.13/object-alt) | 1.1.1 A |
| `role-img-alt` | [AXE role-img-alt](https://dequeuniversity.com/rules/axe/4.13/role-img-alt) | 1.1.1 A |
| `scrollable-region-focusable` | [AXE scrollable-region-focusable](https://dequeuniversity.com/rules/axe/4.13/scrollable-region-focusable) | 2.1.1 A |
| `select-name` | [AXE select-name](https://dequeuniversity.com/rules/axe/4.13/select-name) | 4.1.2 A |
| `server-side-image-map` | [AXE server-side-image-map](https://dequeuniversity.com/rules/axe/4.13/server-side-image-map) | 2.1.1 A |
| `skip-link` | [AXE skip-link](https://dequeuniversity.com/rules/axe/4.13/skip-link) | 2.4.1 A |
| `summary-name` | [AXE summary-name](https://dequeuniversity.com/rules/axe/4.13/summary-name) | 4.1.2 A |
| `svg-img-alt` | [AXE svg-img-alt](https://dequeuniversity.com/rules/axe/4.13/svg-img-alt) | 1.1.1 A |
| `tabindex` | [AXE tabindex](https://dequeuniversity.com/rules/axe/4.13/tabindex) | — |
| `td-headers-attr` | [AXE td-headers-attr](https://dequeuniversity.com/rules/axe/4.13/td-headers-attr) | 1.3.1 A |
| `th-has-data-cells` | [AXE th-has-data-cells](https://dequeuniversity.com/rules/axe/4.13/th-has-data-cells) | 1.3.1 A |
| `valid-lang` | [AXE valid-lang](https://dequeuniversity.com/rules/axe/4.13/valid-lang) | 3.1.2 AA |
| `video-caption` | [AXE video-caption](https://dequeuniversity.com/rules/axe/4.13/video-caption) | 1.2.2 A |

## WCAG

DOM detectors ClickMonkey runs itself. Original: W3C Understanding. `A-*` is only a handle when we also have a catalog page.

| Rule | Original | Our page |
|---|---|---|
| `textSpacing` | [WCAG 1.4.12 Text spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html) |  |
| `clickableNonWidget` | [WCAG 2.1.1 Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html) | [A-2.1.1](A-2.1.1/) |
| `keyboardTrap` | [WCAG 2.1.2 No keyboard trap](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html) | [A-2.1.2](A-2.1.2/) |
| `focusOrder` | [WCAG 2.4.3 Focus order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html) | [A-2.4.3](A-2.4.3/) |
| `focusVisible` | [WCAG 2.4.7 Focus visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) |  |
| `focusObscured` | [WCAG 2.4.11 Focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) |  |
| `targetSize` | [WCAG 2.5.8 Target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) |  |
| `silentSubmit` | [WCAG 3.3.1 Error Identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html) |  |

## html-validate

html-validate:standard after inspect. Reports tag these as **html-validate {rule}**. Original: [html-validate rules](https://html-validate.org/rules/).

| Check | Rule | Original |
|---|---|---|
| [html-validate element-permitted-content](html-validate-element-permitted-content/) | `element-permitted-content` | [html-validate element-permitted-content](https://html-validate.org/rules/element-permitted-content.html) |
| [html-validate attribute-misuse](html-validate-attribute-misuse/) | `attribute-misuse` | [html-validate attribute-misuse](https://html-validate.org/rules/attribute-misuse.html) |
| [html-validate no-multiple-main](html-validate-no-multiple-main/) | `no-multiple-main` | [html-validate no-multiple-main](https://html-validate.org/rules/no-multiple-main.html) |
| [html-validate aria-label-misuse](html-validate-aria-label-misuse/) | `aria-label-misuse` | [html-validate aria-label-misuse](https://html-validate.org/rules/aria-label-misuse.html) |
| [html-validate attribute-allowed-values](html-validate-attribute-allowed-values/) | `attribute-allowed-values` | [html-validate attribute-allowed-values](https://html-validate.org/rules/attribute-allowed-values.html) |
| [html-validate element-required-attributes](html-validate-element-required-attributes/) | `element-required-attributes` | [html-validate element-required-attributes](https://html-validate.org/rules/element-required-attributes.html) |
| [html-validate no-dup-id](html-validate-no-dup-id/) | `no-dup-id` | [html-validate no-dup-id](https://html-validate.org/rules/no-dup-id.html) |
| [html-validate close-order](html-validate-close-order/) | `close-order` | [html-validate close-order](https://html-validate.org/rules/close-order.html) |
| [html-validate element-required-content](html-validate-element-required-content/) | `element-required-content` | [html-validate element-required-content](https://html-validate.org/rules/element-required-content.html) |
| [html-validate void-content](html-validate-void-content/) | `void-content` | [html-validate void-content](https://html-validate.org/rules/void-content.html) |

## HTML

Original: [HTML Living Standard](https://html.spec.whatwg.org/multipage/).

| Rule | Original | Our page |
|---|---|---|
| `implicitSubmit` | [HTML button type](https://html.spec.whatwg.org/multipage/form-elements.html#attr-button-type) | [V-12](V-12/) |
| `noopener` | [HTML noopener](https://html.spec.whatwg.org/multipage/links.html#link-type-noopener) | [V-13](V-13/) |

Site: https://morkeleb.github.io/clickmonkey/findings/
