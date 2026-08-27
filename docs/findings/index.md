---
title: Finding catalog
permalink: /findings/
---

# Finding catalog

What ClickMonkey detects. Ids that start with A- are WCAG success criteria — the official requirement is the W3C Understanding page. HTML-validate and the HTML spec keep their own URLs. T/V/Q pages are ClickMonkey-owned classes with no official catalog.

**Human leftover:** [What a person still tests](qa-left/) — WCAG 2.2 A/AA the walker does not run.

| Id | Rule | Chapter | Spec |
|---|---|---|---|
| [A-2.1.1](A-2.1.1/) | `clickableNonWidget` | accessibility | [WCAG 2.1.1 Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html) |
| [A-2.1.2](A-2.1.2/) | `keyboardTrap` | accessibility | [WCAG 2.1.2 No keyboard trap](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html) |
| [A-2.4.3](A-2.4.3/) | `focusOrder` | accessibility | [WCAG 2.4.3 Focus order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html) |
| [T-01](T-01/) | `missingStableId` | testability | [Missing stable id](https://morkeleb.github.io/clickmonkey/findings/T-01/) |
| [T-02](T-02/) | `duplicateName` | testability | [Duplicate accessible name](https://morkeleb.github.io/clickmonkey/findings/T-02/) |
| [T-03](T-03/) | `opaqueControl` | testability | [Opaque control](https://morkeleb.github.io/clickmonkey/findings/T-03/) |
| [T-04](T-04/) | `unlabeledField` | testability | [Unlabeled field](https://morkeleb.github.io/clickmonkey/findings/T-04/) |
| [T-05](T-05/) | `unnamedControl` | testability | [Unnamed control](https://morkeleb.github.io/clickmonkey/findings/T-05/) |
| [T-06](T-06/) | `unnamedDialog` | testability | [Unnamed dialog](https://morkeleb.github.io/clickmonkey/findings/T-06/) |
| [T-07](T-07/) | `noMain` | testability | [No main landmark](https://morkeleb.github.io/clickmonkey/findings/T-07/) |
| [T-08](T-08/) | `occludedWidget` | testability | [Occluded widget](https://morkeleb.github.io/clickmonkey/findings/T-08/) |
| [T-09](T-09/) | `unknownId` | testability | [Unknown map id](https://morkeleb.github.io/clickmonkey/findings/T-09/) |
| [T-10](T-10/) | `unresolvedId` | testability | [Unresolved locator](https://morkeleb.github.io/clickmonkey/findings/T-10/) |
| [T-11](T-11/) | `driftId` | testability | [Drifted locator](https://morkeleb.github.io/clickmonkey/findings/T-11/) |
| [T-12](T-12/) | `locatorAmbiguous` | testability | [Ambiguous locator](https://morkeleb.github.io/clickmonkey/findings/T-12/) |
| [V-01](V-01/) | `overflow` | visual | [Overflow](https://morkeleb.github.io/clickmonkey/findings/V-01/) |
| [V-02](V-02/) | `clip` | visual | [Clip](https://morkeleb.github.io/clickmonkey/findings/V-02/) |
| [V-03](V-03/) | `overlap` | visual | [Overlap](https://morkeleb.github.io/clickmonkey/findings/V-03/) |
| [V-04](V-04/) | `zIndex` | visual | [Covered hit target](https://morkeleb.github.io/clickmonkey/findings/V-04/) |
| [V-05](V-05/) | `scanline` | visual | [Broken scanline](https://morkeleb.github.io/clickmonkey/findings/V-05/) |
| [V-06](V-06/) | `sparse` | visual | [Sparse main pane](https://morkeleb.github.io/clickmonkey/findings/V-06/) |
| [V-07](V-07/) | `broken` | visual | [Broken image](https://morkeleb.github.io/clickmonkey/findings/V-07/) |
| [V-08](V-08/) | `contrast` | visual | [Unreadable contrast (pixels)](https://morkeleb.github.io/clickmonkey/findings/V-08/) |
| [V-09](V-09/) | `textOcclusion` | visual | [Text occlusion](https://morkeleb.github.io/clickmonkey/findings/V-09/) |
| [V-10](V-10/) | `fontSize` | visual | [Tiny body type](https://morkeleb.github.io/clickmonkey/findings/V-10/) |
| [V-11](V-11/) | `deadHash` | visual | [Dead in-page link](https://morkeleb.github.io/clickmonkey/findings/V-11/) |
| [V-12](V-12/) | `implicitSubmit` | visual | [HTML button type](https://html.spec.whatwg.org/multipage/form-elements.html#attr-button-type) |
| [V-13](V-13/) | `noopener` | visual | [HTML noopener](https://html.spec.whatwg.org/multipage/links.html#link-type-noopener) |
| [V-14](V-14/) | `scrollPadding` | visual | [Scroll padding vs sticky header](https://morkeleb.github.io/clickmonkey/findings/V-14/) |
| [V-15](V-15/) | `pointerEvents` | visual | [pointer-events none](https://morkeleb.github.io/clickmonkey/findings/V-15/) |
| [V-16](V-16/) | `other` | visual | [Other visual](https://morkeleb.github.io/clickmonkey/findings/V-16/) |
| [V-17](V-17/) | `align` | visual | [Broken alignment](https://morkeleb.github.io/clickmonkey/findings/V-17/) |
| [Q-01](Q-01/) | `serverRefusedSubmit` | quality | [Server refused submit](https://morkeleb.github.io/clickmonkey/findings/Q-01/) |
| [Q-02](Q-02/) | `acceptedInvalid` | quality | [Invalid input accepted](https://morkeleb.github.io/clickmonkey/findings/Q-02/) |
| [Q-03](Q-03/) | `throwInsteadOfInvalid` | quality | [Threw instead of invalid](https://morkeleb.github.io/clickmonkey/findings/Q-03/) |
| [Q-04](Q-04/) | `document-title-placeholder` | quality | [Placeholder tab title](https://morkeleb.github.io/clickmonkey/findings/Q-04/) |
| [Q-05](Q-05/) | `document-title-long` | quality | [Long tab title](https://morkeleb.github.io/clickmonkey/findings/Q-05/) |
| [Q-06](Q-06/) | `document-title-same` | quality | [Same tab title on every route](https://morkeleb.github.io/clickmonkey/findings/Q-06/) |
| [Q-07](Q-07/) | `document-title-instance` | quality | [Same tab title on every record](https://morkeleb.github.io/clickmonkey/findings/Q-07/) |
| [Q-08](Q-08/) | `meta-description` | quality | [Missing meta description](https://morkeleb.github.io/clickmonkey/findings/Q-08/) |
| [Q-09](Q-09/) | `og-title` | quality | [Missing Open Graph title](https://morkeleb.github.io/clickmonkey/findings/Q-09/) |
| [Q-10](Q-10/) | `og-description` | quality | [Missing Open Graph description](https://morkeleb.github.io/clickmonkey/findings/Q-10/) |
| [Q-11](Q-11/) | `og-image` | quality | [Missing Open Graph image](https://morkeleb.github.io/clickmonkey/findings/Q-11/) |
| [Q-12](Q-12/) | `og-url` | quality | [Missing Open Graph url](https://morkeleb.github.io/clickmonkey/findings/Q-12/) |
| [Q-13](Q-13/) | `canonical` | quality | [Missing canonical](https://morkeleb.github.io/clickmonkey/findings/Q-13/) |
| [Q-14](Q-14/) | `console.error` | quality | [Console error](https://morkeleb.github.io/clickmonkey/findings/Q-14/) |
| [Q-15](Q-15/) | `console.warning` | quality | [Console warning](https://morkeleb.github.io/clickmonkey/findings/Q-15/) |
| [Q-16](Q-16/) | `pageError` | quality | [Uncaught JavaScript](https://morkeleb.github.io/clickmonkey/findings/Q-16/) |
| [Q-17](Q-17/) | `notFound` | quality | [Not found](https://morkeleb.github.io/clickmonkey/findings/Q-17/) |
| [Q-18](Q-18/) | `httpError` | quality | [HTTP error](https://morkeleb.github.io/clickmonkey/findings/Q-18/) |
| [Q-19](Q-19/) | `fenceViolation` | quality | [Fence violation](https://morkeleb.github.io/clickmonkey/findings/Q-19/) |
| [Q-20](Q-20/) | `writePolicyBlocked` | quality | [Write policy blocked](https://morkeleb.github.io/clickmonkey/findings/Q-20/) |
| [Q-21](Q-21/) | `uiIssue` | quality | [Host UI issue](https://morkeleb.github.io/clickmonkey/findings/Q-21/) |
| [Q-22](Q-22/) | `expectFailed` | quality | [Step failed](https://morkeleb.github.io/clickmonkey/findings/Q-22/) |

Site: https://morkeleb.github.io/clickmonkey/findings/
