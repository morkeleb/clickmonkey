import { writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import {
  checkExploreLine,
  completeCurrentPlanItem,
  DEFAULT_EXPLORE_CHARTER,
  isBrainMissFinding,
  isNewProductFinding,
  legalDirectOpenIds,
  recordPlanStep,
  usefulExploreNote,
} from "../brains/explore.js";
import { detectWalkerMode } from "../brains/walker-mode.js";
import { bootRun } from "../executor/boot.js";
import { logBrainDecide } from "../executor/nav-log.js";
import { createExecutor, type RunState, type StepResult } from "../executor/run.js";
import { withRun } from "../executor/session.js";
import { buildView } from "../executor/view.js";
import { writeLog } from "../persist/log.js";
import { exploreOutlineOf, setPresenceOutline, stopPresence } from "../persist/presence.js";
import type { Config } from "../schema/config.js";
import { severityForKind, type Finding, type FindingSeverity } from "../schema/finding.js";
import type { Log } from "../schema/log.js";
import { formatExplorePlanItemLine, type UiExplorePlan } from "../schema/ui.js";
import type { View } from "../schema/view.js";
import { formatExploreVisit, type ExploreVisit } from "../schema/visit.js";
import { pickSeedPageId, resetToSeed } from "./seed.js";

const RUNTIME_KINDS = new Set(["pageError", "httpError", "notFound"]);

export interface ExploreResult {
  ok: boolean;
  findings: Finding[];
  log: Log;
  logPath: string;
  sessionPath: string;
  stepsUsed: number;
}

export type ExploreStepOpts = {
  note?: string;
  good?: string;
  done?: boolean;
};

export type ExploreStepResult =
  | { ok: true; result: StepResult; visit: ExploreVisit; newProductFinding: boolean }
  | { ok: false; error: string; ban?: boolean; visit: ExploreVisit };

export type ExploreAfterStep = (info: {
  line: string;
  result: StepResult;
  view: View;
  newProductFinding: boolean;
}) => Promise<void> | void;

export function snapshotView(state: RunState): Promise<View> {
  return buildView({
    page: state.page,
    pageId: state.pageId,
    surfaceStack: state.surfaceStack.length > 0 ? state.surfaceStack : [state.pageId],
    model: state.model,
    appUrl: state.config.url,
    fence: state.config.fence,
    intro: state.config.intro,
    skip: state.config.skip,
    inIntro: Boolean(state.inIntro),
  });
}

function relativeShot(path: string | undefined, outDir: string): string | undefined {
  if (!path) return undefined;
  const rel = relative(outDir, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return path;
  return rel.split("\\").join("/");
}

export function exploreVisitOf(state: RunState, view: View, plan?: UiExplorePlan): ExploreVisit {
  const page = state.model.pages.find((p) => p.id === state.pageId);
  const now = plan?.items.find((i) => i.status === "now");
  const shot = relativeShot(state.lastScreenshotPath, state.outDir);
  const sight = state.lastSight?.trim();
  return formatExploreVisit({
    view,
    ...(page?.ready ? { ready: page.ready } : {}),
    legalOpen: legalDirectOpenIds(view, state.model.pages),
    ...(shot ? { shot } : {}),
    ...(sight ? { sight } : {}),
    writePolicy: state.config.writePolicy,
    ...(now ? { planLine: formatExplorePlanItemLine(now) } : {}),
  });
}

function listFindings(items: Finding[]): string {
  if (items.length === 0) return "(none)";
  return items.map((f) => `- ${f.id}: ${f.message}`).join("\n");
}

/** Host instruction after a walk: digest visits/notes/goods/shots, do not invent bugs. */
export const EXPLORE_REPORT_PROMPT =
  "Write a short digest of this explore session from the visits, notes, goods, and shot paths. Lead with product findings a user would notice. Runtime errors first. Do not invent ids or bugs that were not observed. session.md and the findings report are already on disk after explore_finish.";

export function writeSessionMd(opts: {
  path: string;
  startedAt: number;
  charter: string;
  config: Config;
  findings: Finding[];
  notes: string[];
  goods: string[];
  plan?: UiExplorePlan;
}): void {
  const bySev: Record<FindingSeverity, Finding[]> = {
    critical: [],
    major: [],
    minor: [],
    suggestion: [],
  };
  const runtime: Finding[] = [];
  for (const f of opts.findings) {
    const sev = f.severity ?? severityForKind(f.kind);
    bySev[sev].push(f);
    if (RUNTIME_KINDS.has(f.kind)) runtime.push(f);
  }
  const brain = opts.config.brain;
  const notes = opts.notes.length ? opts.notes.map((n) => `- ${n}`).join("\n") : "(none)";
  const goods = opts.goods.length ? opts.goods.map((n) => `- ${n}`).join("\n") : "(none)";
  const body = [
    `# Explore session — ${new Date(opts.startedAt).toISOString()} — ${opts.charter}`,
    "## Configuration",
    `- url: ${opts.config.url}`,
    `- model: ${brain?.model ?? ""}`,
    `- baseUrl: ${brain?.baseUrl ?? ""}`,
    "## Runtime errors",
    listFindings(runtime),
    "## Critical / Major / Minor / Suggestion",
    "### Critical",
    listFindings(bySev.critical),
    "### Major",
    listFindings(bySev.major),
    "### Minor",
    listFindings(bySev.minor),
    "### Suggestion",
    listFindings(bySev.suggestion),
    "## Plan",
    opts.plan
      ? [`${opts.plan.goal}`, ...opts.plan.items.map((it) => formatExplorePlanItemLine(it))].join("\n")
      : "(none)",
    "## Notes",
    notes,
    "## Positive observations",
    goods,
    "",
  ].join("\n");
  writeFileSync(opts.path, body, "utf8");
}

export type ExploreWalkCtx = {
  state: RunState;
  exec: ReturnType<typeof createExecutor>;
  charter: string;
  seedPageId: string;
  view?: View;
  stepsUsed: number;
  refused: Set<string>;
  recent: string[];
  plan?: UiExplorePlan;
  findings: Finding[];
  notes: string[];
  goods: string[];
  outDir: string;
  config: Config;
  configPath?: string;
  startedAt: number;
  logPath: string;
  sessionPath: string;
  polish?: () => Promise<void>;
  onAfterStep?: ExploreAfterStep;
};

export async function applyExploreStep(
  ctx: ExploreWalkCtx,
  line: string,
  opts?: ExploreStepOpts,
): Promise<ExploreStepResult> {
  const trimmed = line.trim();
  const note = usefulExploreNote(opts?.note);
  const good = usefulExploreNote(opts?.good);
  if (note) ctx.notes.push(note);
  if (good) ctx.goods.push(good);
  const view = ctx.view;
  if (!view) {
    return {
      ok: false,
      error: "explore session has no snapshot",
      visit: formatExploreVisit({
        view: { page: ctx.state.pageId, surface: "page", stack: [ctx.state.pageId], shown: [], actions: [] },
      }),
    };
  }

  const check = checkExploreLine(trimmed, view, {
    stepsUsed: ctx.stepsUsed,
    charter: ctx.charter,
    rejected: [...ctx.refused],
    recent: ctx.recent,
    pages: ctx.state.model.pages,
  });
  if (!check.ok) {
    if (check.ban !== false) ctx.refused.add(trimmed);
    const refusedView: View = {
      ...view,
      last: { step: trimmed, ok: false, ...(check.ban !== false ? { finding: "unknownId" } : {}) },
    };
    ctx.view = refusedView;
    return {
      ok: false,
      error: check.error,
      ...(check.ban !== undefined ? { ban: check.ban } : {}),
      visit: exploreVisitOf(ctx.state, refusedView, ctx.plan),
    };
  }

  const currentItem = ctx.plan?.items.find((i) => i.status === "now");
  setPresenceOutline(
    ctx.outDir,
    exploreOutlineOf({
      charter: ctx.charter,
      now: [currentItem?.title, note || trimmed].filter(Boolean).join(" — "),
      notes: ctx.notes,
      plan: ctx.plan,
    }),
  );
  if (ctx.state.navLogPath) {
    logBrainDecide(ctx.state.navLogPath, { line: trimmed, note, good });
  }
  const mode = view.mode ?? detectWalkerMode({ view, stepsUsed: ctx.stepsUsed }).name;
  if (ctx.state.navMeta) ctx.state.navMeta.mode = mode;

  const result = await ctx.exec.runLine(trimmed);
  ctx.stepsUsed += 1;
  ctx.recent.push(trimmed);
  if (ctx.recent.length > 12) ctx.recent.shift();

  const newProductFinding = isNewProductFinding({
    finding: result.finding,
    findingCreated: result.findingCreated,
    currentFindingIds: ctx.plan?.items.find((i) => i.status === "now")?.findingIds,
  });
  if (ctx.plan) {
    ctx.plan = recordPlanStep(
      ctx.plan,
      newProductFinding && result.finding ? { findingId: result.finding.id } : undefined,
    );
  }

  if (ctx.onAfterStep) {
    await ctx.onAfterStep({ line: trimmed, result, view: result.view, newProductFinding });
  }

  if (result.finding && isBrainMissFinding(result.finding.kind)) {
    ctx.refused.add(trimmed);
    ctx.view = result.view;
  } else if (newProductFinding && result.finding) {
    ctx.findings.push(result.finding);
    ctx.view = await resetToSeed(ctx.exec, ctx.state, ctx.seedPageId);
  } else if (result.finding) {
    ctx.view = await resetToSeed(ctx.exec, ctx.state, ctx.seedPageId);
  } else if (result.bounced) {
    ctx.view = await resetToSeed(ctx.exec, ctx.state, ctx.seedPageId);
  } else {
    if (ctx.polish) await ctx.polish();
    ctx.view = await snapshotView(ctx.state);
    if (ctx.view.last === undefined && result.view.last) ctx.view = { ...ctx.view, last: result.view.last };
  }

  if (opts?.done && ctx.plan) {
    ctx.plan = completeCurrentPlanItem(ctx.plan, "done");
    const next = ctx.plan.items.find((i) => i.status === "now");
    setPresenceOutline(
      ctx.outDir,
      exploreOutlineOf({
        charter: ctx.charter,
        now: next?.title || "plan complete",
        notes: ctx.notes,
        plan: ctx.plan,
      }),
    );
  }

  const nextView = ctx.view ?? result.view;
  ctx.view = nextView;
  return {
    ok: true,
    result,
    visit: exploreVisitOf(ctx.state, nextView, ctx.plan),
    newProductFinding,
  };
}

export type ExploreWalkOpts = {
  state: RunState;
  exec: ReturnType<typeof createExecutor>;
  charter: string;
  startedAt: number;
  seedPageId: string;
  config: Config;
  configPath?: string;
  outDir: string;
  polish?: () => Promise<void>;
  onAfterStep?: ExploreAfterStep;
};

export class ExploreSession {
  private ctx?: ExploreWalkCtx;
  private releaseRun?: () => void;
  private runDone?: Promise<void>;

  static attach(opts: ExploreWalkOpts): ExploreSession {
    const session = new ExploreSession();
    session.bind(opts);
    return session;
  }

  get stepsUsed(): number {
    return this.ctx?.stepsUsed ?? 0;
  }

  get recent(): string[] {
    return this.ctx?.recent ?? [];
  }

  get findings(): Finding[] {
    return this.ctx?.findings ?? [];
  }

  get plan(): UiExplorePlan | undefined {
    return this.ctx?.plan;
  }

  get currentView(): View | undefined {
    return this.ctx?.view;
  }

  get started(): boolean {
    return Boolean(this.ctx);
  }

  get outDir(): string | undefined {
    return this.ctx?.outDir;
  }

  get configPath(): string | undefined {
    return this.ctx?.configPath;
  }

  get config(): Config | undefined {
    return this.ctx?.config;
  }

  get lastScreenshotPath(): string | undefined {
    return this.ctx?.state.lastScreenshotPath;
  }

  get pages() {
    return this.ctx?.state.model.pages ?? [];
  }

  get livePageUrl(): string | undefined {
    try {
      return this.ctx?.state.page.url();
    } catch {
      return undefined;
    }
  }

  async start(opts: {
    config: Config;
    configPath: string;
    outDir: string;
    headed?: boolean;
    timeout?: number;
    charter?: string;
    skills?: string;
    verbose?: boolean;
    brainName?: string;
  }): Promise<ExploreVisit> {
    if (this.ctx) await this.finish();
    const charter = opts.charter?.trim() || DEFAULT_EXPLORE_CHARTER;
    let resolveVisit!: (visit: ExploreVisit) => void;
    let rejectVisit!: (err: unknown) => void;
    const visitReady = new Promise<ExploreVisit>((res, rej) => {
      resolveVisit = res;
      rejectVisit = rej;
    });
    let released = false;
    const untilRelease = new Promise<void>((res) => {
      this.releaseRun = () => {
        if (released) return;
        released = true;
        res();
      };
    });
    this.runDone = withRun({ headed: opts.headed, timeout: opts.timeout }, async (handle) => {
      try {
        const state = await bootRun(handle, opts.config, opts.outDir, {
          configPath: opts.configPath,
          verbose: opts.verbose,
          brain: opts.brainName ?? "explore",
        });
        const exec = createExecutor(state);
        setPresenceOutline(opts.outDir, exploreOutlineOf({ charter }));
        if (state.config.intro.length > 0) await exec.runIntro();
        const seedPageId = pickSeedPageId(state, state.pageId) ?? state.pageId;
        this.bind({
          state,
          exec,
          charter,
          startedAt: Date.now(),
          seedPageId,
          config: opts.config,
          configPath: opts.configPath,
          outDir: opts.outDir,
        });
        const visit = await this.visit();
        resolveVisit(visit);
        await untilRelease;
      } catch (err) {
        rejectVisit(err);
        throw err;
      } finally {
        stopPresence(opts.outDir);
      }
    }).then(
      () => undefined,
      () => undefined,
    );
    return visitReady;
  }

  async snapshot(): Promise<View> {
    const ctx = this.requireWalk();
    ctx.view = await snapshotView(ctx.state);
    return ctx.view;
  }

  async visit(): Promise<ExploreVisit> {
    const ctx = this.requireWalk();
    const view = await this.snapshot();
    return exploreVisitOf(ctx.state, view, ctx.plan);
  }

  async step(line: string, opts?: ExploreStepOpts): Promise<ExploreStepResult> {
    const ctx = this.requireWalk();
    if (!ctx.view) ctx.view = await snapshotView(ctx.state);
    return applyExploreStep(ctx, line, opts);
  }

  setPlan(plan: UiExplorePlan): void {
    const ctx = this.requireWalk();
    ctx.plan = plan;
    const now = plan.items.find((i) => i.status === "now");
    setPresenceOutline(
      ctx.outDir,
      exploreOutlineOf({
        charter: ctx.charter,
        now: now?.title,
        notes: ctx.notes,
        plan,
      }),
    );
  }

  advancePlan(status: "done" | "skipped"): void {
    const ctx = this.requireWalk();
    if (!ctx.plan) return;
    ctx.plan = completeCurrentPlanItem(ctx.plan, status);
    const now = ctx.plan.items.find((i) => i.status === "now");
    setPresenceOutline(
      ctx.outDir,
      exploreOutlineOf({
        charter: ctx.charter,
        now: now?.title || "plan complete",
        notes: ctx.notes,
        plan: ctx.plan,
      }),
    );
  }

  addNote(text: string): void {
    const ctx = this.requireWalk();
    const note = usefulExploreNote(text);
    if (note) ctx.notes.push(note);
  }

  addGood(text: string): void {
    const ctx = this.requireWalk();
    const good = usefulExploreNote(text);
    if (good) ctx.goods.push(good);
  }

  async finish(opts?: { notes?: string[]; goods?: string[] }): Promise<ExploreResult> {
    try {
      return this.flush(opts);
    } finally {
      const outDir = this.ctx?.outDir;
      this.releaseRun?.();
      if (this.runDone) await this.runDone;
      if (outDir) stopPresence(outDir);
      this.ctx = undefined;
      this.releaseRun = undefined;
      this.runDone = undefined;
    }
  }

  private bind(opts: ExploreWalkOpts): void {
    this.ctx = {
      state: opts.state,
      exec: opts.exec,
      charter: opts.charter,
      seedPageId: opts.seedPageId,
      stepsUsed: 0,
      refused: new Set(),
      recent: [],
      findings: [],
      notes: [],
      goods: [],
      outDir: opts.outDir,
      config: opts.config,
      ...(opts.configPath ? { configPath: opts.configPath } : {}),
      startedAt: opts.startedAt,
      logPath: join(opts.outDir, "log.txt"),
      sessionPath: join(opts.outDir, "session.md"),
      polish: opts.polish,
      onAfterStep: opts.onAfterStep,
    };
  }

  private requireWalk(): ExploreWalkCtx {
    if (!this.ctx) throw new Error("explore session is not started");
    return this.ctx;
  }

  private flush(opts?: { notes?: string[]; goods?: string[] }): ExploreResult {
    const ctx = this.ctx;
    const log: Log = {
      schemaVersion: 1,
      comments: [],
      steps: ctx?.state.log.steps ?? [],
      usedLocators: { ...(ctx?.state.usedLocators ?? {}) },
      result: (ctx?.findings.length ?? 0) > 0 ? "failed" : "passed",
    };
    const logPath = ctx?.logPath ?? "";
    const sessionPath = ctx?.sessionPath ?? "";
    if (ctx && logPath) writeLog(logPath, log);
    if (ctx && sessionPath) {
      writeSessionMd({
        path: sessionPath,
        startedAt: ctx.startedAt,
        charter: ctx.charter,
        config: ctx.config,
        findings: ctx.findings,
        notes: opts?.notes ?? ctx.notes,
        goods: opts?.goods ?? ctx.goods,
        plan: ctx.plan,
      });
    }
    return {
      ok: (ctx?.findings.length ?? 0) === 0,
      findings: ctx?.findings ?? [],
      log,
      logPath,
      sessionPath,
      stepsUsed: ctx?.stepsUsed ?? 0,
    };
  }
}

export function createExploreWalk(opts: ExploreWalkOpts): ExploreSession {
  return ExploreSession.attach(opts);
}
