import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { persistFinding } from "../persist/finding.js";
import { compactLog } from "../playbooks/compact.js";
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
}

export interface StepResult {
  ok: boolean;
  step: Step;
  finding?: Finding;
  view: View;
}

const attachedPages = new WeakSet<Page>();

function attachOracles(state: RunState): void {
  if (attachedPages.has(state.page)) return;
  attachedPages.add(state.page);
  const push = (f: OracleFinding) => {
    state.pendingFindings.push(f);
  };
  attachHttpOracle(state.page, push);
  attachPageErrorOracle(state.page, push);
}

async function screenshotFinding(
  state: RunState,
  partial: StepFailure | OracleFinding | (Partial<Finding> & { kind: FindingKind; message: string }),
): Promise<Finding> {
  const stepIndex = state.log.steps.length;
  const kind = partial.kind;
  const id = findingId(stepIndex, kind);
  mkdirSync(state.outDir, { recursive: true });
  let screenshotPath = state.lastScreenshotPath;
  if (!screenshotPath) {
    screenshotPath = join(state.outDir, `.shot-${id}.png`);
    await state.page.screenshot({ path: screenshotPath }).catch(() => undefined);
  }
  const finding: Finding = {
    schemaVersion: 1,
    id,
    kind,
    severity: severityForKind(kind),
    message: partial.message,
    tapePath: join(state.outDir, "replay.log"),
    screenshotPath,
    stepIndex,
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
  const fenceHit = checkFence(href, state.config.fence);

  let finding: Finding | undefined;
  if (fenceHit !== "ok") {
    finding = await screenshotFinding(state, {
      kind: "fenceViolation",
      message:
        fenceHit === "blacklist"
          ? `URL matches fence blacklist: ${href}`
          : `URL left fence path: ${href}`,
      url: href,
    });
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
    );
    state.pendingFindings = state.pendingFindings.filter((f) => f !== pending404);
  } else {
    await state.afterStep?.(state);
    if (stepFailure) {
      finding = await screenshotFinding(state, stepFailure);
    } else if (state.pendingFindings[0]) {
      finding = await screenshotFinding(state, state.pendingFindings.shift()!);
    }
  }

  if (finding) {
    persistFinding(state.outDir, finding, {
      screenshotPath: finding.screenshotPath,
      replayLog: formatLog(
        compactLog({
          schemaVersion: 1,
          bug: finding.message,
          found: new Date().toISOString(),
          comments: state.log.comments,
          steps: [...state.log.steps, step],
          usedLocators: { ...state.usedLocators },
          result: "failed",
        }),
      ),
    });
  }

  state.log.steps.push(step);

  const view = await buildView({
    page: state.page,
    pageId: state.pageId,
    surfaceStack: state.surfaceStack.length > 0 ? state.surfaceStack : [state.pageId],
    model: state.model,
    last: {
      step: formatStep(step),
      ok: !finding,
      ...(finding ? { finding: finding.kind } : {}),
    },
  });

  return { ok: !finding, step, finding, view };
}

export function createExecutor(state: RunState): {
  runStep(step: Step): Promise<StepResult>;
  runLine(line: string): Promise<StepResult>;
  runIntro(): Promise<void>;
} {
  attachOracles(state);

  async function runStep(step: Step): Promise<StepResult> {
    let failure: StepFailure | undefined;
    try {
      failure = await performStep(state, step);
    } catch (err) {
      failure = {
        kind: "expectFailed",
        message: err instanceof Error ? err.message : String(err),
      };
    }
    return finish(state, step, failure);
  }

  async function runLine(line: string): Promise<StepResult> {
    const parsed = parseLine(line);
    if (!parsed || "comment" in parsed) {
      throw new Error(`not a step: ${line}`);
    }
    return runStep(parsed);
  }

  async function runIntro(): Promise<void> {
    for (const line of state.config.intro) {
      const parsed = parseLine(line);
      if (!parsed || "comment" in parsed) continue;
      const result = await runStep(parsed);
      if (!result.ok) {
        throw new Error(result.finding?.message ?? `intro step failed: ${formatStep(parsed)}`);
      }
    }
  }

  return { runStep, runLine, runIntro };
}
