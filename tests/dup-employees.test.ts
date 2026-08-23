import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { bootRun } from "../src/executor/boot.js";
import { createExecutor } from "../src/executor/run.js";
import { withRun } from "../src/executor/session.js";
import { emptyConfig } from "../src/schema/config.js";
import { emptyDraft } from "../src/schema/page-model.js";
import { inspect } from "../src/surveyor/inspect.js";
import { serveSite } from "./helpers/fixture-server.js";

describe("duplicate Employees nav", () => {
  it("keeps the section and the child, and the nth click opens the list", async () => {
    const { baseUrl, close } = await serveSite("dup-employees");
    const outDir = mkdtempSync(join(tmpdir(), "cm-dup-emp-"));
    try {
      await withRun({}, async (handle) => {
        await handle.page.goto(baseUrl);
        const surveyed = await inspect(handle.page, { model: emptyDraft("app") });
        const pageSurf = surveyed.model.pages[0]?.surfaces.find((s) => s.kind === "page");
        assert.ok(pageSurf);
        const employees = pageSurf.actions.filter((a) => a.name === "Employees");
        assert.equal(employees.length, 2, employees.map((a) => a.id).join(","));
        assert.equal(employees[0]?.nth, undefined);
        assert.equal(employees[1]?.nth, 1);
        assert.ok(surveyed.testability.issues.some((i) => i.code === "duplicateName"));

        const state = await bootRun(handle, { ...emptyConfig(baseUrl), map: surveyed.model }, outDir);
        const exec = createExecutor(state);
        const child = employees[1]!;
        const click = await exec.runLine(`click page.${child.id}`);
        assert.equal(click.ok, true, click.finding?.message);
        assert.match(handle.page.url(), /employees\.html/);

        const after = await inspect(handle.page, { model: state.model });
        const list = after.model.pages.find((p) => p.path.includes("employees"));
        assert.ok(list, after.model.pages.map((p) => p.path).join(", "));
        const listSurf = list.surfaces.find((s) => s.kind === "page");
        assert.ok(listSurf?.actions.some((a) => /new_employee|new employee/i.test(`${a.id} ${a.name ?? ""}`)));
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      await close();
    }
  });
});
