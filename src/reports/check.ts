import { FindingKind as FindingKindEnum, type Finding, type FindingKind } from "../schema/finding.js";
import { TestabilityCode } from "../schema/testability.js";
import { VISUAL_RULES, type VisualRule } from "../surveyor/visual-rules.js";
import { CHECKS, catalogIdFor, checkByRule, type CatalogRule } from "./check-catalog.js";
export type { CatalogRule };
import { AXE_EXTRA_RULES, HTMLVALIDATE_RULES, specLink } from "./spec-links.js";
import {
  A11Y,
  isAcceptedInvalidFinding,
  isAxeRule,
  isEnabledAxeRule,
  isServerRefusedSubmitFinding,
  isSilentSubmitFinding,
  isThrowInsteadOfInvalidFinding,
  wcagOf,
  type ChapterExtras,
  type ReportChapter,
  type WcagLevel,
} from "./wcag.js";
import { FINDING_WHY, instanceCopy, type RuleWhyKey, whyRule } from "./why.js";

/**
 * A class of defect ClickMonkey can report.
 * A persisted `Finding` is one hit of this class on one page/run.
 */
export type Check = {
  rule: string;
  /** T-01, V-03, A-2.1.1, `html-validate no-dup-id`, `AXE color-contrast`. */
  code: string;
  href: string;
  title: string;
  chapter: ReportChapter;
  why: string;
  expected?: string;
  actual?: string;
  sc?: string;
  level?: WcagLevel;
  /** WCAG short title (`Contrast`), not the spec-link label. */
  scTitle?: string;
};

const RULE_EXPECTED: Record<string, string> = {
  silentSubmit: "Save submits, navigates, or shows invalid fields.",
  acceptedInvalid: "The field is marked invalid.",
  serverRefusedSubmit: "The UI only sends values the server will store.",
  throwInsteadOfInvalid: "The page stays usable, and junk in a field shows as a field error.",
  pageError: "The page stays usable.",
  httpError: "The resource loads.",
  notFound: "The resource loads.",
  clip: "Text is fully visible, or truncated with an ellipsis.",
  scanline: "Headers and cells in a column line up so the table can be scanned.",
  expectFailed: "The screen matches the step.",
};

const RULE_ACTUAL: Record<string, string> = {
  acceptedInvalid: "The form sent or left without rejecting the input.",
};

const VISUAL_EXPECTED = "The control is readable and clickable.";

export type HtmlValidateRule = (typeof HTMLVALIDATE_RULES)[number];
export type AxeExtraRule = (typeof AXE_EXTRA_RULES)[number];
export type A11yRule = keyof typeof A11Y;

/** Every rule we can explain: owned catalog, axe SC map, html-validate, Deque extras. */
export type CoveredRule = CatalogRule | A11yRule | HtmlValidateRule | AxeExtraRule;

/** `visualIssue` always remaps to a visual rule before the Why link. */
export type RemappedFindingKind = "visualIssue";

type UnexplainedVisual = Exclude<VisualRule, CoveredRule>;
type UnexplainedTestability = Exclude<TestabilityCode, CoveredRule>;
type UnexplainedKind = Exclude<Exclude<FindingKind, RemappedFindingKind>, CoveredRule>;
type UnexplainedWhy = Exclude<VisualRule | TestabilityCode | CatalogRule, RuleWhyKey | FindingKind>;

type AssertNever<T extends never> = T;
type _visual = AssertNever<UnexplainedVisual>;
type _testability = AssertNever<UnexplainedTestability>;
type _kind = AssertNever<UnexplainedKind>;
type _why = AssertNever<UnexplainedWhy>;
void 0 as unknown as _visual & _testability & _kind & _why;

function whyFor(rule: string): string | undefined {
  const custom = whyRule(rule) ?? checkByRule(rule)?.summary ?? FINDING_WHY[rule as FindingKind];
  if (custom) return custom;
  if (!isEnabledAxeRule(rule)) return undefined;
  const wcag = wcagOf(rule);
  if (wcag.sc) {
    const title = wcag.title && wcag.title !== "Best practice" ? ` ${wcag.title}` : "";
    return `Fails WCAG ${wcag.sc}${title}. Detector: axe ${rule}.`;
  }
  return `axe ${rule} failed (ClickMonkey extra, not a WCAG SC).`;
}

