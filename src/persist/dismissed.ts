import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DismissedLedger, type DismissedItem } from "../schema/dismissed.js";
import { idempotencyKeyOfFingerprint } from "./finding.js";
import { withFileLock } from "./lock.js";
import { ensureWorkspace, workspaceDir } from "./workspace.js";

export function dismissedPath(configPath: string): string {
  return join(workspaceDir(configPath), "dismissed.json");
}

export function loadDismissed(configPath: string): DismissedLedger {
  const path = dismissedPath(configPath);
  if (!existsSync(path)) return { schemaVersion: 1, items: [] };
  try {
    return DismissedLedger.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return { schemaVersion: 1, items: [] };
  }
}

function identityIk(opts: { idempotencyKey?: string; fingerprint?: string }): string | undefined {
  if (opts.idempotencyKey) return opts.idempotencyKey;
  if (opts.fingerprint) return idempotencyKeyOfFingerprint(opts.fingerprint);
  return undefined;
}

function identityKeys(item: {
  id: string;
  runId?: string;
  fingerprint?: string;
  idempotencyKey?: string;
}): string[] {
  const keys: string[] = [];
  const ik = identityIk(item);
  if (ik) keys.push(`ik:${ik}`);
  if (item.fingerprint) keys.push(`fp:${item.fingerprint}`);
  keys.push(`id:${item.id}\0${item.runId ?? ""}`);
  return keys;
}

export function isDismissed(
  ledger: DismissedLedger,
  opts: { id: string; runId?: string; fingerprint?: string; idempotencyKey?: string },
): boolean {
  const wantIk = identityIk(opts);
  for (const item of ledger.items) {
    const itemIk = identityIk(item);
    if (wantIk && itemIk && wantIk === itemIk) return true;
    if (opts.fingerprint && item.fingerprint === opts.fingerprint) return true;
    if (opts.runId && item.runId === opts.runId && item.id === opts.id) return true;
  }
  return false;
}

export function appendDismissed(configPath: string, added: DismissedItem[]): DismissedLedger {
  ensureWorkspace(configPath);
  const path = dismissedPath(configPath);
  return withFileLock(path, () => {
    const ledger = loadDismissed(configPath);
    const seen = new Set(ledger.items.flatMap(identityKeys));
    for (const item of added) {
      const keys = identityKeys(item);
      if (keys.some((k) => seen.has(k))) continue;
      for (const k of keys) seen.add(k);
      ledger.items.push(item);
    }
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    renameSync(tmp, path);
    return ledger;
  });
}
