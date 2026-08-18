import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createExecutor, type RunState } from "../src/executor/run.js";
import { buildView } from "../src/executor/view.js";
import { withRun } from "../src/executor/session.js";
import { serveDirectory } from "../src/fixtures/server.js";
import { Config, PageModel } from "../src/schema/index.js";
import { inspect } from "../src/surveyor/inspect.js";
import { emptyDraft } from "../src/schema/page-model.js";

function writeSite(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "cm-origin-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body);
  }
  return dir;
}

describe("origin-aware pages", () => {
  it("stamps origin on a foreign host and opens that host, not the leash", async () => {
    const appDir = writeSite({
      "index.html": `<!doctype html><main data-testid="home"><h1>App</h1></main>`,
    });
    const idpDir = writeSite({
      "u/login.html": `<!doctype html><main>
        <h1>IdP</h1>
        <input name="username" />
        <input name="password" type="password" />
        <button type="submit">Continue</button>
      </main>`,
    });
    const app = await serveDirectory(appDir);
    const idp = await serveDirectory(idpDir);
    const outDir = mkdtempSync(join(tmpdir(), "cm-origin-out-"));
    try {
      await withRun({}, async ({ page, context, browser }) => {
        const idpLogin = `${idp.baseUrl}/u/login.html`;
        await page.goto(idpLogin);
        const result = await inspect(page, {
          model: emptyDraft("app"),
          appOrigin: new URL(app.baseUrl).origin,
        });
        const created = result.model.pages[0];
        assert.ok(created);
        assert.equal(created.path, "/u/login.html");
        assert.equal(created.origin, new URL(idp.baseUrl).origin);

        const legacy = PageModel.parse({
          schemaVersion: 1,
          app: "app",
          pages: [
            {
              id: "u_login",
              path: "/u/login.html",
              ready: { by: "name", value: "username" },
              surfaces: [
                {
                  id: "page",
                  kind: "page",
                  fields: [
                    {
                      id: "username",
                      required: true,
                      type: "email",
                      by: "name",
                      value: "username",
                      status: "ok",
                    },
                  ],
                  actions: [],
                },
              ],
            },
          ],
        });
        await page.goto(idpLogin);
        const stamped = await inspect(page, {
          model: legacy,
          appOrigin: new URL(app.baseUrl).origin,
        });
        const idpPage = stamped.model.pages.find((p) => p.origin === new URL(idp.baseUrl).origin);
        assert.ok(idpPage, "foreign host gets its own originated page");
        assert.equal(stamped.model.pages.some((p) => p.id === "u_login" && !p.origin), true);
        assert.equal(stamped.merged, true);

        const view = await buildView({
          page,
          pageId: idpPage.id,
          surfaceStack: ["page"],
          model: {
            schemaVersion: 1,
            app: "app",
            generation: 0,
            pages: [
              {
                id: "home",
                path: "/",
                ready: { by: "testId", value: "home" },
                surfaces: [
                  {
                    id: "page",
                    kind: "page",
                    fields: [],
                    actions: [{ id: "go", by: "testId", value: "go", status: "ok" }],
                  },
                ],
              },
              idpPage,
            ],
          },
          appUrl: app.baseUrl,
        });
        assert.deepEqual(view.pages, ["home"]);

        const config = Config.parse({
          url: app.baseUrl,
          map: {
            schemaVersion: 1,
            app: "app",
            pages: [
              {
                id: "home",
                path: "/",
                ready: { by: "testId", value: "home" },
                surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
              },
              {
                id: "u_login",
                path: "/u/login.html",
                origin: new URL(idp.baseUrl).origin,
                ready: { by: "name", value: "username" },
                surfaces: [
                  {
                    id: "page",
                    kind: "page",
                    fields: [],
                    actions: [],
                  },
                ],
              },
            ],
          },
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
        };
        await page.goto(app.baseUrl);
        const exec = createExecutor(state);
        const opened = await exec.runLine("open u_login");
        assert.equal(opened.ok, true, opened.finding?.message);
        assert.equal(new URL(page.url()).origin, new URL(idp.baseUrl).origin);
        assert.match(page.url(), /\/u\/login\.html$/);
      });
    } finally {
      rmSync(appDir, { recursive: true, force: true });
      rmSync(idpDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
      await app.close();
      await idp.close();
    }
  });

  it("waits after intro until the browser is back on the leash origin", async () => {
    const appDir = writeSite({
      "index.html": `<!doctype html><main data-testid="login">
        <a data-testid="idp" href="__IDP__">Sign in</a>
      </main>`,
      "callback.html": `<!doctype html><main data-testid="callback">
        <p>Completing authentication…</p>
        <script>setTimeout(() => { location.href = "/home.html"; }, 200);</script>
      </main>`,
      "home.html": `<!doctype html><main data-testid="home"><h1>Dashboard</h1><a href="/home.html">Home</a></main>`,
    });
    const idpDir = writeSite({
      "u/login.html": `<!doctype html><main>
        <input name="username" />
        <input name="password" type="password" />
        <button type="submit" name="continue">Continue</button>
        <script>
          document.querySelector("button").addEventListener("click", (e) => {
            e.preventDefault();
            location.href = "__APP__/callback.html";
          });
        </script>
      </main>`,
    });
    const app = await serveDirectory(appDir);
    const idp = await serveDirectory(idpDir);
    writeFileSync(
      join(appDir, "index.html"),
      `<!doctype html><main data-testid="login">
        <a data-testid="idp" href="${idp.baseUrl}/u/login.html">Sign in</a>
      </main>`,
    );
    writeFileSync(
      join(idpDir, "u/login.html"),
      `<!doctype html><main>
        <input name="username" />
        <input name="password" type="password" />
        <button type="submit" name="continue">Continue</button>
        <script>
          document.querySelector("button").addEventListener("click", (e) => {
            e.preventDefault();
            location.href = "${app.baseUrl}/callback.html";
          });
        </script>
      </main>`,
    );
    const outDir = mkdtempSync(join(tmpdir(), "cm-origin-intro-"));
    try {
      await withRun({}, async ({ page, context, browser }) => {
        const config = Config.parse({
          url: app.baseUrl,
          intro: ["click page.idp", "click page.continue"],
          map: {
            schemaVersion: 1,
            app: "app",
            pages: [
              {
                id: "login",
                path: "/",
                ready: { by: "testId", value: "login" },
                surfaces: [
                  {
                    id: "page",
                    kind: "page",
                    fields: [],
                    actions: [{ id: "idp", by: "testId", value: "idp", status: "ok" }],
                  },
                ],
              },
              {
                id: "u_login",
                path: "/u/login.html",
                origin: new URL(idp.baseUrl).origin,
                ready: { by: "name", value: "username" },
                surfaces: [
                  {
                    id: "page",
                    kind: "page",
                    fields: [],
                    actions: [
                      { id: "continue", by: "name", value: "continue", status: "ok" },
                    ],
                  },
                ],
              },
            ],
          },
        });
        const usedLocators = {};
        const state: RunState = {
          page,
          context,
          browser,
          config,
          model: config.map,
          pageId: "login",
          surfaceStack: ["page"],
          log: { schemaVersion: 1, steps: [], comments: [], usedLocators },
          usedLocators,
          pendingFindings: [],
          outDir,
        };
        await page.goto(app.baseUrl);
        const exec = createExecutor(state);
        await exec.runIntro();
        assert.equal(new URL(page.url()).origin, new URL(app.baseUrl).origin);
        assert.match(page.url(), /\/home\.html$/);
      });
    } finally {
      rmSync(appDir, { recursive: true, force: true });
      rmSync(idpDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
      await app.close();
      await idp.close();
    }
  });
});
