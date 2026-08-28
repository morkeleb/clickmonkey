---
title: "What a person still tests"
permalink: /findings/qa-left/
---

# What a person still tests

ClickMonkey soaks chrome, locators, HTML/axe, form Tab (2.1.2 trap, 2.4.3 order), and the layout extras. It does **not** replace someone who knows the product. This page is the leftover **WCAG 2.2 A/AA** list — use it as a session checklist on a real flow.

2.1.2 and 2.4.3 are covered by the form Tab walk. Spec: [WCAG 2.1.2](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html), [WCAG 2.4.3](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html). AAA is out of scope.

| SC | Gap | Why the walker skips it | What you do |
|---|---|---|---|
| 1.2.x A | Media captions / audio description | Needs the actual video or audio asset, plus a transcript or described track. | Play every clip. Captions (1.2.2), audio-only transcript (1.2.1), and audio description (1.2.3/1.2.5) where the spec requires them. |
| 1.3.2 A | Meaningful sequence | Reading order vs visual order is a judgment call. Form Tab (2.4.3) only covers keyboard stops, not headings, lists, or CSS that reshuffles prose. | Disable CSS or walk the accessibility tree. Headings, tables, and paragraphs should still make sense in DOM order. |
| 1.3.3 A | Sensory characteristics | “Click the round button on the right” is copy, not geometry. | Instructions that name only shape, color, or position fail. They need a name or text as well. |
| 1.4.5 AA | Images of text | A screenshot of words is not a contrast or alt check. | If the same text could be HTML/CSS, it should be. Logos are the usual exception. |
| 1.4.11 AA | Non-text contrast | Axe contrast is text. Icons, input borders, and focus-adjacent graphics are separate. | UI components and graphical objects against adjacent colors need 3:1. Check empty inputs and icon-only chrome. |
| 1.4.13 AA | Content on hover or focus | Tooltips and mega-menus are pointer-path dependent. | Hover and keyboard-focus popovers must be dismissible, hoverable, and persistent until dismissed or focus moves. |
| 2.1.4 A | Character-key shortcuts | A single-letter accesskey is not automatically a fail; it needs a way to turn off or remap. | If a letter key fires a command with focus in a text field, that is the bug. Document or disable the shortcut. |
| 2.2.2 A | Pause, stop, hide | Axe catches blink/marquee. Auto-rotating carousels and background video are not that. | Anything that moves, blinks, or auto-updates for more than five seconds needs a pause control. |
| 2.3.1 A | Three flashes | Needs a frame-by-frame look at video or canvas. | Nothing should flash more than three times in one second (seizure risk). |
| 2.4.4 A | Link purpose (in context) | Noisy next to 4.1.2 link-name. “Click here” can still pass if the sentence around it is enough. | Each link purpose should be clear from the link text plus the same sentence or list item. Bare “learn more” rows usually fail. |
| 2.4.5 AA | Multiple ways | Needs the whole site, not one page. | There is more than one way to find a page (nav, search, sitemap) unless the page is a step in a process. |
| 2.4.6 AA | Headings and labels | We only run axe heading-order as best practice, not “is this heading the right word.” | Headings and labels describe the topic or purpose. Empty or witty headings that hide the section fail. |
| 2.5.1 A | Pointer gestures | Path-dependent (swipe, pinch, path-draw). | Anything that needs a path gesture also has a tap/click/button equivalent. |
| 2.5.2 A | Pointer cancellation | Down-event firing is path-dependent. | Activation happens on up, or can be aborted by sliding off. mousedown-only submit is the fail. |
| 2.5.4 A | Motion actuation | Shake-to-undo and tilt controls are device-specific. | If motion runs a command, there is a UI control too, and motion can be disabled. |
| 2.5.7 AA | Dragging movements | Left off on purpose — needs a drag path and a single-pointer alternative. | Reorder, sliders, and kanban that require drag also work with buttons or taps. |
| 3.1.2 AA | Language of parts | Axe valid-lang is the page. A French quote in an English page is a human call. | Passages in another language have lang= on a wrapper. |
| 3.2.1 A | On focus | Cross-widget: focus should not submit or change context. | Tab through. Focus alone must not open a new window, submit, or jump the page. |
| 3.2.2 A | On input | Changing a select should not navigate unless the user is warned. | Fill a field or change a dropdown. Context stays put unless the control says it will navigate. |
| 3.2.3 AA | Consistent navigation | Cross-page. Needs two or more screens. | Primary nav items keep order and labels across pages (a process step may drop nav). |
| 3.2.4 AA | Consistent identification | Same control, different name on another page. | Search, Save, and icon chrome mean the same thing everywhere they appear. |
| 3.3.3 AA | Error suggestion | Product rules — we only require that an error is identified (3.3.1). | When the format is known, the error says how to fix it (expected date, required length), not only “invalid.” |
| 3.3.4 AA | Error prevention (legal, financial, data) | Needs a reversible submit, a review step, or confirmation on money/legal forms. | Purchases, contracts, and data deletes can be reviewed, confirmed, or undone. |
| 3.3.7 A | Redundant entry | Needs the multi-step flow in the product. | Information the user already gave in this process is auto-filled or selectable, not typed again (unless essential). |
| 3.3.8 AA | Accessible authentication | Off, as requested. Login copy-paste and password managers. | Do not require the user to memorize or transcribe a password, OTP, or puzzle. Allow paste. |
| 4.1.3 AA | Status messages | Toasts and “Saved” lines need a live region. Silent Save is 3.3.1, not this. | Success, progress, and errors that appear without a focus move are in an aria-live region (or role=status/alert). |
| — AAA | AAA criteria | Out of scope for ClickMonkey. | Treat AAA as a product choice, not a soak gate. |

Catalog: [finding ids](../)
