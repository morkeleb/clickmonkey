import { existsSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import {
  checkExploreLine,
  completeCurrentPlanItem,
  DEFAULT_EXPLORE_CHARTER,
  isBrainMissFinding,
  isNewProductFinding,
  legalDirectOpenIds,
  PLAN_CONTEXT_MAX,
  recordPlanStep,
  usefulExploreNote,
} from "../brains/explore.js";
import { detectWalkerMode, lineMatchesMode } from "../brains/walker-mode.js";
import { needsLeashReentry } from "../brains/unleash.js";
import { recordMode } from "../persist/fog.js";
import { bootRun } from "../executor/boot.js";
import { formatLiveLine, logBrainDecide } from "../executor/nav-log.js";
import { createExecutor, type RunState, type StepResult } from "../executor/run.js";
import { withRun, type RunHandle } from "../executor/session.js";
import { formatPageState, snapshotPageState } from "../executor/page-state.js";
import { buildView } from "../executor/view.js";
import { writeFinding } from "../persist/finding.js";
import { writeLog } from "../persist/log.js";
import { exploreOutlineOf, setPresenceOutline, stopPresence, touchPresence } from "../persist/presence.js";
import type { Config } from "../schema/config.js";
import { severityForKind, type Finding, type FindingSeverity } from "../schema/finding.js";
import type { Log } from "../schema/log.js";
import { formatExplorePlanItemLine, type UiExplorePlan } from "../schema/ui.js";
import type { View } from "../schema/view.js";
import { formatExploreVisit, type ExploreVisit } from "../schema/visit.js";
import { liveHref, recoverLeashIfNeeded, type LeashReentryBudget } from "./leash.js";
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
  /** Host-filed bug: skip walker screenshot-spam bans. */
  hostFinding?: boolean;
  severity?: FindingSeverity;
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
    ...(state.configPath ? { configPath: state.configPath } : {}),
  });
}

/** `buildView` does not stamp last; keep the prior step so visit/screenshot policy still see it. */
export function withPriorLast(view: View, last?: View["last"]): View {
  if (view.last !== undefined || last === undefined) return view;
  return { ...view, last };
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
  skills?: string;
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
    opts.skills?.trim()
      ? `- skills:\n${opts.skills.trim().length <= PLAN_CONTEXT_MAX ? opts.skills.trim() : `${opts.skills.trim().slice(0, PLAN_CONTEXT_MAX - 1)}…`}`
      : "- skills: (none)",
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
  skills?: string;
  polish?: () => Promise<void>;
  onAfterStep?: ExploreAfterStep;
  leash?: LeashReentryBudget;
};

function echoLeash(line: string): void {
  process.stderr.write(`${formatLiveLine(line)}\n`);
}

/** Re-enter via leash if this step landed on login. `blocked` means still gated. */
async function recoverExploreLeash(ctx: ExploreWalkCtx): Promise<{ blocked: boolean; error?: string }> {
  const pageId = ctx.view?.page ?? ctx.state.pageId;
  ctx.leash ??= { tries: 0 };
  const rec = await recoverLeashIfNeeded({
    pageId,
    href: liveHref(ctx.state),
    pages: ctx.state.model.pages,
    exec: ctx.exec,
    state: ctx.state,
    budget: ctx.leash,
    echo: echoLeash,
  });
  if (rec.attempted || rec.recovered) {
    try {
      ctx.view = withPriorLast(await snapshotView(ctx.state), ctx.view?.last);
    } catch {
      // tests without a live page keep the prior view
    }
    const seed = pickSeedPageId(ctx.state, ctx.state.pageId);
    if (seed) ctx.seedPageId = seed;
  }
  if (rec.gaveUp) {
    return { blocked: true, error: "logged out; leash re-entry failed" };
  }
  if (
    rec.attempted &&
    !rec.recovered &&
    needsLeashReentry(ctx.view?.page ?? pageId, liveHref(ctx.state), ctx.state.model.pages)
  ) {
    return { blocked: true, error: "logged out; retrying leash re-entry" };
  }
  return { blocked: false };
}

