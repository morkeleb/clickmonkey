import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { persistFinding, shouldPersistFinding } from "../persist/finding.js";
import { touchPresence } from "../persist/presence.js";
import { persistQualityRuntime } from "../persist/quality.js";
import { normalizeQualityMessage } from "../schema/quality.js";
import { compactLog, hoppedStepIndexes } from "../playbooks/compact.js";
import { parseLine, formatLog, formatStep } from "../schema/dsl.js";
import { findingId, severityForKind, type Finding, type FindingKind } from "../schema/finding.js";
import type { Locator } from "../schema/locator.js";
import type { Log, Step } from "../schema/log.js";
import type { Config } from "../schema/config.js";
import type { PageModel, PageModelDraft } from "../schema/page-model.js";
import type { View } from "../schema/view.js";
import { attachHttpOracle, isDocumentNotFound, type OracleFinding } from "../oracles/http.js";
import { reportDocumentNotFound } from "../persist/broken.js";
import { attachPageErrorOracle } from "../oracles/page-error.js";
import { checkFence } from "./fence.js";
import { performStep, syncPageFromUrl, syncSurfaceStack, type StepFailure } from "./steps.js";
import { ledgerOrigin, originOfHref } from "../surveyor/ready.js";
import { hoppablePages, hopContextOf } from "./hop.js";
import { logLand, logStepDone, logStepStart } from "./nav-log.js";
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
  lastAction?: { surface: string; id: string; opens?: string };
  lastScreenshotPath?: string;
  /** Intro is how we enter the leash; fence applies after it. */
  inIntro?: boolean;
  navMeta?: { step?: string; pageId?: string; phase?: string };
  navLogPath?: string;
  /** Per-step HTML + view dumps under outDir/verbose/. */
  verbose?: boolean;
  verboseSeq?: number;
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
      );
    } catch {
      // ledger write must not stall the walk
    }
  });
}

async function screenshotFinding(
  state: RunState,
  partial: StepFailure | OracleFinding | (Partial<Finding> & { kind: FindingKind; message: string }),
  step?: Step,
): Promise<Finding> {
  const stepIndex = state.log.steps.length;
  const kind = partial.kind;
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
      await state.page.screenshot({ path: screenshotPath }).catch(() => undefined);
    }
  }
  const finding: Finding = {
    schemaVersion: 1,
    id,
    kind,
    severity: severityForKind(kind),
    message: partial.message,
    tapePath: join(state.outDir, "replay.log"),
    stepIndex,
    ...(screenshotPath ? { screenshotPath } : {}),
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

function lastActionFromStep(state: RunState, step: Step): RunState["lastAction"] {
  if (step.kind !== "click") return undefined;
  for (const page of state.model.pages) {
    const surface = page.surfaces.find((s) => s.id === step.surface);
    const action = surface?.actions.find((a) => a.id === step.id);
    if (!action) continue;
    return action.opens
      ? { surface: step.surface, id: step.id, opens: action.opens }
      : { surface: step.surface, id: step.id };
  }
  return { surface: step.surface, id: step.id };
}

async function finish(
  state: RunState,
  step: Step,
  stepFailure?: StepFailure,
): Promise<StepResult> {
  state.lastAction = lastActionFromStep(state, step);
  syncPageFromUrl(state);
  await syncSurfaceStack(state);

  const href = state.page.url();
  const fenceHit = state.inIntro ? "ok" : checkFence(href, state.config.fence);
  const refusedFence = stepFailure?.kind === "fenceViolation";
  const bounced = fenceHit !== "ok";

  let finding: Finding | undefined;
  if (bounced) {
    // Left the leash. Recover without treating it as a website finding.
  } else if (isDocumentNotFound(state.page)) {
    if (state.configPath) reportDocumentNotFound(state.configPath, state.page);
    const pending404 = state.pendingFindings.find((f) => f.kind === "notFound");
    finding = await screenshotFinding(
      state,
      pending404 ?? {
        kind: "notFound",
        message: `HTTP 404 GET ${href}`,
        httpStatus: 404,
        url: href,
      },
      step,
    );
    state.pendingFindings = state.pendingFindings.filter((f) => f !== pending404);
  } else {
    await state.afterStep?.(state);
    if (state.outDir) touchPresence(state.outDir, state.pageId);
    if (stepFailure && stepFailure.kind !== "fenceViolation") {
      finding = await screenshotFinding(state, stepFailure, step);
    } else if (state.pendingFindings[0]) {
      finding = await screenshotFinding(state, state.pendingFindings.shift()!, step);
    }
  }

  let findingCreated = false;
  if (finding && shouldPersistFinding(finding.kind)) {
    const persisted = persistFinding(state.outDir, finding, {
      screenshotPath: finding.screenshotPath,
      replayLog: formatLog(
        compactLog(
          {
            schemaVersion: 1,
            bug: finding.message,
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
      ),
    });
    finding = persisted.finding;
    findingCreated = persisted.created;
    if (step.kind === "screenshot" && finding.screenshotPath) {
      state.lastScreenshotPath = finding.screenshotPath;
    }
  }

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
    last: {
      step: formatStep(step),
      ok: !finding,
      ...(finding ? { finding: finding.kind } : bounced || refusedFence ? { finding: "fenceViolation" } : {}),
    },
  });

  await dumpVerboseState(state, formatStep(step), view);

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
    const line = formatStep(step);
    const phase = state.inIntro ? "intro" : "walk";
    if (state.navMeta) {
      state.navMeta.step = line;
      state.navMeta.pageId = state.pageId;
      state.navMeta.phase = phase;
    }
    const started = state.navLogPath
      ? logStepStart(state.navLogPath, {
          line,
          pageId: state.pageId,
          phase,
          echo: process.stderr,
        })
      : Date.now();
    let failure: StepFailure | undefined;
    try {
      failure = await performStep(state, step);
    } catch (err) {
      failure = {
        kind: "expectFailed",
        message: err instanceof Error ? err.message : String(err),
      };
    }
    const result = await finish(state, step, failure);
    if (state.navLogPath) {
      logStepDone(state.navLogPath, {
        line,
        ok: result.ok,
        started,
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
      });
      await dumpVerboseState(state, "land", landView);
    }
    if (state.outDir) touchPresence(state.outDir, state.pageId);
  }

  return { runStep, runLine, runIntro };
}
