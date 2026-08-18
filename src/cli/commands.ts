import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { bootRun } from "../executor/boot.js";
import { attachOracles, createExecutor } from "../executor/run.js";
import { withRun } from "../executor/session.js";
import { buildView, formatView } from "../executor/view.js";
import { saveConfig } from "../persist/config.js";
import { writeLog, readLog } from "../persist/log.js";
import { loadQualityReport, qualityReportPath } from "../persist/quality.js";
import { collectFindingCases, listRuns, resolveRunDirs } from "../persist/runs.js";
import { loadTestabilityReport, testabilityReportPath } from "../persist/testability.js";
import { newRunId } from "../persist/run-id.js";
import { replaysDir, workspaceDir } from "../persist/workspace.js";
import { isFindingsReport } from "../reports/fences.js";
import { enrichWithBrain, renderFindingsReport } from "../reports/findings-report.js";
import { emptyConfig } from "../schema/config.js";
import { formatLog, formatStep } from "../schema/dsl.js";
import { formatTestabilityLine } from "../surveyor/audit.js";
import { inspectAndSaveConfig } from "../surveyor/inspect.js";
import { originOfHref } from "../surveyor/ready.js";
import {
  compactLog,
  replayLog,
  replayReport,
  formatReplayReport,
  ReplayLiveValidateError,
  runEmptyRequired,
  runExplore,
  runUnleash,
  EXPLORE_DEFAULT_MINUTES,
  EXPLORE_DEFAULT_STEPS,
  MAP_CLI_STEPS,
  UNLEASH_CLI_STEPS,
} from "../playbooks/index.js";
import {
  BRAIN_HELP,
  EXIT_FINDINGS,
  EXIT_LIVE,
  EXIT_OK,
  EXIT_USAGE,
  errMessage,
  fail,
  loadConfigOrExit,
  parseMinutes,
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
      });
      process.stdout.write(formatView(view));
    });
  } catch (err) {
    fail(EXIT_FINDINGS, errMessage(err));
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
    fail(EXIT_FINDINGS, errMessage(err));
  }
}

export async function cmdReport(opts: {
  config?: string;
  out?: string;
  runs?: string;
  all?: boolean;
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
      fail(EXIT_USAGE, errMessage(err));
    }
  }
  if (selectors.length === 0) fail(EXIT_USAGE, "no runs selected (use --all, --runs, or pick interactively)");
  let runDirs: string[];
  try {
    runDirs = resolveRunDirs(configPath, selectors);
  } catch (err) {
    fail(EXIT_USAGE, errMessage(err));
  }
  const cases = collectFindingCases(runDirs);
  const outPath = opts.out
    ? resolve(process.cwd(), opts.out)
    : resolve(workspaceDir(configPath), "findings.md");
  mkdirSync(dirname(outPath), { recursive: true });
  let summary: string | undefined;
  let extras: Map<string, { title?: string; expected?: string; actual?: string; why?: string }> | undefined;
  if (config.brain) {
    try {
      const enriched = await enrichWithBrain(cases, config);
      summary = enriched.summary || undefined;
      extras = enriched.extras;
    } catch (err) {
      process.stderr.write(`brain skipped: ${errMessage(err)}\n`);
    }
  }
  const markdown = renderFindingsReport(
    cases,
    {
      url: config.url,
      generatedAt: new Date().toISOString(),
      runIds: runDirs.map((d) => d.split(/[/\\]/).pop() ?? d),
      ...(config.brain?.model ? { brain: config.brain.model } : {}),
      testability: loadTestabilityReport(testabilityReportPath(configPath)),
      quality: loadQualityReport(qualityReportPath(configPath)),
    },
    outPath,
    extras,
    summary,
  );
  writeFileSync(outPath, markdown, "utf8");
  process.stdout.write(`${outPath}\n`);
  return cases.length > 0 ? EXIT_FINDINGS : EXIT_OK;
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

export async function cmdCompact(logPath: string | undefined, opts: { out?: string }): Promise<number> {
  if (!logPath) {
    printUsage("Usage: clickmonkey compact <log> [--out <file>]");
    return EXIT_USAGE;
  }
  const resolvedLog = resolve(process.cwd(), logPath);
  if (!existsSync(resolvedLog)) fail(EXIT_USAGE, `log not found: ${resolvedLog}`);
  try {
    const compacted = compactLog(readLog(resolvedLog));
    const text = formatLog(compacted);
    if (opts.out) writeFileSync(resolve(process.cwd(), opts.out), text, "utf8");
    else process.stdout.write(text);
    return EXIT_OK;
  } catch (err) {
    fail(EXIT_USAGE, errMessage(err));
  }
}
