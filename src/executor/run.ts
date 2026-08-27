import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { chat } from "../brains/chat.js";
import {
  persistFinding,
  persistVisualIssueFindings,
  shouldPersistFinding,
  visualIssueScreenshotPath,
  type VisualIssueScreenshot,
} from "../persist/finding.js";
import { touchPresence } from "../persist/presence.js";
import { persistSharedMap } from "../persist/config.js";
import { lastQualityPage, lastVisualHash, persistQualityRuntime, persistQualityVisual } from "../persist/quality.js";
import { normalizeQualityMessage, type QualityIssue } from "../schema/quality.js";
import { compactLog, hoppedStepIndexes } from "../playbooks/compact.js";
import { parseLine, formatLog, formatStep } from "../schema/dsl.js";
import { redactEnvInText } from "./secrets.js";
import {
  findingId,
  findingTapeBug,
  isFindingKind,
  pageErrorExplanation,
  severityForKind,
  type Finding,
  type FindingKind,
} from "../schema/finding.js";
import {
  clearTrackedFills,
  fillCtxForPageError,
  type TrackedFill,
} from "./field-validity.js";
import type { Locator } from "../schema/locator.js";
import type { Log, Step } from "../schema/log.js";
import { resolveVision, type Config } from "../schema/config.js";
import { staleMsForPage } from "../schema/fog.js";
import type { PageModel, PageModelDraft } from "../schema/page-model.js";
import type { View } from "../schema/view.js";
import {
  attachHttpOracle,
  flushHttpOracle,
  isDocumentNotFound,
  isNotFoundPage,
  type OracleFinding,
} from "../oracles/http.js";
import { reportDocumentNotFound } from "../persist/broken.js";
import { attachPageErrorOracle } from "../oracles/page-error.js";
import { applyVisionBlurb, mechanicalDescription, visionMayDescribe } from "../surveyor/describe.js";
import {
  blurbLooksLikeLoading,
  htmlLooksLikeLoading,
  pageLooksLikeLoading,
  waitOutLoading,
} from "../surveyor/loading.js";
import { scanLayout } from "../surveyor/layout.js";
import {
  blurActiveElement,
  fitShotClip,
  refocusWhereForClip,
  type FocusVisibleClip,
} from "../surveyor/focus-visible.js";
import {
  examineScreenshot,
  hashPngFile,
  shouldSkipVision,
  visionOutcome,
  visionPass,
  type MeasuredVisualHit,
  type VisionSkipReason,
} from "../surveyor/vision.js";
import { checkFence } from "./fence.js";
import {
  captureStepShot,
  performStep,
  syncPageFromUrl,
  syncSurfaceStack,
  writePageStill,
  type StepFailure,
} from "./steps.js";
import { scanA11y } from "../surveyor/a11y.js";
import { hashHtml, persistQualityFromHtml, qualityFromHtml } from "../surveyor/record.js";
import { ledgerOrigin, originOfHref, pathnameOf } from "../surveyor/ready.js";
import { seoIsPrivate } from "../surveyor/seo.js";
import { hoppablePages, hopContextOf } from "./hop.js";
import { logLand, logSight, logStepDone, logStepStart, logVision, type NavMeta } from "./nav-log.js";
import { dumpVerboseState } from "./verbose.js";
import { buildView } from "./view.js";

export type AfterStep = (state: RunState) => Promise<void>;

export interface RunState {
  page: Page;
  context: BrowserContext;
  browser: Browser;
  config: Config;
  model: PageModel | PageModelDraft;
  pageId: string;
  surfaceStack: string[];
  log: Log;
  usedLocators: Record<string, Locator>;
  pendingFindings: Array<Partial<Finding> & { kind: FindingKind; message: string }>;
  outDir: string;
  afterStep?: AfterStep;
  replay?: boolean;
  configPath?: string;
  lastAction?: { surface: string; id: string; opens?: string; fromPage?: string };
  lastFill?: TrackedFill;
  lastFills?: TrackedFill[];
  lastScreenshotPath?: string;
  /** `page.content()` for this step; quality checks read this, not the live page. */
  stepHtml?: string;
  lastFogPageId?: string;
  /** Brain name (`map`, `unleash`, `unleash-nasty`, …) for per-job land stamps. */
  brain?: string;
  lastSight?: string;
  lastSightByPage?: Record<string, string>;
  /** PNG hash we already asked for a map blurb on, per page. */
  blurbTriedHashByPage?: Record<string, string>;
  /** Last-land times from before this run stamped. VLM skip must not see this stay. */
  fogAtStart?: Record<string, string>;
  /** Intro is how we enter the leash; fence applies after it. */
  inIntro?: boolean;
  navMeta?: NavMeta;
  navLogPath?: string;
  /** Per-step HTML + view dumps under outDir/verbose/. */
  verbose?: boolean;
  verboseSeq?: number;
  /** Page keys where waitOutLoading timed out; skip the wait until the pane is not loading. */
  loadingWaitGaveUpByPage?: Record<string, true>;
}