/** The check for this rule, or undefined if we have no code+link. */
export function checkOf(rule: string, extras?: ChapterExtras): Check | undefined {
  const spec = specLink(rule, extras);
  const why = whyFor(rule);
  if (!spec || !why) return undefined;
  const owned = catalogIdFor(rule, extras);
  const wcag = wcagOf(rule, extras);
  const expected = RULE_EXPECTED[rule] ?? (wcag.chapter === "visual" ? VISUAL_EXPECTED : undefined);
  const actual = RULE_ACTUAL[rule];
  return {
    rule,
    code: owned ?? (isAxeRule(rule) ? spec.label : wcag.sc ? `A-${wcag.sc}` : spec.label),
    href: spec.href,
    title: spec.label,
    chapter: wcag.chapter,
    why,
    ...(expected ? { expected } : {}),
    ...(actual ? { actual } : {}),
    ...(wcag.sc ? { sc: wcag.sc } : {}),
    ...(wcag.level ? { level: wcag.level } : {}),
    ...(wcag.title ? { scTitle: wcag.title } : {}),
  };
}

export function mustCheck(rule: string, extras?: ChapterExtras): Check {
  const hit = checkOf(rule, extras);
  if (!hit) throw new Error(`unexplained check: ${rule}`);
  return hit;
}

type FindingRef = Pick<Finding, "kind" | "message"> & Partial<Pick<Finding, "widgetRef" | "pageId" | "url" | "screenshotPath">>;

/**
 * Rule this hit is a Check for. Oracle kinds remap here — not in the report.
 * visualIssue uses widgetRef (or the `clip:` prefix). Everything else is the kind.
 */
export function ruleForFinding(finding: FindingRef): string {
  const { kind, message } = finding;
  if (kind === "expectFailed" && isSilentSubmitFinding(message)) return "silentSubmit";
  if (kind === "expectFailed" && isAcceptedInvalidFinding(message)) return "acceptedInvalid";
  if (kind === "httpError" && isServerRefusedSubmitFinding(message)) return "serverRefusedSubmit";
  if (kind === "pageError" && isThrowInsteadOfInvalidFinding(message)) return "throwInsteadOfInvalid";
  if (kind === "visualIssue") {
    const fromRef = finding.widgetRef?.trim();
    const fromMsg = message.split(":")[0]?.trim();
    const rule = fromRef || fromMsg || "other";
    return checkOf(rule, { message, source: "visual" }) ? rule : "other";
  }
  return kind;
}

function extrasForFinding(finding: FindingRef): ChapterExtras {
  const extras: ChapterExtras = { message: finding.message };
  if (finding.kind === "visualIssue") {
    extras.source = "visual";
    // Persist format is `rule: message — where`; overflow 320 vs visual needs `where`.
    const idx = finding.message.indexOf(" — ");
    if (idx >= 0) {
      extras.message = finding.message.slice(0, idx);
      extras.where = finding.message.slice(idx + 3);
    }
  }
  return extras;
}

export function checkForFinding(finding: FindingRef): Check {
  return mustCheck(ruleForFinding(finding), extrasForFinding(finding));
}

/**
 * One occurrence: the Check class plus where/what we saw.
 * Screenshot is omitted when the oracle had no pixels.
 * `why` / `expected` / `actual` are instance overlays when they differ from Check.
 */
export type FindingHit = {
  check: Check;
  message: string;
  pageId?: string;
  url?: string;
  screenshotPath?: string;
  widgetRef?: string;
  why?: string;
  expected?: string;
  actual?: string;
};

export function findingHitOf(
  finding: FindingRef,
  occurrence?: { pageId?: string; url?: string; screenshotPath?: string },
): FindingHit {
  const check = checkForFinding(finding);
  const inst = instanceCopy(check.rule, finding.message);
  return {
    check,
    message: finding.message,
    ...(occurrence?.pageId ?? finding.pageId ? { pageId: occurrence?.pageId ?? finding.pageId } : {}),
    ...(occurrence?.url ?? finding.url ? { url: occurrence?.url ?? finding.url } : {}),
    ...(occurrence?.screenshotPath ?? finding.screenshotPath
      ? { screenshotPath: occurrence?.screenshotPath ?? finding.screenshotPath }
      : {}),
    ...(finding.widgetRef ? { widgetRef: finding.widgetRef } : {}),
    ...(inst.why !== undefined ? { why: inst.why } : {}),
    ...(inst.expected !== undefined ? { expected: inst.expected } : {}),
    ...(inst.actual !== undefined ? { actual: inst.actual } : {}),
  };
}

export const CHECK_SOURCES = {
  visual: VISUAL_RULES,
  testability: TestabilityCode.options,
  findingKind: FindingKindEnum.options.filter((k) => k !== "visualIssue"),
  htmlValidate: HTMLVALIDATE_RULES,
  axeExtra: AXE_EXTRA_RULES,
  catalog: CHECKS.map((c) => c.rule),
} as const;
