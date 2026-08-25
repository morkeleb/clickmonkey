import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { bootRun } from "../executor/boot.js";
import { attachOracles, createExecutor } from "../executor/run.js";
import { withRun } from "../executor/session.js";
import { buildView, formatView } from "../executor/view.js";
import { saveConfig } from "../persist/config.js";
import { formatFogStatus, resetFog } from "../persist/fog.js";
import { writeLog, readLog } from "../persist/log.js";
import { stopPresence } from "../persist/presence.js";
import { appendDismissed } from "../persist/dismissed.js";
import { listReports, readReport, reportMarkdownPath, rewriteReportMarkdown } from "../persist/reports.js";
import { collectFindingCases, listRuns, resolveRunDirs } from "../persist/runs.js";
import { newRunId } from "../persist/run-id.js";
import { mapPath, replaysDir, workspaceDir } from "../persist/workspace.js";
import { writeBundle } from "../ui/bundle.js";
import { isFindingsReport } from "../reports/fences.js";
import { findingFingerprint, renderFindingsReport, writeRunsReport } from "../reports/findings-report.js";
import { dropReportFindings, parseReportFindings, suggestFalsePositives } from "../reports/prune.js";
import { emptyConfig, requirePageModel, requireVisionShots, resolveVision, VisionError } from "../schema/config.js";
import { WalkerJobName } from "../schema/fog.js";
import { formatLog, formatStep } from "../schema/dsl.js";
import { formatTestabilityLine } from "../surveyor/audit.js";
import { inspectAndSaveConfig } from "../surveyor/inspect.js";
import { originOfHref } from "../surveyor/ready.js";
import {
  compactLog,
  hoppedStepIndexes,
  replayLog,
  replayReport,
  formatReplayReport,
  ReplayLiveValidateError,
  runEmptyRequired,
  runExplore,
  ExploreError,
  runUnleash,
  listSpecFiles,
  checkSpecFile,
  formatCheckReport,
  runSpecs,
  formatSpecTable,
  shouldFailOnFindings,
  EXPLORE_DEFAULT_MINUTES,
  EXPLORE_DEFAULT_STEPS,
  MAP_CLI_STEPS,
  UNLEASH_CLI_STEPS,
} from "../playbooks/index.js";
import { startUiServer } from "../ui/server.js";
import { readUiPid, stopUi } from "../ui/pid.js";
import { runMcp } from "../mcp/server.js";
import {
  BRAIN_HELP,
  VISION_HELP,
  EXIT_FINDINGS,
  EXIT_LIVE,
  EXIT_OK,
  EXIT_USAGE,
  errMessage,
  fail,
  loadConfigOrExit,
  parseMinutes,
  parsePort,
  parseSteps,
  parseTimeout,
  persistUrl,
  printUsage,
  resolveConfigPath,
  resolveOutDir,
  withUrl,
} from "./common.js";

export async function cmdInit(opts: { url?: string; config?: string }): Promise<number> {
  const path = resolveConfigPath(opts.config);
  if (existsSync(path)) {
    process.stdout.write(`monkey settings already exists: ${path}\n`);
    return EXIT_OK;
  }
  const url = opts.url ?? "http://127.0.0.1:4173/";
  try {
    saveConfig(path, emptyConfig(url));
  } catch (err) {
    fail(EXIT_USAGE, errMessage(err));
  }
  process.stdout.write(`${path}\n`);
  return EXIT_OK;
}

