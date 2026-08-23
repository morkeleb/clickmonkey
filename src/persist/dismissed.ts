import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DismissedLedger, type DismissedItem } from "../schema/dismissed.js";
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

export function isDismissed(
  ledger: DismissedLedger,
  opts: { id: string; runId?: string; fingerprint?: string },
): boolean {
  for (const item of ledger.items) {
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
    const seen = new Set(ledger.items.map((i) => `${i.id}\0${i.fingerprint ?? ""}`));
    for (const item of added) {
      const key = `${item.id}\0${item.fingerprint ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ledger.items.push(item);
    }
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    renameSync(tmp, path);
    return ledger;
  });
}