function flushOutline(ctx: Pick<ExploreWalkCtx, "outDir" | "charter" | "notes" | "goods" | "plan">, now?: string): void {
  const item = ctx.plan?.items.find((i) => i.status === "now");
  const nowLine = now ?? item?.title;
  setPresenceOutline(
    ctx.outDir,
    exploreOutlineOf({
      charter: ctx.charter,
      ...(nowLine ? { now: nowLine } : {}),
      notes: ctx.notes,
      goods: ctx.goods,
      plan: ctx.plan,
    }),
  );
}

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
  if (!ctx.view) {
    return {
      ok: false,
      error: "explore session has no snapshot",
      visit: formatExploreVisit({
        view: { page: ctx.state.pageId, surface: "page", stack: [ctx.state.pageId], shown: [], actions: [] },
      }),
    };
  }

  const gated = await recoverExploreLeash(ctx);
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
  if (gated.blocked) {
    return {
      ok: false,
      error: gated.error ?? "logged out; leash re-entry failed",
      ban: false,
      visit: exploreVisitOf(ctx.state, view, ctx.plan),
    };
  }

  const check = opts?.hostFinding
    ? { ok: true as const }
    : checkExploreLine(trimmed, view, {
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
  flushOutline(ctx, [currentItem?.title, note || trimmed].filter(Boolean).join(" — "));
  if (ctx.state.navLogPath) {
    logBrainDecide(ctx.state.navLogPath, { line: trimmed, note, good });
  }
  const mode = view.mode ?? detectWalkerMode({ view, stepsUsed: ctx.stepsUsed }).name;
  if (ctx.state.navMeta) ctx.state.navMeta.mode = mode;
  const onPage = view.page;

  const result = await ctx.exec.runLine(trimmed);
  if (
    !opts?.hostFinding &&
    mode !== "nav" &&
    lineMatchesMode(trimmed, mode, view, ctx.state.model.pages)
  ) {
    recordMode(ctx.state, onPage, mode);
  }
  if (opts?.severity && result.finding && result.finding.severity !== opts.severity) {
    result.finding = { ...result.finding, severity: opts.severity };
    const jsonPath = join(ctx.outDir, "findings", result.finding.id, "finding.json");
    if (existsSync(jsonPath)) writeFinding(jsonPath, result.finding);
  }
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
    ctx.view = withPriorLast(await snapshotView(ctx.state), result.view.last);
  }

  if (opts?.done && ctx.plan) {
    ctx.plan = completeCurrentPlanItem(ctx.plan, "done");
    const next = ctx.plan.items.find((i) => i.status === "now");
    flushOutline(ctx, next?.title || "plan complete");
  }

  await recoverExploreLeash(ctx);
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
  skills?: string;
  polish?: () => Promise<void>;
  onAfterStep?: ExploreAfterStep;
};

type ExploreRunner = (
  opts: { headed?: boolean; timeout?: number; storageState?: string },
  fn: (h: RunHandle) => Promise<void>,
) => Promise<unknown>;

/** First resolve/reject wins; later calls are no-ops. */
export function onceSettled<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let settled = false;
  let resolveFn!: (value: T) => void;
  let rejectFn!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return {
    promise,
    resolve(value) {
      if (settled) return;
      settled = true;
      resolveFn(value);
    },
    reject(reason) {
      if (settled) return;
      settled = true;
      rejectFn(reason);
    },
  };
}

export class ExploreSession {
  private ctx?: ExploreWalkCtx;
  private releaseRun?: () => void;
  private runDone?: Promise<void>;
  private visitGate?: ReturnType<typeof onceSettled<ExploreVisit>>;
  private closing = false;
  private heartbeat?: ReturnType<typeof setInterval>;

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

  get charter(): string | undefined {
    return this.ctx?.charter;
  }

  get notes(): string[] {
    return this.ctx?.notes ?? [];
  }

