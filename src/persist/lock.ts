import { closeSync, openSync, statSync, unlinkSync } from "node:fs";

const STALE_MS = 30_000;
const RETRIES = 80;
const WAIT_MS = 25;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tryLock(lockPath: string): number | undefined {
  try {
    return openSync(lockPath, "wx");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw err;
    try {
      const age = Date.now() - statSync(lockPath).mtimeMs;
      if (age > STALE_MS) unlinkSync(lockPath);
    } catch {
      /* lock vanished */
    }
    return undefined;
  }
}

/** Exclusive lock next to `targetPath` so parallel monkeys can read-merge-write the map. */
export function withFileLock<T>(targetPath: string, fn: () => T): T {
  const lockPath = `${targetPath}.lock`;
  for (let i = 0; i < RETRIES; i++) {
    const fd = tryLock(lockPath);
    if (fd === undefined) {
      sleepSync(WAIT_MS);
      continue;
    }
    try {
      return fn();
    } finally {
      closeSync(fd);
      try {
        unlinkSync(lockPath);
      } catch {
        /* already gone */
      }
    }
  }
  throw new Error(`timed out locking ${targetPath}`);
}
