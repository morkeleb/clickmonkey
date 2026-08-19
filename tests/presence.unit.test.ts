import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  exploreOutlineOf,
  isPresenceLive,
  setPresenceOutline,
  startPresence,
  stopPresence,
  touchPresence,
} from "../src/persist/presence.js";

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
