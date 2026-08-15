import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { bootRun } from "../executor/boot.js";
import { createExecutor } from "../executor/run.js";
import { withRun } from "../executor/session.js";
import { buildView, formatView } from "../executor/view.js";
import { saveConfig } from "../persist/config.js";
import { writeLog, readLog } from "../persist/log.js";
import { emptyConfig } from "../schema/config.js";
import { formatLog, formatStep } from "../schema/dsl.js";
import { formatTestabilityLine } from "../surveyor/audit.js";
import { inspectAndSaveConfig } from "../surveyor/inspect.js";
import {
  compactLog,
  replayLog,
  ReplayLiveValidateError,
  runEmptyRequired,
  runExplore,
  runUnleash,
  EXPLORE_DEFAULT_MINUTES,
  EXPLORE_DEFAULT_STEPS,
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
}): Promise<number> {
  const configPath = resolveConfigPath(opts.config);
  const config = persistUrl(configPath, loadConfigOrExit(configPath), opts.url);
  const timeout = parseTimeout(opts.timeout);
  const outDir = resolveOutDir();
  try {
    await withRun({ headed: opts.headed, timeout }, async (handle) => {
      if (config.intro.length > 0) {
        const state = await bootRun(handle, config, outDir, { configPath });
        const exec = createExecutor(state);
        await exec.runIntro();
      } else {
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
}): Promise<number> {
  const configPath = resolveConfigPath(opts.config);
  const config = withUrl(loadConfigOrExit(configPath), opts.url);
  const timeout = parseTimeout(opts.timeout);
  const outDir = resolveOutDir();
  try {
    await withRun({ headed: opts.headed, timeout }, async (handle) => {
      const state = await bootRun(handle, config, outDir, { configPath });
      const exec = createExecutor(state);
      if (state.config.intro.length > 0) await exec.runIntro();
      const view = await buildView({
        page: state.page,
        pageId: state.pageId,
        surfaceStack: state.surfaceStack.length > 0 ? state.surfaceStack : [state.pageId],
        model: state.model,
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
  opts: { config?: string; url?: string; out?: string; headed?: boolean; timeout?: string },
): Promise<number> {
  if (!line) {
    printUsage("Usage: clickmonkey step '<line>' [--config] [--url] [--out]");
    return EXIT_USAGE;
  }
  const configPath = resolveConfigPath(opts.config);
  const config = withUrl(loadConfigOrExit(configPath), opts.url);
  const outDir = resolveOutDir(opts.out);
  mkdirSync(outDir, { recursive: true });
  const timeout = parseTimeout(opts.timeout);
  try {
    return await withRun({ headed: opts.headed, timeout }, async (handle) => {
      const state = await bootRun(handle, config, outDir, { configPath });
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
  opts: { config?: string; url?: string; out?: string; headed?: boolean; timeout?: string },
): Promise<number> {
  if (!name) {
    printUsage("Usage: clickmonkey playbook empty-required [--config] [--url] [--out]");
    return EXIT_USAGE;
  }
  if (name !== "empty-required") fail(EXIT_USAGE, `Unknown playbook: ${name}`);
  const configPath = resolveConfigPath(opts.config);
  const config = withUrl(loadConfigOrExit(configPath), opts.url);
  const outDir = resolveOutDir(opts.out);
  mkdirSync(outDir, { recursive: true });
  try {
    const result = await runEmptyRequired({
      config,
      configPath,
      outDir,
      headed: opts.headed,
      timeout: parseTimeout(opts.timeout),
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
}): Promise<number> {
  const configPath = resolveConfigPath(opts.config);
  const config = withUrl(loadConfigOrExit(configPath), opts.url);
  const outDir = resolveOutDir(opts.out);
  mkdirSync(outDir, { recursive: true });
  try {
    const result = await runUnleash({
      config,
      configPath,
      outDir,
      headed: opts.headed,
      timeout: parseTimeout(opts.timeout),
      steps: parseSteps(opts.steps, UNLEASH_CLI_STEPS),
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
  const outDir = resolveOutDir(opts.out);
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

export async function cmdReplay(
  logPath: string | undefined,
  opts: { config?: string; url?: string; out?: string; headed?: boolean; timeout?: string },
): Promise<number> {
  if (!logPath) {
    printUsage("Usage: clickmonkey replay <log> [--config] [--url] [--out]");
    return EXIT_USAGE;
  }
  const resolvedLog = resolve(process.cwd(), logPath);
  if (!existsSync(resolvedLog)) fail(EXIT_USAGE, `log not found: ${resolvedLog}`);
  const configPath = resolveConfigPath(opts.config);
  const outDir = resolveOutDir(opts.out);
  mkdirSync(outDir, { recursive: true });
  try {
    const config = withUrl(loadConfigOrExit(configPath), opts.url);
    const result = await replayLog({
      config,
      configPath,
      logPath: resolvedLog,
      outDir,
      headed: opts.headed,
      timeout: parseTimeout(opts.timeout),
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