  get goods(): string[] {
    return this.ctx?.goods ?? [];
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

  get skills(): string | undefined {
    return this.ctx?.skills;
  }

  /** Live tape without finishing. Used by MCP `spec_save`. */
  tape(): { log: Log; logPath: string } {
    const ctx = this.requireWalk();
    return { log: this.snapshotLog(), logPath: ctx.logPath };
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
    /** Test seam; defaults to withRun. */
    run?: ExploreRunner;
  }): Promise<ExploreVisit> {
    if (this.ctx) await this.finish();
    else if (this.runDone) await this.abort();
    this.closing = false;
    const charter = opts.charter?.trim() || DEFAULT_EXPLORE_CHARTER;
    const visitGate = onceSettled<ExploreVisit>();
    this.visitGate = visitGate;
    let released = false;
    const untilRelease = new Promise<void>((res) => {
      this.releaseRun = () => {
        if (released) return;
        released = true;
        res();
      };
    });
    const run = opts.run ?? withRun;
    this.runDone = run({ headed: opts.headed, timeout: opts.timeout }, async (handle) => {
      try {
        if (this.closing) return;
        const state = await bootRun(handle, opts.config, opts.outDir, {
          configPath: opts.configPath,
          verbose: opts.verbose,
          brain: opts.brainName ?? "explore",
        });
        if (this.closing) return;
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
          ...(opts.skills?.trim() ? { skills: opts.skills.trim() } : {}),
        });
        if (this.closing) {
          this.stopHeartbeat();
          this.ctx = undefined;
          return;
        }
        this.startHeartbeat();
        const visit = await this.visit();
        visitGate.resolve(visit);
        await untilRelease;
      } catch (err) {
        this.stopHeartbeat();
        this.ctx = undefined;
        this.releaseRun?.();
        this.releaseRun = undefined;
        visitGate.reject(err);
        throw err;
      } finally {
        stopPresence(opts.outDir);
      }
    }).then(
      () => undefined,
      (err) => {
        this.stopHeartbeat();
        this.ctx = undefined;
        visitGate.reject(err);
      },
    );
    return visitGate.promise;
  }

  async snapshot(): Promise<View> {
    const ctx = this.requireWalk();
    ctx.view = withPriorLast(await snapshotView(ctx.state), ctx.view?.last);
    return ctx.view;
  }

  async visit(): Promise<ExploreVisit> {
    const ctx = this.requireWalk();
    const view = await this.snapshot();
    return exploreVisitOf(ctx.state, view, ctx.plan);
  }

  /** Mapped widgets including disabled Save. Compact visit stays the default. */
  async pageState(): Promise<string> {
    const ctx = this.requireWalk();
    const view = ctx.view ?? (await this.snapshot());
    return formatPageState(await snapshotPageState(ctx.state, view));
  }

  async step(line: string, opts?: ExploreStepOpts): Promise<ExploreStepResult> {
    const ctx = this.requireWalk();
    if (!ctx.view) ctx.view = await snapshotView(ctx.state);
    return applyExploreStep(ctx, line, opts);
  }

  setPlan(plan: UiExplorePlan): void {
    const ctx = this.requireWalk();
    ctx.plan = plan;
    flushOutline(ctx);
  }

  advancePlan(status: "done" | "skipped"): void {
    const ctx = this.requireWalk();
    if (!ctx.plan) return;
    ctx.plan = completeCurrentPlanItem(ctx.plan, status);
    const now = ctx.plan.items.find((i) => i.status === "now");
    flushOutline(ctx, now?.title || "plan complete");
  }

  addNote(text: string): void {
    const ctx = this.requireWalk();
    const note = usefulExploreNote(text);
    if (!note) return;
    ctx.notes.push(note);
    flushOutline(ctx);
  }

  addGood(text: string): void {
    const ctx = this.requireWalk();
    const good = usefulExploreNote(text);
    if (!good) return;
    ctx.goods.push(good);
    flushOutline(ctx);
  }

  async abort(): Promise<void> {
    this.closing = true;
    this.stopHeartbeat();
    this.visitGate?.reject(new Error("explore session aborted"));
    const outDir = this.ctx?.outDir;
    const done = this.runDone;
    this.releaseRun?.();
    this.releaseRun = undefined;
    this.ctx = undefined;
    this.runDone = undefined;
    this.visitGate = undefined;
    if (done) await done;
    if (outDir) stopPresence(outDir);
  }

  async finish(opts?: { notes?: string[]; goods?: string[] }): Promise<ExploreResult> {
    try {
      return this.flush(opts);
    } finally {
      await this.abort();
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
      ...(opts.skills ? { skills: opts.skills } : {}),
      polish: opts.polish,
      onAfterStep: opts.onAfterStep,
    };
  }

  private requireWalk(): ExploreWalkCtx {
    if (!this.ctx) throw new Error("explore session is not started");
    return this.ctx;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const ctx = this.ctx;
    if (!ctx) return;
    this.heartbeat = setInterval(() => {
      const live = this.ctx;
      if (!live) return;
      touchPresence(live.outDir, live.state.pageId);
    }, 5_000);
    this.heartbeat.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat === undefined) return;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  private snapshotLog(): Log {
    const ctx = this.ctx;
    return {
      schemaVersion: 1,
      comments: [],
      steps: [...(ctx?.state.log.steps ?? [])],
      usedLocators: { ...(ctx?.state.usedLocators ?? {}) },
      result: (ctx?.findings.length ?? 0) > 0 ? "failed" : "passed",
    };
  }

  private flush(opts?: { notes?: string[]; goods?: string[] }): ExploreResult {
    const ctx = this.ctx;
    const log = this.snapshotLog();
    const logPath = ctx?.logPath ?? "";
    const sessionPath = ctx?.sessionPath ?? "";
    if (ctx) {
      flushOutline({
        outDir: ctx.outDir,
        charter: ctx.charter,
        notes: opts?.notes ?? ctx.notes,
        goods: opts?.goods ?? ctx.goods,
        plan: ctx.plan,
      });
    }
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
        ...(ctx.skills ? { skills: ctx.skills } : {}),
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
