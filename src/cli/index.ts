#!/usr/bin/env node
import { parseArgs } from "node:util";
import { version } from "../index.js";

const USAGE = `clickmonkey ${version}

Usage:
  clickmonkey <command> [options]

Commands:
  init        Create clickmonkey.json (fence + empty intro + empty map)
  inspect     Survey the current page and grow the map
  view        Print the compact view of the current surface
  step        Run one DSL line and append it to the log
  playbook    Run a named playbook (empty-required)
  replay      Replay a log file (no brain)
  compact     Shorten a log to the last open + following lines

Run clickmonkey <command> --help for command options.
`;

function printUsage(): void {
  process.stdout.write(USAGE);
}

try {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: false,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
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

  printUsage();
  process.stderr.write(`Unknown command: ${command}\n`);
  process.exit(2);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