export interface StepResult {
  ok: boolean;
  step: Step;
  finding?: Finding;
  /** True only when persist minted a new folder (not a dedup or a quiet kind). */
  findingCreated?: boolean;
  /** Left the leash. Recover and keep walking — not a website finding. */
  bounced?: boolean;
  view: View;
}

const attachedPages = new WeakSet<Page>();

/** Wait until the URL stops changing (OAuth callback → app). */
async function waitForUrlSettle(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = page.url();
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    const changed = await page
      .waitForURL((u) => u.href !== last, { timeout: Math.min(800, remaining) })
      .then(() => true)
      .catch(() => false);
    if (!changed) return;
    last = page.url();
  }
}

async function pageLooksSettled(page: Page, startHref: string, appOrigin: string): Promise<boolean> {
  const href = page.url();
  if (originOfHref(href) !== appOrigin) return false;
  if (href === startHref) return false;
  const n = await page
    .locator("a[href], button, input, select, textarea, [role='button'], [role='link']")
    .count()
    .catch(() => 0);
  return n > 0;
}

/** After intro, leave the start URL and any empty redirect page. */
async function waitForPostIntro(
  page: Page,
  appOrigin: string | undefined,
  startHref: string,
  timeoutMs: number,
): Promise<void> {
  if (!appOrigin) {
    await waitForUrlSettle(page, timeoutMs);
    return;
  }
  if (originOfHref(page.url()) !== appOrigin) {
    await page
      .waitForURL((u) => u.origin === appOrigin, { timeout: Math.min(timeoutMs, 15_000) })
      .catch(() => undefined);
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await waitForUrlSettle(page, Math.min(800, deadline - Date.now()));
    if (await pageLooksSettled(page, startHref, appOrigin)) return;
    const last = page.url();
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    await page
      .waitForURL((u) => u.href !== last, { timeout: Math.min(1_500, remaining) })
      .catch(() => undefined);
  }
}

export function attachOracles(
  state: Pick<RunState, "page" | "pendingFindings" | "configPath" | "replay"> & {
    appOrigin?: string;
    outDir?: string;
  },
): void {
  if (attachedPages.has(state.page)) return;
  attachedPages.add(state.page);
  const push = (f: OracleFinding) => {
    state.pendingFindings.push(f);
  };
  attachHttpOracle(state.page, push);
  attachPageErrorOracle(state.page, push, (event) => {
    if (!state.configPath || state.replay) return;
    let pathName = "/";
    try {
      pathName = new URL(event.url).pathname || "/";
    } catch {
      pathName = "/";
    }
    const origin = ledgerOrigin(event.url, state.appOrigin);
    const now = new Date().toISOString();
    try {
      persistQualityRuntime(
        state.configPath,
        { path: pathName, ...(origin ? { origin } : {}) },
        {
          source: event.source,
          rule: event.rule,
          severity: event.severity,
          message: normalizeQualityMessage(event.message),
          count: 1,
          firstSeen: now,
          lastSeen: now,
        },
        state.outDir,
      );
    } catch {
      // ledger write must not stall the walk
    }
  });
}

function pageErrorFillCtx(state: RunState, step?: Step) {
  return fillCtxForPageError(state.lastFills ?? (state.lastFill ? [state.lastFill] : undefined), step);
}

