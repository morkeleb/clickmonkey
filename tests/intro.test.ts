import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createExecutor, type RunState } from "../src/executor/run.js";
import { withRun } from "../src/executor/session.js";
import { Config, PageModel } from "../src/schema/index.js";
import { serveSite } from "./helpers/fixture-server.js";

const loginModel = PageModel.parse({
  schemaVersion: 1,
  app: "login",
  generation: 0,
  pages: [
    {
      id: "login",
      path: "/",
      params: [],
      ready: { by: "testId", value: "login" },
      surfaces: [
        {
          id: "login",
          kind: "page",
          fields: [
            { id: "user", required: false, type: "text", by: "testId", value: "user", status: "ok" },
            {
              id: "password",
              required: false,
              type: "password",
              by: "testId",
              value: "password",
              status: "ok",
            },
          ],
          actions: [{ id: "submit", by: "testId", value: "submit", status: "ok" }],
        },
      ],
    },
  ],
});

describe("intro", () => {
  it("fills secrets from env and keeps tokens in the log", async () => {
    const { baseUrl, close } = await serveSite("login");
    const outDir = mkdtempSync(join(tmpdir(), "cm-intro-"));
    const prevUser = process.env.CLICKMONKEY_USER;
    const prevPassword = process.env.CLICKMONKEY_PASSWORD;
    process.env.CLICKMONKEY_USER = "u";
    process.env.CLICKMONKEY_PASSWORD = "p";
    try {
      await withRun({}, async ({ page, context, browser }) => {
        await page.goto(baseUrl);
        const config = Config.parse({
          url: baseUrl,
          fence: { blacklist: ["app.html"] },
          intro: [
            "fill login.user $CLICKMONKEY_USER",
            "fill login.password $CLICKMONKEY_PASSWORD",
            "click login.submit",
          ],
          map: loginModel,
        });
        const usedLocators = {};
        const state: RunState = {
          page,
          context,
          browser,
          config,
          model: config.map,
          pageId: "login",
          surfaceStack: ["login"],
          log: { schemaVersion: 1, steps: [], comments: [], usedLocators },
          usedLocators,
          pendingFindings: [],
          outDir,
        };
        const exec = createExecutor(state);
        await exec.runIntro();
        assert.match(page.url(), /app\.html/);
        const fills = state.log.steps.filter((s) => s.kind === "fill");
        assert.equal(fills.length, 2);
        assert.ok(fills.some((s) => s.kind === "fill" && s.value === "$CLICKMONKEY_PASSWORD"));
        assert.ok(fills.some((s) => s.kind === "fill" && s.value === "$CLICKMONKEY_USER"));
        assert.ok(!JSON.stringify(state.log.steps).includes('"p"'));
      });
    } finally {
      if (prevUser === undefined) delete process.env.CLICKMONKEY_USER;
      else process.env.CLICKMONKEY_USER = prevUser;
      if (prevPassword === undefined) delete process.env.CLICKMONKEY_PASSWORD;
      else process.env.CLICKMONKEY_PASSWORD = prevPassword;
      rmSync(outDir, { recursive: true, force: true });
      await close();
    }
  });
});
