import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { formatClock, formatLiveLine, formatNavLine, logStepDone, logStepStart } from "../src/executor/nav-log.js";

describe("formatClock", () => {
  it("prints UTC time from an ISO instant", () => {
    assert.equal(formatClock(new Date("2026-08-18T00:06:54.470Z")), "00:06:54.470");
    assert.equal(formatLiveLine("step  click page.go", new Date("2026-08-18T00:06:54.470Z")), "00:06:54.470 step  click page.go");
  });
});

describe("formatNavLine", () => {
  it("prints a redirect as from → to", () => {
    assert.equal(
      formatNavLine({
        from: "http://app.example/login",
        to: "http://idp.example/u/login",
        via: "redirect",
        status: 302,
        method: "GET",
      }),
      "nav 302 GET http://app.example/login → http://idp.example/u/login",
    );
  });

  it("tags the DSL step that was running", () => {
    assert.equal(
      formatNavLine({
        from: "http://app.example/login",
        to: "http://idp.example/u/login",
        via: "document",
        status: 200,
        method: "GET",
        step: "click page.idp",
        phase: "intro",
      }),
      "nav 200 GET http://app.example/login → http://idp.example/u/login  [click page.idp]",
    );
  });

  it("omits about:blank as a from", () => {
    assert.equal(
      formatNavLine({
        from: "about:blank",
        to: "http://app.example/",
        via: "document",
        status: 200,
        method: "GET",
      }),
      "nav 200 GET http://app.example/",
    );
  });

  it("marks same-document changes", () => {
    assert.equal(
      formatNavLine({
        from: "http://app.example/",
        to: "http://app.example/projects",
        via: "sameDocument",
      }),
      "nav ~ http://app.example/ → http://app.example/projects",
    );
  });
});

describe("logStepStart", () => {
  it("omits mode when absent and records it when set", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-nav-mode-"));
    const path = join(dir, "nav.jsonl");
    try {
      logStepStart(path, { line: "click page.go", pageId: "home", phase: "walk" });
      logStepStart(path, { line: 'fill page.name ""', pageId: "home", phase: "walk", mode: "form" });
      const started = Date.now();
      logStepDone(path, { line: "click page.go", ok: true, started, pageId: "home" });
      logStepDone(path, { line: 'fill page.name ""', ok: true, started, pageId: "home", mode: "form" });
      const events = readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { type: string; mode?: string; line: string; pageId?: string });
      assert.equal("mode" in events[0]!, false);
      assert.equal(events[0]?.mode, undefined);
      assert.equal(events[1]?.mode, "form");
      assert.equal("mode" in events[2]!, false);
      assert.equal(events[3]?.mode, "form");
      const old = JSON.parse(
        '{"ts":"2026-01-01T00:00:00.000Z","type":"step","line":"click page.go","pageId":"home","phase":"walk"}',
      ) as { mode?: string; type: string };
      assert.equal(old.mode, undefined);
      assert.equal(old.type, "step");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
