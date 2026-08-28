import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { bootRun } from "../executor/boot.js";
import { createExecutor, type RunState, type StepResult } from "../executor/run.js";
import type { RunHandle } from "../executor/session.js";
import { DEFAULT_ACTION_TIMEOUT_MS, rememberActionTimeout } from "../executor/timeout.js";
import { trackDocumentResponses } from "../oracles/http.js";
import { loadConfig } from "../persist/config.js";
import { writeLog } from "../persist/log.js";
import { stopPresence } from "../persist/presence.js";
import { collectFindingCases } from "../persist/runs.js";
import { loadQualityReport } from "../persist/quality.js";
import { newRunId } from "../persist/run-id.js";
import { loadTestabilityReport } from "../persist/testability.js";
import { runsDir } from "../persist/workspace.js";
import { specStepFailed } from "../playbooks/spec.js";
import { Config, requireVisionShots } from "../schema/config.js";
import type { Finding } from "../schema/finding.js";
import type { Step } from "../schema/log.js";
import type { QualityReport } from "../schema/quality.js";
import type { TestabilityReport } from "../schema/testability.js";

export type SessionOpts = {
  config?: string;
  url?: string;
  headed?: boolean;
  timeout?: number;
  /** Default "test". Spec specialization. */
  brain?: string;
};

async function closeHandle(handle: Pick<RunHandle, "browser" | "context" | "page">): Promise<void> {
  await handle.page.close().catch(() => undefined);
  await handle.context.close().catch(() => undefined);
  await handle.browser.close().catch(() => undefined);
}

export class SessionRuntime {
  findings: Finding[] = [];
  private closed = false;

  constructor(
    private readonly exec: ReturnType<typeof createExecutor>,
    private readonly state: RunState,
    private readonly handle: RunHandle,
    private readonly outDir: string,
  ) {}

  get blocking(): Finding[] {
    return this.findings.filter((f) => specStepFailed(f.kind));
  }

  get ledger(): { quality: QualityReport; testability: TestabilityReport } {
    return {
      quality: loadQualityReport(join(this.outDir, "quality.json")),
      testability: loadTestabilityReport(join(this.outDir, "testability.json")),
    };
  }

  get pageId(): string {
    return this.state.pageId;
  }

  async runStep(step: Step): Promise<StepResult> {
    const result = await this.exec.runStep(step);
    if (result.finding) this.findings.push(result.finding);
    return result;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    try {
      if (this.state.log.steps.length > 0) {
        writeLog(join(this.outDir, "log.txt"), this.state.log);
      }
    } finally {
      this.closed = true;
      stopPresence(this.outDir);
      await closeHandle(this.handle);
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

export async function createSession(opts?: SessionOpts): Promise<SessionRuntime> {
  const configPath = resolve(process.cwd(), opts?.config ?? "clickmonkey.json");
  let config = loadConfig(configPath);
  if (opts?.url) config = Config.parse({ ...config, url: opts.url });
  requireVisionShots(config);

  const timeout = opts?.timeout ?? DEFAULT_ACTION_TIMEOUT_MS;
  const browser = await chromium.launch({ headless: !opts?.headed });
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let outDir: string | undefined;
  try {
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    context.setDefaultTimeout(timeout);
    rememberActionTimeout(context, timeout);
    page = await context.newPage();
    trackDocumentResponses(page);
    const handle: RunHandle = { browser, context, page };
    outDir = join(runsDir(configPath), newRunId());
    const state = await bootRun(handle, config, outDir, {
      configPath,
      brain: opts?.brain ?? "test",
    });
    const exec = createExecutor(state);
    if (state.config.intro.length > 0) await exec.runIntro();
    const runtime = new SessionRuntime(exec, state, handle, outDir);
    for (const hit of collectFindingCases([outDir], { tapes: false })) {
      runtime.findings.push(hit.finding);
    }
    return runtime;
  } catch (err) {
    if (outDir) stopPresence(outDir);
    if (page) await page.close().catch(() => undefined);
    if (context) await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    throw err;
  }
}
