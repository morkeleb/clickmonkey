#!/usr/bin/env node
import { parseArgs } from "node:util";
import { version } from "../index.js";
import {
  cmdBundle,
  cmdCompact,
  cmdExplore,
  cmdFog,
  cmdInit,
  cmdInspect,
  cmdMap,
  cmdMcp,
  cmdPlaybook,
  cmdPrune,
  cmdReport,
  cmdReplay,
  cmdSpec,
  cmdStep,
  cmdUi,
  cmdUnleash,
  cmdView,
} from "./commands.js";
import { cmdEmit } from "./cmd-emit.js";
import { EXIT_USAGE, printUsage, USAGE } from "./common.js";

try {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: false,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      url: { type: "string" },
      config: { type: "string" },
      headed: { type: "boolean" },
      verbose: { type: "boolean" },
      timeout: { type: "string" },
      out: { type: "string" },
      steps: { type: "string" },
      nasty: { type: "boolean" },
      charter: { type: "string" },
      skills: { type: "string" },
      minutes: { type: "string" },
      runs: { type: "string" },
      all: { type: "boolean" },
      "quality-full": { type: "boolean" },
      port: { type: "string" },
      "no-open": { type: "boolean" },
      stop: { type: "boolean" },
      check: { type: "boolean" },
      "fail-on-findings": { type: "boolean" },
      ids: { type: "string" },
      reset: { type: "boolean" },
      job: { type: "string" },
      form: { type: "string" },
    },
  });

  if (values.version) {
    process.stdout.write(`${version}\n`);
    process.exit(0);
  }

  const command = positionals[0];
  if (!command || values.help) {
    printUsage();
    process.exit(command && values.help ? 0 : 2);
  }

  const flags = {
    url: typeof values.url === "string" ? values.url : undefined,
    config: typeof values.config === "string" ? values.config : undefined,
    headed: Boolean(values.headed),
    verbose: Boolean(values.verbose),
    timeout: typeof values.timeout === "string" ? values.timeout : undefined,
    out: typeof values.out === "string" ? values.out : undefined,
    steps: typeof values.steps === "string" ? values.steps : undefined,
    nasty: Boolean(values.nasty),
    charter: typeof values.charter === "string" ? values.charter : undefined,
    skills: typeof values.skills === "string" ? values.skills : undefined,
    minutes: typeof values.minutes === "string" ? values.minutes : undefined,
    runs: typeof values.runs === "string" ? values.runs : undefined,
    all: Boolean(values.all),
    qualityFull: Boolean(values["quality-full"]),
    port: typeof values.port === "string" ? values.port : undefined,
    noOpen: Boolean(values["no-open"]),
    stop: Boolean(values.stop),
    check: Boolean(values.check),
    failOnFindings: Boolean(values["fail-on-findings"]),
    ids: typeof values.ids === "string" ? values.ids : undefined,
    reset: Boolean(values.reset),
    job: typeof values.job === "string" ? values.job : undefined,
    form: typeof values.form === "string" ? values.form : undefined,
  };

  const run = async (): Promise<number> => {
    switch (command) {
      case "init":
        return cmdInit(flags);
      case "inspect":
        return cmdInspect(flags);
      case "view":
        return cmdView(flags);
      case "step":
        return cmdStep(positionals[1], flags);
      case "playbook":
        return cmdPlaybook(positionals[1], flags);
      case "map":
        return cmdMap(flags);
      case "unleash":
        return cmdUnleash(flags);
      case "nasty":
        return cmdUnleash({ ...flags, nasty: true });
      case "explore":
        return cmdExplore(flags);
      case "mcp":
        return cmdMcp(flags);
      case "fog":
        return cmdFog(flags);
      case "report":
        return cmdReport(flags);
      case "prune":
        return cmdPrune(positionals[1], flags);
      case "replay":
        return cmdReplay(positionals[1], flags);
      case "spec":
        return cmdSpec(positionals[1], flags);
      case "emit":
        return cmdEmit(flags);
      case "compact":
        return cmdCompact(positionals[1], { out: flags.out });
      case "bundle":
        return cmdBundle(flags);
      case "ui":
        return cmdUi(flags);
      default:
        process.stdout.write(USAGE);
        process.stderr.write(`Unknown command: ${command}\n`);
        return EXIT_USAGE;
    }
  };

  process.exit(await run());
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
