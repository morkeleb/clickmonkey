/** Published leftover-WCAG guide. Stable path: /findings/qa-left/ */
export const QA_LEFT_HREF = "https://morkeleb.github.io/clickmonkey/findings/qa-left/";

export type QaLeftItem = {
  sc: string;
  level: "A" | "AA" | "AAA";
  title: string;
  why: string;
  qa: string;
};

/**
 * WCAG 2.2 A/AA ClickMonkey does not run. Humans still own these.
 * 2.1.2 and 2.4.3 are *not* here — form Tab walk covers those.
 */
export const QA_LEFT: readonly QaLeftItem[] = [
  {
    sc: "1.2.x",
    level: "A",
    title: "Media captions / audio description",
    why: "Needs the actual video or audio asset, plus a transcript or described track.",
    qa: "Play every clip. Captions (1.2.2), audio-only transcript (1.2.1), and audio description (1.2.3/1.2.5) where the spec requires them.",
  },
  {
    sc: "1.3.2",
    level: "A",
    title: "Meaningful sequence",
    why: "Reading order vs visual order is a judgment call. Form Tab (2.4.3) only covers keyboard stops, not headings, lists, or CSS that reshuffles prose.",
    qa: "Disable CSS or walk the accessibility tree. Headings, tables, and paragraphs should still make sense in DOM order.",
  },
  {
    sc: "1.3.3",
    level: "A",
    title: "Sensory characteristics",
    why: "“Click the round button on the right” is copy, not geometry.",
    qa: "Instructions that name only shape, color, or position fail. They need a name or text as well.",
  },
  {
    sc: "1.4.5",
    level: "AA",
    title: "Images of text",
    why: "A screenshot of words is not a contrast or alt check.",
    qa: "If the same text could be HTML/CSS, it should be. Logos are the usual exception.",
  },
  {
    sc: "1.4.11",
    level: "AA",
    title: "Non-text contrast",
    why: "Axe contrast is text. Icons, input borders, and focus-adjacent graphics are separate.",
    qa: "UI components and graphical objects against adjacent colors need 3:1. Check empty inputs and icon-only chrome.",
  },
  {
    sc: "1.4.13",
    level: "AA",
    title: "Content on hover or focus",
    why: "Tooltips and mega-menus are pointer-path dependent.",
    qa: "Hover and keyboard-focus popovers must be dismissible, hoverable, and persistent until dismissed or focus moves.",
  },
  {
    sc: "2.1.4",
    level: "A",
    title: "Character-key shortcuts",
    why: "A single-letter accesskey is not automatically a fail; it needs a way to turn off or remap.",
    qa: "If a letter key fires a command with focus in a text field, that is the bug. Document or disable the shortcut.",
  },
  {
    sc: "2.2.2",
    level: "A",
    title: "Pause, stop, hide",
    why: "Axe catches blink/marquee. Auto-rotating carousels and background video are not that.",
    qa: "Anything that moves, blinks, or auto-updates for more than five seconds needs a pause control.",
  },
  {
    sc: "2.3.1",
    level: "A",
    title: "Three flashes",
    why: "Needs a frame-by-frame look at video or canvas.",
    qa: "Nothing should flash more than three times in one second (seizure risk).",
  },
  {
    sc: "2.4.4",
    level: "A",
    title: "Link purpose (in context)",
    why: "Noisy next to 4.1.2 link-name. “Click here” can still pass if the sentence around it is enough.",
    qa: "Each link purpose should be clear from the link text plus the same sentence or list item. Bare “learn more” rows usually fail.",
  },
  {
    sc: "2.4.5",
    level: "AA",
    title: "Multiple ways",
    why: "Needs the whole site, not one page.",
    qa: "There is more than one way to find a page (nav, search, sitemap) unless the page is a step in a process.",
  },
  {
    sc: "2.4.6",
    level: "AA",
    title: "Headings and labels",
    why: "We only run axe heading-order as best practice, not “is this heading the right word.”",
    qa: "Headings and labels describe the topic or purpose. Empty or witty headings that hide the section fail.",
  },
  {
    sc: "2.5.1",
    level: "A",
    title: "Pointer gestures",
    why: "Path-dependent (swipe, pinch, path-draw).",
    qa: "Anything that needs a path gesture also has a tap/click/button equivalent.",
  },
  {
    sc: "2.5.2",
    level: "A",
    title: "Pointer cancellation",
    why: "Down-event firing is path-dependent.",
    qa: "Activation happens on up, or can be aborted by sliding off. mousedown-only submit is the fail.",
  },
  {
    sc: "2.5.4",
    level: "A",
    title: "Motion actuation",
    why: "Shake-to-undo and tilt controls are device-specific.",
    qa: "If motion runs a command, there is a UI control too, and motion can be disabled.",
  },
  {
    sc: "2.5.7",
    level: "AA",
    title: "Dragging movements",
    why: "Left off on purpose — needs a drag path and a single-pointer alternative.",
    qa: "Reorder, sliders, and kanban that require drag also work with buttons or taps.",
  },
  {
    sc: "3.1.2",
    level: "AA",
    title: "Language of parts",
    why: "Axe valid-lang is the page. A French quote in an English page is a human call.",
    qa: "Passages in another language have lang= on a wrapper.",
  },
  {
    sc: "3.2.1",
    level: "A",
    title: "On focus",
    why: "Cross-widget: focus should not submit or change context.",
    qa: "Tab through. Focus alone must not open a new window, submit, or jump the page.",
  },
  {
    sc: "3.2.2",
    level: "A",
    title: "On input",
    why: "Changing a select should not navigate unless the user is warned.",
    qa: "Fill a field or change a dropdown. Context stays put unless the control says it will navigate.",
  },
  {
    sc: "3.2.3",
    level: "AA",
    title: "Consistent navigation",
    why: "Cross-page. Needs two or more screens.",
    qa: "Primary nav items keep order and labels across pages (a process step may drop nav).",
  },
  {
    sc: "3.2.4",
    level: "AA",
    title: "Consistent identification",
    why: "Same control, different name on another page.",
    qa: "Search, Save, and icon chrome mean the same thing everywhere they appear.",
  },
  {
    sc: "3.3.3",
    level: "AA",
    title: "Error suggestion",
    why: "Product rules — we only require that an error is identified (3.3.1).",
    qa: "When the format is known, the error says how to fix it (expected date, required length), not only “invalid.”",
  },
  {
    sc: "3.3.4",
    level: "AA",
    title: "Error prevention (legal, financial, data)",
    why: "Needs a reversible submit, a review step, or confirmation on money/legal forms.",
    qa: "Purchases, contracts, and data deletes can be reviewed, confirmed, or undone.",
  },
  {
    sc: "3.3.7",
    level: "A",
    title: "Redundant entry",
    why: "Needs the multi-step flow in the product.",
    qa: "Information the user already gave in this process is auto-filled or selectable, not typed again (unless essential).",
  },
  {
    sc: "3.3.8",
    level: "AA",
    title: "Accessible authentication",
    why: "Off, as requested. Login copy-paste and password managers.",
    qa: "Do not require the user to memorize or transcribe a password, OTP, or puzzle. Allow paste.",
  },
  {
    sc: "4.1.3",
    level: "AA",
    title: "Status messages",
    why: "Toasts and “Saved” lines need a live region. Silent Save is 3.3.1, not this.",
    qa: "Success, progress, and errors that appear without a focus move are in an aria-live region (or role=status/alert).",
  },
  {
    sc: "—",
    level: "AAA",
    title: "AAA criteria",
    why: "Out of scope for ClickMonkey.",
    qa: "Treat AAA as a product choice, not a soak gate.",
  },
];
