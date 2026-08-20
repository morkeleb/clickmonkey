import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withRun } from "../src/executor/session.js";
import { buildView, formatView } from "../src/executor/view.js";
import { PageModel } from "../src/schema/index.js";
import { serveSite } from "./helpers/fixture-server.js";

const lookModel = PageModel.parse({
  schemaVersion: 1,
  app: "look",
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
          actions: [
            { id: "go", by: "testId", value: "go", status: "ok" },
            { id: "ok", by: "testId", value: "ok", status: "ok" },
          ],
        },
      ],
    },
  ],
});

describe("buildView look", () => {
  it("records a font palette and hit-tests a covered widget", async () => {
    const { baseUrl, close } = await serveSite("look");
    try {
      await withRun({}, async ({ page }) => {
        await page.goto(baseUrl);
        const view = await buildView({
          page,
          pageId: "home",
          surfaceStack: ["page"],
          model: lookModel,
        });
        assert.ok(view.look, "look");
        const families = new Set(view.look.fonts.map((f) => f.family));
        assert.ok(
          [...families].some((f) => /arial/i.test(f)),
          `fonts ${[...families].join(", ")}`,
        );
        assert.ok(
          [...families].some((f) => /times/i.test(f)),
          `fonts ${[...families].join(", ")}`,
        );
        const go = view.look.covered.find((c) => c.id === "go");
        assert.ok(go, `covered ${JSON.stringify(view.look.covered)}`);
        assert.match(go.by, /blocker/i);
        assert.equal(
          view.look.covered.some((c) => c.id === "ok"),
          false,
        );
        assert.ok(view.testability?.issues.some((i) => i.code === "occludedWidget"));
        assert.equal(view.testability?.insufficient ?? false, false);
        assert.equal(view.mode, "nav");
        const text = formatView(view);
        assert.match(text, /mode: nav/);
        assert.match(text, /look:/);
        assert.match(text, /covered: go ← blocker/);
      });
    } finally {
      await close();
    }
  });
});