async function screenshotFinding(
  state: RunState,
  partial: StepFailure | OracleFinding | (Partial<Finding> & { kind: FindingKind; message: string }),
  step?: Step,
): Promise<Finding> {
  const stepIndex = state.log.steps.length;
  const kind = partial.kind;
  if (!isFindingKind(kind)) throw new Error(`not a finding: ${kind}`);
  const id = findingId(stepIndex, kind);
  let screenshotPath: string | undefined;
  if (shouldPersistFinding(kind)) {
    mkdirSync(state.outDir, { recursive: true });
    const liveShot =
      step?.kind === "screenshot" && state.lastScreenshotPath && existsSync(state.lastScreenshotPath)
        ? state.lastScreenshotPath
        : undefined;
    screenshotPath = liveShot;
    if (!screenshotPath) {
      screenshotPath = join(state.outDir, `.shot-${id}.png`);
      await state.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    }
  }
  const finding: Finding = {
    schemaVersion: 1,
    id,
    kind,
    severity: severityForKind(kind),
    message:
      kind === "pageError"
        ? pageErrorExplanation(partial.message, pageErrorFillCtx(state, step))
        : partial.message,
    tapePath: join(state.outDir, "replay.log"),
    stepIndex,
    ...(screenshotPath ? { screenshotPath } : {}),
    ...(state.pageId ? { pageId: state.pageId } : {}),
  };
  if ("httpStatus" in partial && partial.httpStatus !== undefined) {
    finding.httpStatus = partial.httpStatus;
  }
  if ("url" in partial && partial.url !== undefined) finding.url = partial.url;
  if ("widgetRef" in partial && partial.widgetRef !== undefined) {
    finding.widgetRef = partial.widgetRef;
  }
  return finding;
}

function sightPageKey(path: string, origin?: string): string {
  return `${origin ?? ""}\0${path}`;
}

function applyPageSight(state: RunState, pageKey: string): void {
  state.lastSight = state.lastSightByPage?.[pageKey];
}

async function maybeWaitOutLoading(state: RunState, pageKey: string): Promise<void> {
  if (state.loadingWaitGaveUpByPage?.[pageKey]) {
    if (!(await pageLooksLikeLoading(state.page))) {
      const next = { ...state.loadingWaitGaveUpByPage };
      delete next[pageKey];
      state.loadingWaitGaveUpByPage = next;
    }
    return;
  }
  if (await waitOutLoading(state.page)) {
    state.loadingWaitGaveUpByPage = { ...(state.loadingWaitGaveUpByPage ?? {}), [pageKey]: true };
  }
}

function livePageLoc(state: RunState): { path: string; origin?: string; href: string } {
  const href = state.page.url();
  let path = "/";
  try {
    path = pathnameOf(state.page);
  } catch {
    path = "/";
  }
  return { path, href, origin: ledgerOrigin(href, originOfHref(state.config.url)) };
}

function visionReplyIsLoading(opts: { blurb?: string; sight?: string }): boolean {
  return blurbLooksLikeLoading(opts.blurb ?? "") || blurbLooksLikeLoading(opts.sight ?? "");
}

function measuredHits(issues: QualityIssue[] | undefined): MeasuredVisualHit[] | undefined {
  if (!issues?.length) return undefined;
  return issues.map((i) => ({
    rule: i.rule,
    message: i.message,
    ...(i.where ? { where: i.where } : {}),
  }));
}

function applyFocusVisibleEvidence(
  issues: QualityIssue[],
  shots: VisualIssueScreenshot[] | undefined,
): QualityIssue[] {
  return issues.map((issue) => {
    if (issue.rule !== "focusVisible") return issue;
    if (visualIssueScreenshotPath(issue, { issueScreenshots: shots })) return issue;
    return { ...issue, confidence: "medium" as const };
  });
}

async function captureFocusVisibleShots(
  state: RunState,
  clips: FocusVisibleClip[],
): Promise<VisualIssueScreenshot[]> {
  if (clips.length === 0) return [];
  const dir = join(state.outDir, "shots");
  mkdirSync(dir, { recursive: true });
  const n = String(state.log.steps.length).padStart(3, "0");
  const viewport = state.page.viewportSize();
  const scroll = (await state.page
    .evaluate(`({ x: window.scrollX || 0, y: window.scrollY || 0 })`)
    .catch(() => ({ x: 0, y: 0 }))) as { x: number; y: number };
  const sx = Number.isFinite(scroll.x) ? scroll.x : 0;
  const sy = Number.isFinite(scroll.y) ? scroll.y : 0;
  const shots: VisualIssueScreenshot[] = [];
  try {
    for (const [i, item] of clips.entries()) {
      const live = await refocusWhereForClip(state.page, item.where);
      if (!live) continue;
      const clip = fitShotClip(live, viewport) ?? fitShotClip(item.clip, viewport);
      if (!clip) continue;
      const path = join(dir, `step-${n}-focus-visible-${String(i).padStart(2, "0")}.png`);
      await state.page.screenshot({ path, clip }).catch(() => undefined);
      if (existsSync(path)) shots.push({ where: item.where, screenshotPath: path });
    }
  } finally {
    await blurActiveElement(state.page);
    await state.page.evaluate(`window.scrollTo(${sx}, ${sy})`).catch(() => undefined);
  }
  return shots;
}

