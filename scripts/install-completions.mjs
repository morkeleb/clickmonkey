#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "completions", "zsh", "_clickmonkey");
const home = homedir();
const dests = [
  join(home, ".grok", "completions", "zsh"),
  join(home, ".zfunc"),
  "/opt/homebrew/share/zsh/site-functions",
];

let installed = 0;
for (const dir of dests) {
  if (!existsSync(dir)) continue;
  try {
    copyFileSync(src, join(dir, "_clickmonkey"));
    process.stdout.write(`completion: ${join(dir, "_clickmonkey")}\n`);
    installed += 1;
  } catch {
    /* not writable */
  }
}

if (installed === 0) {
  const fallback = join(home, ".zfunc");
  mkdirSync(fallback, { recursive: true });
  copyFileSync(src, join(fallback, "_clickmonkey"));
  process.stdout.write(`completion: ${join(fallback, "_clickmonkey")}\n`);
  process.stdout.write("add to ~/.zshrc: fpath=($HOME/.zfunc $fpath) && autoload -U compinit && compinit\n");
}

const dumpDir = home;
try {
  for (const name of readdirSync(dumpDir)) {
    if (name === ".zcompdump" || name.startsWith(".zcompdump")) {
      unlinkSync(join(dumpDir, name));
    }
  }
} catch {
  /* ignore */
}

process.stdout.write("run: rehash   (or open a new terminal)\n");
process.stdout.write("complete with: click<TAB>   not cli<TAB> (that is clippy-driver)\n");
