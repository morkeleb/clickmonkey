import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { bootRun } from "../src/executor/boot.js";
import { withRun } from "../src/executor/session.js";
import { emptyConfig } from "../src/schema/config.js";
import { serveSite } from "./helpers/fixture-server.js";

describe("nav log", () => {
  it("records the first goto and a click navigation in nav.jsonl", async () => {
    const { baseUrl, close } = await serveSite("nav");
    const outDir = mkdtempSync(join(tmpdir(), "cm-nav-"));
    try {
      await withRun({}, async (handle) => {
        await bootRun(handle, emptyConfig(baseUrl), outDir);
        await handle.page.getByTestId("about").click();
        await handle.page.waitForURL(/about\.html/);
      });
      const raw = readFileSync(join(outDir, "nav.jsonl"), "utf8");
      const events = raw
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { type: string; to: string; via: string });
      assert.ok(events.length >= 2, raw);
      assert.ok(events.every((e) => e.type === "nav"));
      assert.ok(events.some((e) => e.to === `${baseUrl}/` || e.to === baseUrl));
      assert.ok(events.some((e) => e.to.includes("about.html")));
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      await close();
    }
  });
});