export async function cmdInspect(opts: {
  config?: string;
  url?: string;
  headed?: boolean;
  timeout?: string;
  verbose?: boolean;
}): Promise<number> {
  const configPath = resolveConfigPath(opts.config);
  const config = persistUrl(configPath, loadConfigOrExit(configPath), opts.url);
  const timeout = parseTimeout(opts.timeout);
  const outDir = resolveOutDir(undefined, configPath);
  try {
    await withRun({ headed: opts.headed, timeout }, async (handle) => {
      if (config.intro.length > 0) {
        const state = await bootRun(handle, config, outDir, {
          configPath,
          verbose: opts.verbose,
          brain: "inspect",
        });
        const exec = createExecutor(state);
        await exec.runIntro();
      } else {
        attachOracles({
          page: handle.page,
          pendingFindings: [],
          configPath,
          appOrigin: originOfHref(config.url),
        });
        await handle.page.goto(config.url, { waitUntil: "domcontentloaded" });
      }
      const result = await inspectAndSaveConfig(handle.page, configPath);
      const surfaceIds =
        result.model.pages.find((p) => p.id === result.pageId)?.surfaces.map((s) => s.id) ?? [];
      process.stdout.write(`pageId: ${result.pageId}\n`);
      process.stdout.write(`surfaces: ${surfaceIds.join(", ")}\n`);
      process.stdout.write(
        formatTestabilityLine(result.testability.issues, result.testability.insufficient),
      );
    });
  } catch (err) {
    fail(EXIT_FINDINGS, errMessage(err));
  } finally {
    stopPresence(outDir);
  }
  return EXIT_OK;
}

export async function cmdView(opts: {
  config?: string;
  url?: string;
  headed?: boolean;
  timeout?: string;
  verbose?: boolean;
}): Promise<number> {
  const configPath = resolveConfigPath(opts.config);
  const config = withUrl(loadConfigOrExit(configPath), opts.url);
  const timeout = parseTimeout(opts.timeout);
  const outDir = resolveOutDir(undefined, configPath);
  try {
    await withRun({ headed: opts.headed, timeout }, async (handle) => {
      const state = await bootRun(handle, config, outDir, {
        configPath,
        verbose: opts.verbose,
        brain: "view",
      });
      const exec = createExecutor(state);
      if (state.config.intro.length > 0) await exec.runIntro();
      const view = await buildView({
        page: state.page,
        pageId: state.pageId,
        surfaceStack: state.surfaceStack.length > 0 ? state.surfaceStack : [state.pageId],
        model: state.model,
        appUrl: state.config.url,
        fence: state.config.fence,
        intro: state.config.intro,
        skip: state.config.skip,
        inIntro: Boolean(state.inIntro),
        ...(configPath ? { configPath } : {}),
      });
      process.stdout.write(formatView(view));
    });
  } catch (err) {
    fail(EXIT_FINDINGS, errMessage(err));
  } finally {
    stopPresence(outDir);
  }
  return EXIT_OK;
}

export async function cmdStep(
  line: string | undefined,
  opts: {
    config?: string;
    url?: string;
    out?: string;
    headed?: boolean;
    timeout?: string;
    verbose?: boolean;
  },
): Promise<number> {
  if (!line) {
    printUsage("Usage: clickmonkey step '<line>' [--config] [--url] [--out]");
    return EXIT_USAGE;
  }
  const configPath = resolveConfigPath(opts.config);
  const config = withUrl(loadConfigOrExit(configPath), opts.url);
  const outDir = resolveOutDir(opts.out, configPath);
  mkdirSync(outDir, { recursive: true });
  const timeout = parseTimeout(opts.timeout);
  try {
    return await withRun({ headed: opts.headed, timeout }, async (handle) => {
      const state = await bootRun(handle, config, outDir, {
        configPath,
        verbose: opts.verbose,
        brain: "step",
      });
      const exec = createExecutor(state);
      if (state.config.intro.length > 0) await exec.runIntro();
      const result = await exec.runLine(line);
      appendFileSync(resolve(outDir, "log.txt"), `${formatStep(result.step)}\n`);
      process.stdout.write(formatView(result.view));
      if (result.finding) {
        writeLog(resolve(outDir, "replay.log"), {
          schemaVersion: 1,
          bug: result.finding.message,
          found: new Date().toISOString(),
          comments: [],
          steps: state.log.steps,
          usedLocators: { ...state.usedLocators },
          result: "failed",
        });
        return EXIT_FINDINGS;
      }
      return EXIT_OK;
    });
  } catch (err) {
    fail(EXIT_USAGE, errMessage(err));
  } finally {
    stopPresence(outDir);
  }
}

