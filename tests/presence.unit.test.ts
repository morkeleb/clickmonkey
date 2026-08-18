import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  isPresenceLive,
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
      const touched = touchPresence(dir, "settings");
      assert.equal(touched?.pageId, "settings");
      const stopped = stopPresence(dir);
      assert.ok(stopped?.stoppedAt);
      assert.equal(isPresenceLive(stopped), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
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