/** One harness line per PNG this run. Skip `ok` (those hits are already in quality.json). */
function emitVisionLog(
  state: RunState,
  reason: VisionSkipReason,
  info: { pageKey: string; shotHash?: string; path?: string; issues?: number },
): void {
  if (reason === "ok") return;
  if (!state.navLogPath) return;
  if (info.shotHash && state.blurbTriedHashByPage?.[info.pageKey] === info.shotHash) return;
  logVision(state.navLogPath, {
    reason,
    ...(info.path ? { path: info.path } : {}),
    ...(info.issues !== undefined ? { issues: info.issues } : {}),
  });
}

/** PNG + HTTP only. Do not touch `page` — finish() runs this with axe after layout restored the viewport. */
async function scanStepVision(
  state: RunState,
  step: Step,
  bounced: boolean,
  shotPath: string | undefined,
  loc: { path: string; origin?: string; href: string },
  html: string | undefined,
  opts?: { measured?: MeasuredVisualHit[]; ledgerVisualHash?: string },
): Promise<string | undefined> {
  const { path, origin, href } = loc;
  const pageKey = sightPageKey(path, origin);
  applyPageSight(state, pageKey);
  const shotOk = Boolean(shotPath && existsSync(shotPath) && !(step.kind === "screenshot" && step.ui));
  const shotHash = shotOk && shotPath ? hashPngFile(shotPath) : undefined;
  const markTried = (hash = shotHash) => {
    if (!hash) return;
    state.blurbTriedHashByPage = { ...(state.blurbTriedHashByPage ?? {}), [pageKey]: hash };
  };
  const emit = (reason: VisionSkipReason, extra?: { issues?: number }) => {
    emitVisionLog(state, reason, { pageKey, shotHash, path, ...extra });
  };
  if (state.replay || bounced) {
    emit(visionOutcome({ replay: true }));
    markTried();
    return undefined;
  }
  if (!shotOk || !shotPath) {
    if (step.kind === "screenshot" && step.ui) return undefined;
    emit(visionOutcome({ noShot: true }));
    return undefined;
  }
  if (html && htmlLooksLikeLoading(html)) {
    emit(visionOutcome({ loadingHtml: true }));
    return undefined;
  }
  try {
    const vision = resolveVision(state.config.vision, state.config.brain);
    if (!vision || (!vision.issues && !vision.assist)) {
      emit(visionOutcome({ noConfig: true }));
      markTried();
      return undefined;
    }
    const key = { path, ...(origin ? { origin } : {}) };
    const onPageSurface = state.surfaceStack.length <= 1;
    const mapPage = onPageSurface ? state.model.pages.find((p) => p.id === state.pageId) : undefined;
    const needBlurb = Boolean(
      mapPage && visionMayDescribe(mapPage) && state.blurbTriedHashByPage?.[pageKey] !== shotHash,
    );
    const needSight = Boolean(vision.assist && !state.lastSightByPage?.[pageKey]);
    const pngUnchanged = Boolean(opts?.ledgerVisualHash) && shotHash === opts?.ledgerVisualHash;
    const staleMs = staleMsForPage(state.fogAtStart, state.pageId);
    const triedThisRun = state.blurbTriedHashByPage?.[pageKey] === shotHash;
    const fogFresh = shouldSkipVision({ staleMs, unchanged: pngUnchanged });
    if (visionPass({ needBlurb, needSight, pngUnchanged, staleMs, triedThisRun }) === "skip") {
      emit(visionOutcome({ fogFresh, triedThisRun }));
      markTried();
      applyPageSight(state, pageKey);
      return undefined;
    }
    const apiKey = vision.apiKeyEnv ? process.env[vision.apiKeyEnv] : undefined;
    const result = await examineScreenshot({
      chat,
      baseUrl: vision.baseUrl,
      model: vision.model,
      apiKey,
      pngPath: shotPath,
      ...(mapPage ? { facts: mechanicalDescription(mapPage) } : {}),
      ...(opts?.measured && opts.measured.length > 0 ? { measured: opts.measured } : {}),
    });
    if (result.status !== "ok") {
      emit(visionOutcome({ status: result.status, hashMatch: result.status === "skip" }));
      markTried();
      applyPageSight(state, pageKey);
      return undefined;
    }
    if (visionReplyIsLoading(result)) {
      emit(visionOutcome({ status: "ok", loadingFrame: true }));
      markTried(result.hash);
      applyPageSight(state, pageKey);
      return undefined;
    }
    if (vision.issues && result.persist) {
      if (state.configPath) {
        persistQualityVisual(
          state.configPath,
          {
            ...key,
            foundAt: new Date().toISOString(),
            visual: result.issues,
            visualHash: result.hash,
          },
          state.outDir,
        );
      }
      if (result.issues.some((i) => i.confidence === "high")) {
        persistVisualIssueFindings(state.outDir, result.issues, {
          stepIndex: state.log.steps.length,
          url: href,
          pageId: state.pageId,
          screenshotPath: shotPath,
          tapePath: join(state.outDir, "replay.log"),
          replayLog: compactTape(state, step, "visual issue"),
        });
      }
    }
    const persist = Boolean(vision.issues && result.persist);
    const reason = visionOutcome({ status: "ok", persist, issueCount: result.issues.length });
    emit(reason, reason === "empty" || reason === "no-persist" ? { issues: result.issues.length } : undefined);
    if (vision.assist && result.sight) {
      state.lastSightByPage = { ...(state.lastSightByPage ?? {}), [pageKey]: result.sight };
      if (state.navLogPath) {
        logSight(state.navLogPath, { line: redactEnvInText(formatStep(step)), sight: result.sight });
      }
    }
    applyPageSight(state, pageKey);
    markTried(result.hash);
    if (needBlurb) return result.blurb;
    return undefined;
  } catch {
    emit(visionOutcome({ status: "fail" }));
    markTried();
    applyPageSight(state, pageKey);
    return undefined;
  }
}

