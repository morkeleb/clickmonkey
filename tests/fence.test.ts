import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { checkFence, pathPrefixMatch } from "../src/executor/fence.js";
import { createExecutor, type RunState } from "../src/executor/run.js";
import { withRun } from "../src/executor/session.js";
import { Config, PageModel } from "../src/schema/index.js";
import { serveSite } from "./helpers/fixture-server.js";

const fenceModel = PageModel.parse({
  schemaVersion: 1,
  app: "fence",
  generation: 0,
  pages: [
    {
      id: "home",
      path: "/",
      params: [],
      ready: { by: "testId", value: "home" },
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [],
          actions: [{ id: "logout", by: "testId", value: "logout", status: "ok" }],
        },
      ],
    },
  ],
});

describe("pathPrefixMatch / checkFence", () => {
  it("uses a segment boundary for path prefixes", () => {
    assert.equal(pathPrefixMatch("/app", "/app"), true);
    assert.equal(pathPrefixMatch("/app/x", "/app"), true);
    assert.equal(pathPrefixMatch("/application", "/app"), false);
    assert.equal(checkFence("http://x/app/x", { path: "/app" }), "ok");
    assert.equal(checkFence("http://x/login", { path: "/app" }), "leftPath");
    assert.equal(checkFence("http://x/app#/login", { blacklist: ["/login"] }), "blacklist");
  });
});

describe("fence executor", () => {
  it("records fenceViolation and skips afterStep", async () => {
    const { baseUrl, close } = await serveSite("fence");
    const outDir = mkdtempSync(join(tmpdir(), "cm-fence-"));
    try {
      await withRun({}, async ({ page, context, browser }) => {
        await page.goto(baseUrl);
        let afterStepCalls = 0;
        const config = Config.parse({
          url: baseUrl,
          fence: { blacklist: ["/login"] },
          map: fenceModel,
        });
        const usedLocators = {};
        const state: RunState = {
          page,
          context,
          browser,
          config,
          model: config.map,
          pageId: "home",
          surfaceStack: ["page"],
          log: { schemaVersion: 1, steps: [], comments: [], usedLocators },
          usedLocators,
          pendingFindings: [],
          outDir,
          afterStep: async () => {
            afterStepCalls += 1;
          },
        };
        const exec = createExecutor(state);
        const result = await exec.runLine("click page.logout");
        assert.equal(result.ok, false);
        assert.equal(result.finding?.kind, "fenceViolation");
        assert.match(result.finding?.url ?? page.url(), /\/login/);
        assert.equal(afterStepCalls, 0);
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      await close();
    }
  });
});
