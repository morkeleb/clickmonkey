import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  exploreOutlineOf,
  isPresenceLive,
  loadPresence,
  presencePath,
  reclaimMcpPresence,
  setPresenceOutline,
  startPresence,
  stopPresence,
  stopPresenceIfDead,
  touchPresence,
} from "../src/persist/presence.js";
import type { Presence } from "../src/schema/ui.js";

function writeDeadPid(dir: string, started: Presence): void {
  writeFileSync(
    presencePath(dir),
    `${JSON.stringify({ ...started, pid: 1_000_000_000, stoppedAt: null }, null, 2)}\n`,
  );
}

describe("presence", () => {
  it("starts, touches pageId, then stops", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-presence-"));
    try {
      const started = startPresence(dir, { pageId: "home", brain: "map" });
      assert.ok(started);
      assert.equal(started.pageId, "home");
      assert.equal(started.brain, "map");
      assert.equal(started.stoppedAt, null);
      assert.equal(isPresenceLive(started), true);
      const outlined = setPresenceOutline(
        dir,
        exploreOutlineOf({ charter: "walk invoices", now: "open invoices", notes: ["leave chrome"] }),
      );
      assert.equal(outlined?.outline?.charter, "walk invoices");
      assert.equal(outlined?.outline?.now, "open invoices");
      const touched = touchPresence(dir, "invoices");
      assert.equal(touched?.pageId, "invoices");
      assert.equal(touched?.outline?.now, "open invoices");
      const stopped = stopPresence(dir);
      assert.ok(stopped?.stoppedAt);
      assert.equal(stopped?.outline?.charter, "walk invoices");
      assert.equal(isPresenceLive(stopped), false);
    } finally {
      stopPresence(dir);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("gives concurrent runs hues far apart", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-presence-hues-"));
    try {
      const dirA = join(root, "run-a");
      const dirB = join(root, "run-b");
      const dirC = join(root, "run-c");
      mkdirSync(dirA);
      mkdirSync(dirB);
      mkdirSync(dirC);
      const a = startPresence(dirA, { pageId: "home" });
      const b = startPresence(dirB, { pageId: "home" });
      const c = startPresence(dirC, { pageId: "home" });
      assert.ok(a && b && c);
      const hues = [a.hue, b.hue, c.hue];
      assert.equal(new Set(hues).size, 3);
      const dist = (x: number, y: number) => {
        const d = Math.abs(x - y) % 360;
        return Math.min(d, 360 - d);
      };
      assert.ok(dist(a.hue, b.hue) >= 90);
      assert.ok(dist(a.hue, c.hue) >= 90);
      assert.ok(dist(b.hue, c.hue) >= 90);
      stopPresence(dirA);
      stopPresence(dirB);
      stopPresence(dirC);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is offline when the walker pid is gone, even if updatedAt is fresh", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-presence-dead-"));
    try {
      const started = startPresence(dir, { pageId: "home", brain: "mcp" });
      assert.ok(started);
      assert.equal(isPresenceLive({ ...started, pid: 1_000_000_000 }), false);
    } finally {
      stopPresence(dir);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stays live while the walker pid is running, even if the file was not touched", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-presence-stale-"));
    try {
      const started = startPresence(dir, { pageId: "home", brain: "unleash" });
      assert.ok(started);
      assert.equal(isPresenceLive(started), true);
      const quiet = {
        ...started,
        updatedAt: new Date(Date.now() - 120_000).toISOString(),
      };
      assert.equal(isPresenceLive(quiet), true);
    } finally {
      stopPresence(dir);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stopPresenceIfDead writes stoppedAt when the pid is gone", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-presence-reap-"));
    try {
      const started = startPresence(dir, { pageId: "home", brain: "map" });
      assert.ok(started);
      stopPresence(dir);
      writeDeadPid(dir, started);
      const reaped = stopPresenceIfDead(dir);
      assert.ok(reaped?.stoppedAt);
      assert.equal(isPresenceLive(reaped), false);
      assert.equal(stopPresenceIfDead(dir)?.stoppedAt, reaped?.stoppedAt);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reclaims leftover mcp walks from other pids and leaves unleash alone", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-presence-reclaim-"));
    try {
      const mcpOld = join(root, "mcp-old");
      const mcpMine = join(root, "mcp-mine");
      const unleash = join(root, "unleash-live");
      mkdirSync(mcpOld);
      mkdirSync(mcpMine);
      mkdirSync(unleash);
      const old = startPresence(mcpOld, { pageId: "home", brain: "mcp" });
      const mine = startPresence(mcpMine, { pageId: "clients", brain: "mcp" });
      const other = startPresence(unleash, { pageId: "home", brain: "unleash" });
      assert.ok(old && mine && other);
      const stopped = reclaimMcpPresence(root, { pid: mine.pid, id: mine.id });
      assert.equal(stopped.length, 1);
      assert.equal(stopped[0]?.id, old.id);
      assert.ok(stopped[0]?.stoppedAt);
      assert.equal(loadPresence(join(mcpMine, "presence.json"))?.stoppedAt, null);
      assert.equal(loadPresence(join(unleash, "presence.json"))?.stoppedAt, null);
      stopPresence(mcpOld);
      stopPresence(mcpMine);
      stopPresence(unleash);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not start for replay", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-presence-replay-"));
    try {
      assert.equal(startPresence(dir, { pageId: "home", replay: true }), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