function commitVisionBlurb(state: RunState, blurb: string): void {
  if (!state.configPath) return;
  const onPageSurface = state.surfaceStack.length <= 1;
  const mapPage = onPageSurface ? state.model.pages.find((p) => p.id === state.pageId) : undefined;
  if (!mapPage || !visionMayDescribe(mapPage)) return;
  if (!applyVisionBlurb(mapPage, blurb)) return;
  const saved = persistSharedMap(state.configPath, state.model);
  state.config = saved;
  state.model = saved.map;
}

function lastActionFromStep(state: RunState, step: Step): RunState["lastAction"] {
  if (step.kind !== "click") return undefined;
  for (const page of state.model.pages) {
    const surface = page.surfaces.find((s) => s.id === step.surface);
    const action = surface?.actions.find((a) => a.id === step.id);
    if (!action) continue;
    return action.opens
      ? { surface: step.surface, id: step.id, opens: action.opens, fromPage: state.pageId }
      : { surface: step.surface, id: step.id, fromPage: state.pageId };
  }
  return { surface: step.surface, id: step.id, fromPage: state.pageId };
}

async function captureNotFoundFinding(
  state: RunState,
  step: Step,
  href: string,
): Promise<Finding> {
  if (state.configPath) reportDocumentNotFound(state.configPath, state.page, state.outDir);
  const http404 = isDocumentNotFound(state.page);
  const pending404 = state.pendingFindings.find((f) => f.kind === "notFound");
  const finding = await screenshotFinding(
    state,
    pending404 ?? {
      kind: "notFound",
      message: http404 ? `HTTP 404 GET ${href}` : `Not found page GET ${href}`,
      url: href,
      httpStatus: 404,
    },
    step,
  );
  state.pendingFindings = state.pendingFindings.filter((f) => f !== pending404);
  return finding;
}