export async function cmdPlaybook(
  name: string | undefined,
  opts: {
    config?: string;
    url?: string;
    out?: string;
    headed?: boolean;
    timeout?: string;
    verbose?: boolean;
  },
): Promise<number> {
  if (!name) {
    printUsage("Usage: clickmonkey playbook empty-required [--config] [--url] [--out]");
    return EXIT_USAGE;
  }
  if (name !== "empty-required") fail(EXIT_USAGE, `Unknown playbook: ${name}`);
  const configPath = resolveConfigPath(opts.config);
  const config = withUrl(loadConfigOrExit(configPath), opts.url);
  const outDir = resolveOutDir(opts.out, configPath);
  mkdirSync(outDir, { recursive: true });
  try {
    const result = await runEmptyRequired({
      config,
      configPath,
      outDir,
      headed: opts.headed,
      timeout: parseTimeout(opts.timeout),
      verbose: opts.verbose,
    });
    process.stdout.write(`${result.logPath}\n`);
    if (result.findings[0]) {
      process.stderr.write(`${result.findings[0].kind}: ${result.findings[0].message}\n`);
    }
    return result.ok ? EXIT_OK : EXIT_FINDINGS;
  } catch (err) {
    fail(EXIT_FINDINGS, errMessage(err));
  }
}

export async function cmdMap(opts: {
  config?: string;
  url?: string;
  out?: string;
  headed?: boolean;
  timeout?: string;
  steps?: string;
  verbose?: boolean;
}): Promise<number> {
  const configPath = resolveConfigPath(opts.config);
  const config = withUrl(loadConfigOrExit(configPath), opts.url);
  if (config.vision) {
    try {
      resolveVision(config.vision, config.brain);
      requireVisionShots(config);
    } catch (err) {
      process.stderr.write(VISION_HELP);
      fail(EXIT_USAGE, errMessage(err));
    }
  }
  const outDir = resolveOutDir(opts.out, configPath);
  mkdirSync(outDir, { recursive: true });
  try {
    const result = await runUnleash({
      config,
      configPath,
      outDir,
      headed: opts.headed,
      timeout: parseTimeout(opts.timeout),
      steps: parseSteps(opts.steps, MAP_CLI_STEPS),
      mode: "navigate",
      verbose: opts.verbose,
    });
    process.stdout.write(`${result.logPath}\n`);
    if (result.findings[0]) {
      process.stderr.write(`${result.findings[0].kind}: ${result.findings[0].message}\n`);
    }
    return result.ok ? EXIT_OK : EXIT_FINDINGS;
  } catch (err) {
    if (err instanceof VisionError) {
      process.stderr.write(VISION_HELP);
      fail(EXIT_USAGE, err.message);
    }
    fail(EXIT_FINDINGS, errMessage(err));
  }
}

export async function cmdUnleash(opts: {
  config?: string;
  url?: string;
  out?: string;
  headed?: boolean;
  timeout?: string;
  steps?: string;
  nasty?: boolean;
  verbose?: boolean;
}): Promise<number> {
  const configPath = resolveConfigPath(opts.config);
  const config = withUrl(loadConfigOrExit(configPath), opts.url);
  if (config.vision) {
    try {
      resolveVision(config.vision, config.brain);
      requireVisionShots(config);
    } catch (err) {
      process.stderr.write(VISION_HELP);
      fail(EXIT_USAGE, errMessage(err));
    }
  }
  const outDir = resolveOutDir(opts.out, configPath);
  mkdirSync(outDir, { recursive: true });
  try {
    const result = await runUnleash({
      config,
      configPath,
      outDir,
      headed: opts.headed,
      timeout: parseTimeout(opts.timeout),
      steps: parseSteps(opts.steps, UNLEASH_CLI_STEPS),
      nasty: opts.nasty,
      verbose: opts.verbose,
    });
    process.stdout.write(`${result.logPath}\n`);
    if (result.findings[0]) {
      process.stderr.write(`${result.findings[0].kind}: ${result.findings[0].message}\n`);
    }
    return result.ok ? EXIT_OK : EXIT_FINDINGS;
  } catch (err) {
    if (err instanceof VisionError) {
      process.stderr.write(VISION_HELP);
      fail(EXIT_USAGE, err.message);
    }
    fail(EXIT_FINDINGS, errMessage(err));
  }
}

