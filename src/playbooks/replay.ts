import { copyFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveCount } from "../surveyor/resolve.js";
import { offlineIdsExist } from "../surveyor/merge.js";
import { bootRun, locatorsFromModel } from "../executor/boot.js";
import { createExecutor } from "../executor/run.js";
import { readyKey, widgetKey } from "../executor/steps.js";
import { withRun } from "../executor/session.js";
import { readLog, writeLog } from "../persist/log.js";
import { stopPresence } from "../persist/presence.js";
import { replayableSteps } from "./compact.js";
import { requirePageModel, type Config } from "../schema/config.js";
import { findingId, type Finding } from "../schema/finding.js";
import type { Locator } from "../schema/locator.js";
import type { Log, Step } from "../schema/log.js";
import type { PageModel } from "../schema/page-model.js";

export class ReplayLiveValidateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayLiveValidateError";
  }
}

export function keysFromSteps(steps: Step[]): string[] {
  const keys: string[] = [];
  for (const step of steps) {
    if (step.kind === "open") keys.push(readyKey(step.page));
    else if (
      step.kind === "click" ||
      step.kind === "fill" ||
      step.kind === "expectInvalid" ||
      step.kind === "expectText" ||
      step.kind === "expectValue"
    ) {
      keys.push(widgetKey(step.surface, step.id));
    } else if (step.kind === "expectVisible" || step.kind === "expectHidden") {
      keys.push(step.surface);
    }
  }
  return keys;
}

function unknownIdFinding(logPath: string, missing: string[]): Finding {
  return {
    schemaVersion: 1,
    id: findingId(0, "unknownId"),
    kind: "unknownId",
    message: `unknown id ${missing.join(", ")}`,
    tapePath: logPath,
    stepIndex: 0,
  };
}

function usedLocatorsFor(model: PageModel, log: Log): Record<string, Locator> {
  const fromModel = locatorsFromModel(model);
  const fromLog = log.usedLocators;
  if (Object.keys(fromLog).length === 0) return fromModel;
  return { ...fromModel, ...fromLog };
}

export async function replayLog(opts: {
  config: Config;
  configPath: string;
  logPath: string;
  outDir: string;
  headed?: boolean;
  timeout?: number;
  verbose?: boolean;
  /** Take / copy a shot of the page after the last step. */
  afterScreenshot?: string;
}): Promise<{ ok: boolean; findings: Finding[]; reproduced?: { kind: string; stepIndex: number } }> {
  const log = readLog(opts.logPath);
  const model = requirePageModel(opts.config.map);
  const steps = replayableSteps(log.steps, opts.config.intro);
  const check = offlineIdsExist(model, keysFromSteps(steps));
  if (!check.ok) {
    const finding = unknownIdFinding(opts.logPath, check.missing);
    return { ok: false, findings: [finding] };
  }

  const usedLocators = usedLocatorsFor(model, log);

  try {
    return await withRun({ headed: opts.headed, timeout: opts.timeout }, async (handle) => {
    const state = await bootRun(handle, opts.config, opts.outDir, {
      configPath: opts.configPath,
      replay: true,
      usedLocators,
      verbose: opts.verbose,
    });
    const exec = createExecutor(state);
    if (state.config.intro.length > 0) await exec.runIntro();

    const pageDef = state.model.pages.find((p) => p.id === state.pageId);
    if (pageDef) {
      const ready = await resolveCount(state.page, pageDef.ready);
      if (ready.status !== "ok") {
        throw new ReplayLiveValidateError(`live-validate failed: page:${pageDef.id}.ready`);
      }
    }

    const findings: Finding[] = [];
    let reproduced: { kind: string; stepIndex: number } | undefined;
    for (const step of steps) {
      const result = await exec.runStep(step);
      if (result.finding) {
        findings.push(result.finding);
        reproduced ??= { kind: result.finding.kind, stepIndex: result.finding.stepIndex };
      }
    }

    if (findings[0]) {
      writeLog(join(opts.outDir, "replay.log"), {
        ...state.log,
        bug: log.bug ?? findings[0].message,
        found: log.found ?? new Date().toISOString(),
        comments: log.comments,
        result: "failed",
      });
    }

    if (opts.afterScreenshot) {
      const last = log.steps[log.steps.length - 1];
      const src = state.lastScreenshotPath;
      if (last?.kind === "screenshot") {
        if (src && existsSync(src) && resolve(src) !== resolve(opts.afterScreenshot)) {
          copyFileSync(src, opts.afterScreenshot);
        } else if (!src || !existsSync(src)) {
          await state.page.screenshot({ path: opts.afterScreenshot, fullPage: true }).catch(() => undefined);
        }
      } else {
        await state.page.screenshot({ path: opts.afterScreenshot }).catch(() => undefined);
      }
    }

    return { ok: findings.length === 0, findings, ...(reproduced ? { reproduced } : {}) };
    });
  } finally {
    stopPresence(opts.outDir);
  }
}