function compactTape(state: RunState, step: Step, bug: string): string {
  return formatLog(
    compactLog(
      {
        schemaVersion: 1,
        bug,
        found: new Date().toISOString(),
        comments: state.log.comments,
        steps: [...state.log.steps, step],
        usedLocators: { ...state.usedLocators },
        result: "failed",
      },
      state.navLogPath && existsSync(state.navLogPath)
        ? { hopped: hoppedStepIndexes(readFileSync(state.navLogPath, "utf8")) }
        : undefined,
    ),
  );
}

function persistStepFinding(
  state: RunState,
  step: Step,
  finding: Finding,
): { finding: Finding; created: boolean } {
  if (!shouldPersistFinding(finding.kind)) return { finding, created: false };
  const persisted = persistFinding(state.outDir, finding, {
    screenshotPath: finding.screenshotPath,
    replayLog: compactTape(state, step, findingTapeBug(finding.kind, finding.message)),
  });
  if (step.kind === "screenshot" && persisted.finding.screenshotPath) {
    state.lastScreenshotPath = persisted.finding.screenshotPath;
  }
  return { finding: persisted.finding, created: persisted.created };
}

async function finish(
  state: RunState,
  step: Step,
  stepFailure: StepFailure | undefined,
  hrefBefore: string,
): Promise<StepResult> {
  state.lastAction = lastActionFromStep(state, step);
  if (step.kind === "click" || step.kind === "open") {
    if (state.page.url() === hrefBefore) {
      await state.page
        .waitForURL((u) => u.href !== hrefBefore, { timeout: 400 })
        .catch(() => undefined);
    }
    if (state.page.url() !== hrefBefore) {
      await waitForUrlSettle(state.page, 400);
    }
  }
  syncPageFromUrl(state);
  await syncSurfaceStack(state);
  await flushHttpOracle(state.page);

  const href = state.page.url();
  const fenceHit = state.inIntro ? "ok" : checkFence(href, state.config.fence);
  const refusedFence = stepFailure?.kind === "fenceViolation";
  const bounced = fenceHit !== "ok";

  let finding: Finding | undefined;
  let runInspect = false;
  if (bounced) {
    // Left the leash. Recover without treating it as a website finding.
  } else if (await isNotFoundPage(state.page)) {
    finding = await captureNotFoundFinding(state, step, href);
  } else {
    runInspect = true;
    if (stepFailure && isFindingKind(stepFailure.kind)) {
      finding = await screenshotFinding(state, stepFailure, step);
    } else if (state.pendingFindings[0]) {
      finding = await screenshotFinding(state, state.pendingFindings.shift()!, step);
    }
  }
  if (state.page.url() !== hrefBefore) clearTrackedFills(state);

  let findingCreated = false;
  if (finding) {
    const persisted = persistStepFinding(state, step, finding);
    finding = persisted.finding;
    findingCreated = persisted.created;
  }

  let shotPath = step.kind === "screenshot" ? state.lastScreenshotPath : undefined;
  if (!state.replay && state.config.screenshots !== false && step.kind !== "screenshot") {
    const locForWait = livePageLoc(state);
    await maybeWaitOutLoading(state, sightPageKey(locForWait.path, locForWait.origin));
    shotPath = await captureStepShot(state);
  }
  // Client-side Next.js 404 often paints after the document response (HTTP 200).
  if (!finding && !bounced && !refusedFence && (await isNotFoundPage(state.page))) {
    finding = await captureNotFoundFinding(state, step, state.page.url());
    const persisted = persistStepFinding(state, step, finding);
    finding = persisted.finding;
    findingCreated = persisted.created;
  }
  // A 404 after a click from home must not become home's sitemap still.
  if (shotPath && !bounced && finding?.kind !== "notFound") {
    writePageStill(state, shotPath);
  }
  // Playwright Page is not concurrent-safe; only inspect then axe may use it.
  const loc = livePageLoc(state);
  let html: string | undefined;
  if (runInspect && !state.replay) {
    html = await state.page.content().catch(() => undefined);
  }
  state.stepHtml = html;
  const scanPublicMeta = Boolean(html) && !seoIsPrivate(loc.path, state.config.seo);
  const qualityKey = { path: loc.path, ...(loc.origin ? { origin: loc.origin } : {}) };
  const prev =
    html && state.configPath ? lastQualityPage(state.configPath, qualityKey, state.outDir) : undefined;
  const hashHit = Boolean(html && prev && prev.htmlHash === hashHtml(html));
  const ledgerVisualHash = state.configPath
    ? lastVisualHash(state.configPath, qualityKey, state.outDir)
    : undefined;
  let measured: MeasuredVisualHit[] | undefined;
  if (runInspect && !state.replay && !bounced && state.configPath) {
    try {
      const shotHash = shotPath && existsSync(shotPath) ? hashPngFile(shotPath) : undefined;
      const skipLayout = shotHash ? prev?.visualHash === shotHash : hashHit;
      if (!skipLayout) {
        if (await pageLooksLikeLoading(state.page)) {
          measured = measuredHits(prev?.visual);
        } else {
          const layout = await scanLayout(state.page);
          let issueScreenshots: VisualIssueScreenshot[] | undefined;
          if (layout.focusVisibleClips?.length && state.config.screenshots !== false) {
            issueScreenshots = await captureFocusVisibleShots(state, layout.focusVisibleClips);
          }
          const visual = applyFocusVisibleEvidence(layout.issues, issueScreenshots);
          persistQualityVisual(
            state.configPath,
            {
              ...qualityKey,
              foundAt: new Date().toISOString(),
              visual,
              visualHash: shotHash ?? prev?.visualHash ?? "layout",
            },
            state.outDir,
            ...(layout.complete ? [{ replaceDom: true }] : []),
          );
          if (visual.length > 0 && (shotPath || issueScreenshots?.length)) {
            persistVisualIssueFindings(state.outDir, visual, {
              stepIndex: state.log.steps.length,
              url: loc.href,
              pageId: state.pageId,
              screenshotPath: shotPath,
              ...(issueScreenshots?.length ? { issueScreenshots } : {}),
              tapePath: join(state.outDir, "replay.log"),
              replayLog: compactTape(state, step, "visual issue"),
            });
          }
          measured = measuredHits(visual);
        }
      } else {
        measured = measuredHits(prev?.visual);
      }
    } catch {
      // layout extras must not stall a walk
      measured = measuredHits(prev?.visual);
    }
  }
  const [blurb, markup, a11y] = await Promise.all([
    scanStepVision(state, step, bounced, shotPath, loc, html, {
      measured,
      ledgerVisualHash,
    }),
    html && !hashHit
      ? qualityFromHtml(html, loc.href, scanPublicMeta).catch(() => undefined)
      : Promise.resolve(undefined),
    runInspect
      ? (async () => {
          await state.afterStep?.(state);
          syncPageFromUrl(state);
          if (state.outDir) touchPresence(state.outDir, state.pageId);
          if (!html || state.replay) return undefined;
          if (hashHit) return prev?.a11y ?? [];
          try {
            return await scanA11y(state.page);
          } catch {
            return undefined;
          }
        })()
      : Promise.resolve(undefined),
  ]);
  state.stepHtml = undefined;
  if (html && runInspect && state.configPath && !state.replay) {
    try {
      const livePath = (() => {
        try {
          return pathnameOf(state.page);
        } catch {
          return loc.path;
        }
      })();
      const path = state.model.pages.find((p) => p.id === state.pageId)?.path ?? loc.path;
      await persistQualityFromHtml(state.configPath, {
        html,
        href: loc.href,
        path,
        livePath,
        origin: loc.origin,
        seo: state.config.seo,
        outDir: state.outDir,
        ...(a11y !== undefined ? { a11y } : {}),
        ...(a11y === undefined && !hashHit ? { omitHtmlHash: true } : {}),
        ...(markup ? { htmlIssues: markup.html, seoIssues: markup.seo } : {}),
      });
    } catch {
      // scanners must not stall a walk
    }
  }
  if (blurb) commitVisionBlurb(state, blurb);

  state.log.steps.push(step);

  const view = await buildView({
    page: state.page,
    pageId: state.pageId,
    surfaceStack: state.surfaceStack.length > 0 ? state.surfaceStack : [state.pageId],
    model: state.model,
    appUrl: state.config.url,
    fence: state.config.fence,
    intro: state.config.intro,
    skip: state.config.skip,
    inIntro: state.inIntro,
    ...(state.configPath ? { configPath: state.configPath } : {}),
    last: {
      step: redactEnvInText(formatStep(step)),
      ok: !finding,
      ...(finding ? { finding: finding.kind } : bounced || refusedFence ? { finding: "fenceViolation" } : {}),
    },
  });

  await dumpVerboseState(state, redactEnvInText(formatStep(step)), view);

  return {
    ok: !finding,
    step,
    view,
    ...(finding ? { finding, findingCreated } : {}),
    ...(bounced ? { bounced: true } : {}),
  };
}

