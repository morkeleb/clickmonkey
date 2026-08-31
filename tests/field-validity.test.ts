import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { bootRun } from "../src/executor/boot.js";
import { createExecutor } from "../src/executor/run.js";
import { withRun } from "../src/executor/session.js";
import { Config } from "../src/schema/index.js";
import { serveSite } from "./helpers/fixture-server.js";

function pageFormConfig(url: string): Config {
  return Config.parse({
    url,
    writePolicy: "allow",
    screenshots: false,
    map: {
      schemaVersion: 1,
      app: "blocks-send",
      pages: [
        {
          id: "home",
          path: "/",
          ready: { by: "testId", value: "home" },
          surfaces: [
            {
              id: "page",
              kind: "page",
              fields: [
                {
                  id: "name",
                  required: true,
                  type: "text",
                  by: "testId",
                  value: "name",
                  status: "ok",
                },
                {
                  id: "email",
                  required: false,
                  type: "email",
                  by: "testId",
                  value: "email",
                  status: "ok",
                },
              ],
              actions: [{ id: "submit", by: "testId", value: "submit", status: "ok" }],
            },
          ],
        },
      ],
    },
  });
}

function acceptsEmptyConfig(url: string): Config {
  return Config.parse({
    url,
    writePolicy: "allow",
    screenshots: false,
    map: {
      schemaVersion: 1,
      app: "accepts-empty",
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
              actions: [
                {
                  id: "open_create",
                  opens: "create",
                  by: "testId",
                  value: "open-create",
                  status: "ok",
                },
              ],
            },
            {
              id: "create",
              kind: "dialog",
              locator: { by: "role", value: "dialog", name: "Create" },
              fields: [
                {
                  id: "name",
                  required: true,
                  type: "text",
                  by: "testId",
                  value: "name",
                  status: "ok",
                },
              ],
              actions: [{ id: "submit", by: "testId", value: "submit", status: "ok" }],
            },
          ],
        },
      ],
    },
  });
}

describe("after-submit validation miss", () => {
  it("does not flag junk as accepted when client-side validation blocks the send; silent Save is its own finding", async () => {
    const { baseUrl, close } = await serveSite("blocks-send");
    const outDir = mkdtempSync(join(tmpdir(), "cm-block-send-"));
    try {
      await withRun({ timeout: 8_000 }, async (handle) => {
        const state = await bootRun(handle, pageFormConfig(baseUrl), outDir);
        const exec = createExecutor(state);
        const fill = await exec.runStep({
          kind: "fill",
          surface: "page",
          id: "name",
          value: "' OR 'x'='x",
        });
        assert.equal(fill.ok, true, fill.finding?.message);
        const submit = await exec.runStep({ kind: "click", surface: "page", id: "submit" });
        assert.equal(submit.ok, false);
        assert.equal(submit.finding?.kind, "expectFailed");
        assert.match(submit.finding?.message ?? "", /did not submit the form/);
        assert.doesNotMatch(submit.finding?.message ?? "", /Validation did not catch junk/);
        assert.equal(await handle.page.getByTestId("name").inputValue(), "' OR 'x'='x");
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      await close();
    }
  });

  it("flags junk that a request actually sent without invalid marks", async () => {
    const { baseUrl, close } = await serveSite("blocks-send");
    const outDir = mkdtempSync(join(tmpdir(), "cm-send-junk-"));
    try {
      await withRun({ timeout: 8_000 }, async (handle) => {
        const state = await bootRun(handle, pageFormConfig(baseUrl), outDir);
        const exec = createExecutor(state);
        const name = await exec.runStep({
          kind: "fill",
          surface: "page",
          id: "name",
          value: "Ada",
        });
        assert.equal(name.ok, true, name.finding?.message);
        const fill = await exec.runStep({
          kind: "fill",
          surface: "page",
          id: "email",
          value: "not-an-email",
        });
        assert.equal(fill.ok, true, fill.finding?.message);
        const submit = await exec.runStep({ kind: "click", surface: "page", id: "submit" });
        assert.equal(submit.ok, false);
        assert.equal(submit.finding?.kind, "expectFailed");
        assert.match(submit.finding?.message ?? "", /Validation did not catch junk/);
        assert.match(submit.finding?.message ?? "", /not-an-email/);
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      await close();
    }
  });

  it("does not treat SQLi in a free-text name as invalid-accepted when submit leaves", async () => {
    const { baseUrl, close } = await serveSite("accepts-empty");
    const outDir = mkdtempSync(join(tmpdir(), "cm-gone-junk-"));
    try {
      await withRun({ timeout: 8_000 }, async (handle) => {
        const state = await bootRun(handle, acceptsEmptyConfig(baseUrl), outDir);
        const exec = createExecutor(state);
        const open = await exec.runStep({ kind: "click", surface: "page", id: "open_create" });
        assert.equal(open.ok, true, open.finding?.message);
        const fill = await exec.runStep({
          kind: "fill",
          surface: "create",
          id: "name",
          value: "' OR 'x'='x",
        });
        assert.equal(fill.ok, true, fill.finding?.message);
        const submit = await exec.runStep({ kind: "click", surface: "create", id: "submit" });
        assert.equal(submit.ok, true, submit.finding?.message);
        assert.doesNotMatch(submit.finding?.message ?? "", /Validation did not catch junk/);
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      await close();
    }
  });
});