export async function cmdExplore(opts: {
  config?: string;
  url?: string;
  out?: string;
  headed?: boolean;
  timeout?: string;
  steps?: string;
  minutes?: string;
  charter?: string;
  skills?: string;
  verbose?: boolean;
}): Promise<number> {
  const configPath = resolveConfigPath(opts.config);
  const config = withUrl(loadConfigOrExit(configPath), opts.url);
  if (!config.brain) {
    process.stderr.write(BRAIN_HELP);
    return EXIT_USAGE;
  }
  if (config.vision) {
    try {
      resolveVision(config.vision, config.brain);
      requireVisionShots(config);
    } catch (err) {
      process.stderr.write(VISION_HELP);
      fail(EXIT_USAGE, errMessage(err));
    }
  }
  let skills: string | undefined;
  if (opts.skills) {
    const path = resolve(process.cwd(), opts.skills);
    if (!existsSync(path)) fail(EXIT_USAGE, `skills not found: ${path}`);
    skills = readFileSync(path, "utf8");
  }
  const outDir = resolveOutDir(opts.out, configPath);
  mkdirSync(outDir, { recursive: true });
  try {
    const result = await runExplore({
      config,
      configPath,
      outDir,
      headed: opts.headed,
      timeout: parseTimeout(opts.timeout),
      steps: parseSteps(opts.steps, EXPLORE_DEFAULT_STEPS),
      minutes: parseMinutes(opts.minutes, EXPLORE_DEFAULT_MINUTES),
      charter: opts.charter,
      skills,
      verbose: opts.verbose,
    });
    process.stdout.write(`${result.logPath}\n`);
    if (result.findings[0]) {
      process.stderr.write(`${result.findings[0].kind}: ${result.findings[0].message}\n`);
    }
    return result.ok ? EXIT_OK : EXIT_FINDINGS;
  } catch (err) {
    if (err instanceof ExploreError) fail(EXIT_USAGE, err.message);
    fail(EXIT_FINDINGS, errMessage(err));
  }
}