export function createExecutor(state: RunState): {
  runStep(step: Step): Promise<StepResult>;
  runLine(line: string): Promise<StepResult>;
  runIntro(): Promise<void>;
} {
  attachOracles({ ...state, appOrigin: originOfHref(state.config.url) });

  async function runStep(step: Step): Promise<StepResult> {
    const line = redactEnvInText(formatStep(step));
    const phase = state.inIntro ? "intro" : "walk";
    if (state.navMeta) {
      state.navMeta.step = line;
      state.navMeta.pageId = state.pageId;
      state.navMeta.phase = phase;
    }
    const mode = state.navMeta?.mode;
    const started = state.navLogPath
      ? logStepStart(state.navLogPath, {
          line,
          pageId: state.pageId,
          phase,
          ...(mode ? { mode } : {}),
          echo: process.stderr,
        })
      : Date.now();
    let failure: StepFailure | undefined;
    const hrefBefore = state.page.url();
    try {
      failure = await performStep(state, step);
    } catch (err) {
      failure = {
        kind: "expectFailed",
        message: err instanceof Error ? err.message : String(err),
      };
    }
    const result = await finish(state, step, failure, hrefBefore);
    if (state.navLogPath) {
      logStepDone(state.navLogPath, {
        line: redactEnvInText(formatStep(step)),
        ok: result.ok,
        started,
        pageId: state.pageId,
        ...(mode ? { mode } : {}),
        ...(result.finding
          ? { finding: result.finding.kind }
          : result.bounced || result.view.last?.finding === "fenceViolation"
            ? { finding: "fenceViolation" }
            : {}),
        echo: process.stderr,
      });
    }
    return result;
  }

  async function runLine(line: string): Promise<StepResult> {
    const parsed = parseLine(line);
    if (!parsed || "comment" in parsed) {
      throw new Error(`not a step: ${line}`);
    }
    return runStep(parsed);
  }

  async function runIntro(): Promise<void> {
    state.inIntro = true;
    if (state.navMeta) state.navMeta.phase = "intro";
    const startHref = state.page.url();
    const appOrigin = originOfHref(state.config.url);
    let departed = false;
    try {
      for (const line of state.config.intro) {
        const parsed = parseLine(line);
        if (!parsed || "comment" in parsed) continue;
        const result = await runStep(parsed);
        if (!result.ok) {
          throw new Error(result.finding?.message ?? `intro step failed: ${formatStep(parsed)}`);
        }
        if (state.page.url() !== startHref) departed = true;
      }
      if (state.page.url() === startHref) {
        await state.page
          .waitForURL((u) => u.href !== startHref, { timeout: 10_000 })
          .catch(() => undefined);
      }
      if (state.page.url() !== startHref) departed = true;
      await waitForPostIntro(state.page, appOrigin, startHref, 15_000);
    } finally {
      state.inIntro = false;
    }
    await state.afterStep?.(state);
    if (state.navMeta) {
      state.navMeta.phase = "walk";
      state.navMeta.step = undefined;
      state.navMeta.pageId = state.pageId;
    }
    const href = state.page.url();
    if (href !== startHref) departed = true;
    if (!departed) {
      throw new Error(`intro did not leave ${startHref}; still at ${href}`);
    }
    if (state.navLogPath) {
      logLand(state.navLogPath, {
        url: href,
        pageId: state.pageId,
        hoppable: hoppablePages(state.model.pages, hopContextOf(state)).map((p) => p.id),
        echo: process.stderr,
      });
    }
    if (state.verbose) {
      const landView = await buildView({
        page: state.page,
        pageId: state.pageId,
        surfaceStack: state.surfaceStack.length > 0 ? state.surfaceStack : [state.pageId],
        model: state.model,
        appUrl: state.config.url,
        fence: state.config.fence,
        intro: state.config.intro,
        skip: state.config.skip,
        inIntro: state.inIntro,
        ...(state.configPath ? { configPath: state.configPath } : {}),
      });
      await dumpVerboseState(state, "land", landView);
    }
    if (state.outDir) touchPresence(state.outDir, state.pageId);
  }

  return { runStep, runLine, runIntro };
}
