import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FixedLedger, type FixedItem } from "../schema/fixed.js";
import { withFileLock } from "./lock.js";
import { ensureWorkspace, workspaceDir } from "./workspace.js";

export function fixedPath(configPath: string): string {
  return join(workspaceDir(configPath), "fixed.json");
}

export function loadFixed(configPath: string): FixedLedger {
  const path = fixedPath(configPath);
  if (!existsSync(path)) return { schemaVersion: 1, items: [] };
  try {
    return FixedLedger.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return { schemaVersion: 1, items: [] };
  }
}

function writeLedger(path: string, ledger: FixedLedger): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

/** True when replay confirmed the tape and no later walk refiled this `ik_`. */
export function isConfirmedFixed(
  ledger: FixedLedger,
  opts: { idempotencyKey: string; lastFiledRunId?: string },
): boolean {
  const item = ledger.items.find((i) => i.idempotencyKey === opts.idempotencyKey);
  if (!item) return false;
  if (item.lastRunId && opts.lastFiledRunId && opts.lastFiledRunId > item.lastRunId) return false;
  return true;
}

export function appendFixed(configPath: string, added: FixedItem[]): FixedLedger {
  ensureWorkspace(configPath);
  const path = fixedPath(configPath);
  return withFileLock(path, () => {
    const ledger = loadFixed(configPath);
    const byIk = new Map(ledger.items.map((i) => [i.idempotencyKey, i]));
    for (const item of added) {
      byIk.set(item.idempotencyKey, item);
    }
    ledger.items = [...byIk.values()];
    writeLedger(path, ledger);
    return ledger;
  });
}

export function removeFixed(configPath: string, keys: Iterable<string>): FixedLedger {
  ensureWorkspace(configPath);
  const path = fixedPath(configPath);
  const drop = new Set([...keys].filter(Boolean));
  return withFileLock(path, () => {
    const ledger = loadFixed(configPath);
    if (drop.size === 0) return ledger;
    ledger.items = ledger.items.filter((i) => !drop.has(i.idempotencyKey));
    writeLedger(path, ledger);
    return ledger;
  });
}