export async function cmdReport(opts: {
  config?: string;
  out?: string;
  runs?: string;
  all?: boolean;
  qualityFull?: boolean;
}): Promise<number> {
  const configPath = resolveConfigPath(opts.config);
  const config = loadConfigOrExit(configPath);
  const listed = listRuns(configPath);
  let selectors: string[];
  if (opts.runs) {
    selectors = opts.runs.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (opts.all) {
    selectors = listed.filter((r) => r.findingCount > 0).map((r) => r.id);
  } else {
    const { promptRuns } = await import("./prompt-runs.js");
    try {
      selectors = await promptRuns(listed);
    } catch (err) {
      if (err instanceof Error && err.name === "ExitPromptError") return 130;
      fail(EXIT_USAGE, errMessage(err));
    }
  }
  if (selectors.length === 0) fail(EXIT_USAGE, "no runs selected (use --all, --runs, or pick interactively)");
  let qualityFull = Boolean(opts.qualityFull);
  if (!qualityFull) {
    const { promptQualityFull } = await import("./prompt-runs.js");
    try {
      qualityFull = await promptQualityFull();
    } catch (err) {
      if (err instanceof Error && err.name === "ExitPromptError") return 130;
      fail(EXIT_USAGE, errMessage(err));
    }
  }
  let runDirs: string[];
  try {
    runDirs = resolveRunDirs(configPath, selectors);
  } catch (err) {
    fail(EXIT_USAGE, errMessage(err));
  }
  const written = await writeRunsReport({
    configPath,
    config,
    runDirs,
    qualityFull,
    onBrainError: (message) => process.stderr.write(`brain skipped: ${message}\n`),
  });
  if (opts.out) {
    const extra = resolve(process.cwd(), opts.out);
    mkdirSync(dirname(extra), { recursive: true });
    writeFileSync(
      extra,
      renderFindingsReport(written.cases, written.meta, extra, written.extras, written.summary),
      "utf8",
    );
    process.stdout.write(`${extra}\n`);
    process.stderr.write(`also wrote ${written.mdPath}\n`);
  } else {
    process.stdout.write(`${written.mdPath}\n`);
  }
  return written.caseCount > 0 ? EXIT_FINDINGS : EXIT_OK;
}

export async function cmdPrune(
  reportId: string | undefined,
  opts: { config?: string; ids?: string },
): Promise<number> {
  const configPath = resolveConfigPath(opts.config);
  const config = loadConfigOrExit(configPath);
  const reports = listReports(configPath);
  if (reports.length === 0) fail(EXIT_USAGE, "no reports yet (run clickmonkey report)");
  let id = reportId?.trim();
  if (!id) {
    const { promptReport } = await import("./prompt-prune.js");
    try {
      id = await promptReport(reports);
    } catch (err) {
      if (err instanceof Error && err.name === "ExitPromptError") return 130;
      fail(EXIT_USAGE, errMessage(err));
    }
  }
  if (!id) fail(EXIT_USAGE, "no report selected");
  const loaded = readReport(configPath, id);
  if (!loaded) fail(EXIT_USAGE, `report not found: ${id}`);
  const findings = parseReportFindings(loaded.markdown);
  if (findings.length === 0) fail(EXIT_USAGE, `report ${id} has no findings to prune`);
  let dropIds: string[];
  if (opts.ids) {
    dropIds = opts.ids.split(",").map((s) => s.trim()).filter(Boolean);
  } else {
    let suggested = new Map<string, string>();
    if (config.brain?.baseUrl && config.brain.model) {
      process.stderr.write("Looking over the report…\n");
      try {
        suggested = await suggestFalsePositives(findings, loaded.markdown, config);
      } catch (err) {
        process.stderr.write(`brain skipped: ${errMessage(err)}\n`);
      }
    }
    const { promptFalsePositives } = await import("./prompt-prune.js");
    try {
      dropIds = await promptFalsePositives(findings, suggested);
    } catch (err) {
      if (err instanceof Error && err.name === "ExitPromptError") return 130;
      fail(EXIT_USAGE, errMessage(err));
    }
  }
  if (dropIds.length === 0) {
    process.stdout.write("no findings dropped\n");
    return EXIT_OK;
  }
  const { markdown, dropped, kept } = dropReportFindings(loaded.markdown, dropIds);
  if (dropped.length === 0) fail(EXIT_USAGE, "none of those ids are in the report");
  const mdPath = reportMarkdownPath(configPath, id);
  if (!mdPath) fail(EXIT_USAGE, `report not found: ${id}`);
  const rewritten = rewriteReportMarkdown(configPath, id, markdown, kept.length);
  if (!rewritten) writeFileSync(mdPath, markdown, "utf8");
  const casesById = new Map<string, string>();
  try {
    const runDirs = resolveRunDirs(configPath, loaded.meta.runIds);
    for (const c of collectFindingCases(runDirs, { tapes: false })) {
      casesById.set(`${c.runId}/${c.id}`, findingFingerprint(c));
    }
  } catch {
    // run folders may be gone; still dismiss by id
  }
  const now = new Date().toISOString();
  appendDismissed(
    configPath,
    dropped.flatMap((f) =>
      f.ids.map((findingId, i) => {
        const runId = f.runIds[i] ?? f.runIds[0];
        const fingerprint = runId ? casesById.get(`${runId}/${findingId}`) : undefined;
        return {
          dismissedAt: now,
          id: findingId,
          reportId: id,
          kind: f.kind,
          title: f.title,
          ...(runId ? { runId } : {}),
          ...(fingerprint ? { fingerprint } : {}),
        };
      }),
    ),
  );
  process.stdout.write(`${rewritten?.mdPath ?? mdPath}\n`);
  process.stderr.write(`dropped ${dropped.length} finding${dropped.length === 1 ? "" : "s"}\n`);
  return kept.length > 0 ? EXIT_FINDINGS : EXIT_OK;
}

export async function cmdSpec(
  file: string | undefined,
  opts: {
    config?: string;
    url?: string;
    out?: string;
    headed?: boolean;
    timeout?: string;
    verbose?: boolean;
    check?: boolean;
    failOnFindings?: boolean;
  },
): Promise<number> {
  const configPath = resolveConfigPath(opts.config);
  const config = opts.check
    ? loadConfigOrExit(configPath)
    : withUrl(loadConfigOrExit(configPath), opts.url);
  const files = listSpecFiles(configPath, file);
  if (files.length === 0) {
    fail(EXIT_USAGE, file ? `spec not found: ${file}` : "no spec files under clickmonkey/specs/");
  }
  if (config.map.pages.length === 0) fail(EXIT_USAGE, "map has no pages (run inspect)");
  if (opts.check) {
    try {
      const model = requirePageModel(config.map);
      const results = files.map((filePath) => checkSpecFile(model, filePath));
      process.stdout.write(formatCheckReport(results));
      const missed = results.some((r) => r.cases.some((c) => c.missing.length > 0));
      return missed ? EXIT_FINDINGS : EXIT_OK;
    } catch (err) {
      fail(EXIT_USAGE, errMessage(err));
    }
  }
  const outDir = resolveOutDir(opts.out, configPath);
  mkdirSync(outDir, { recursive: true });
  try {
    const result = await runSpecs({
      config,
      configPath,
      outDir,
      files,
      headed: opts.headed,
      timeout: parseTimeout(opts.timeout),
      verbose: opts.verbose,
    });
    process.stdout.write(formatSpecTable(result.cases));
    const failFindings = shouldFailOnFindings(result.ok, result.findingErrors, Boolean(opts.failOnFindings));
    if (failFindings) {
      process.stdout.write(`FAIL --fail-on-findings (${result.findingErrors} errors)\n`);
    }
    process.stdout.write(`${result.mdPath}\n`);
    return result.ok && !failFindings ? EXIT_OK : EXIT_FINDINGS;
  } catch (err) {
    fail(EXIT_FINDINGS, errMessage(err));
  }
}

export async function cmdReplay(
  logPath: string | undefined,
  opts: {
    config?: string;
    url?: string;
    out?: string;
    headed?: boolean;
    timeout?: string;
    verbose?: boolean;
  },
): Promise<number> {
  if (!logPath) {
    printUsage("Usage: clickmonkey replay <log|report.md> [--config] [--url] [--out]");
    return EXIT_USAGE;
  }
  const resolvedLog = resolve(process.cwd(), logPath);
  if (!existsSync(resolvedLog)) fail(EXIT_USAGE, `log not found: ${resolvedLog}`);
  const configPath = resolveConfigPath(opts.config);
  const text = readFileSync(resolvedLog, "utf8");
  try {
    const config = withUrl(loadConfigOrExit(configPath), opts.url);
    if (isFindingsReport(text)) {
      const outDir = opts.out
        ? resolve(process.cwd(), opts.out)
        : resolve(replaysDir(configPath), newRunId());
      mkdirSync(outDir, { recursive: true });
      const result = await replayReport({
        markdown: text,
        reportPath: resolvedLog,
        config,
        configPath,
        outDir,
        headed: opts.headed,
        timeout: parseTimeout(opts.timeout),
      });
      process.stdout.write(formatReplayReport(result));
      return result.ok ? EXIT_OK : EXIT_FINDINGS;
    }
    const outDir = resolveOutDir(opts.out, configPath);
    mkdirSync(outDir, { recursive: true });
    const result = await replayLog({
      config,
      configPath,
      logPath: resolvedLog,
      outDir,
      headed: opts.headed,
      timeout: parseTimeout(opts.timeout),
      verbose: opts.verbose,
    });
    if (result.reproduced) {
      process.stderr.write(`reproduced ${result.reproduced.kind} at step ${result.reproduced.stepIndex}\n`);
    } else if (result.findings[0]) {
      process.stderr.write(`${result.findings[0].kind}: ${result.findings[0].message}\n`);
    }
    return result.ok ? EXIT_OK : EXIT_FINDINGS;
  } catch (err) {
    if (err instanceof ReplayLiveValidateError) fail(EXIT_LIVE, err.message);
    fail(EXIT_USAGE, errMessage(err));
  }
}

export async function cmdBundle(opts: { config?: string; out?: string }): Promise<number> {
  const configPath = resolveConfigPath(opts.config);
  loadConfigOrExit(configPath);
  const outDir = opts.out
    ? resolve(process.cwd(), opts.out)
    : resolve(workspaceDir(configPath), "bundle");
  try {
    const written = writeBundle(configPath, outDir);
    process.stdout.write(`${written.outDir}\n`);
    return EXIT_OK;
  } catch (err) {
    fail(EXIT_USAGE, errMessage(err));
  }
}

export async function cmdMcp(opts: { config?: string }): Promise<number> {
  await runMcp({ config: opts.config });
  return EXIT_OK;
}

export async function cmdFog(opts: {
  config?: string;
  reset?: boolean;
  job?: string;
}): Promise<number> {
  const configPath = resolveConfigPath(opts.config);
  const config = loadConfigOrExit(configPath);
  let job: WalkerJobName | undefined;
  if (opts.job !== undefined) {
    const parsed = WalkerJobName.safeParse(opts.job);
    if (!parsed.success) fail(EXIT_USAGE, `invalid --job ${opts.job} (map|unleash|nasty)`);
    job = parsed.data;
  }
  if (job && !opts.reset) fail(EXIT_USAGE, "--job is only valid with --reset");
  if (opts.reset) {
    const n = config.map.pages.length;
    resetFog(configPath, job);
    const noun = n === 1 ? "page" : "pages";
    const who = job ? `${job} on ${n} ${noun}` : `${n} ${noun}`;
    process.stdout.write(`reset ${who} in ${mapPath(configPath)}\n`);
    return EXIT_OK;
  }
  process.stdout.write(formatFogStatus(config.map, mapPath(configPath)));
  return EXIT_OK;
}

export async function cmdUi(opts: {
  config?: string;
  port?: string;
  noOpen?: boolean;
  stop?: boolean;
}): Promise<number> {
  const configPath = resolveConfigPath(opts.config);
  if (opts.stop) {
    const fromFile = existsSync(configPath) ? readUiPid(configPath) : undefined;
    const port = opts.port !== undefined ? parsePort(opts.port) : (fromFile?.port ?? parsePort());
    const result = await stopUi({
      ...(existsSync(configPath) ? { configPath } : {}),
      port,
    });
    process.stdout.write(`${result.reason}\n`);
    return EXIT_OK;
  }
  loadConfigOrExit(configPath);
  const server = await startUiServer({
    configPath,
    port: parsePort(opts.port),
    open: !opts.noOpen,
  });
  await Promise.race([
    server.stopped,
    new Promise<void>((resolve) => {
      const stop = () => resolve();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    }),
  ]);
  await server.close();
  return EXIT_OK;
}

function compactOptsFor(logPath: string): { hopped: Set<number> } | undefined {
  const sibling = join(dirname(logPath), "nav.jsonl");
  if (!existsSync(sibling)) return undefined;
  return { hopped: hoppedStepIndexes(readFileSync(sibling, "utf8")) };
}

export async function cmdCompact(logPath: string | undefined, opts: { out?: string }): Promise<number> {
  if (!logPath) {
    printUsage("Usage: clickmonkey compact <log> [--out <file>]");
    return EXIT_USAGE;
  }
  const resolvedLog = resolve(process.cwd(), logPath);
  if (!existsSync(resolvedLog)) fail(EXIT_USAGE, `log not found: ${resolvedLog}`);
  try {
    const compacted = compactLog(readLog(resolvedLog), compactOptsFor(resolvedLog));
    const text = formatLog(compacted);
    if (opts.out) writeFileSync(resolve(process.cwd(), opts.out), text, "utf8");
    else process.stdout.write(text);
    return EXIT_OK;
  } catch (err) {
    fail(EXIT_USAGE, errMessage(err));
  }
}
