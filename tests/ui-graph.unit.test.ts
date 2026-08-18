import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { badgeCounts, buildUiGraph } from "../src/ui/graph.js";
import type { PageModelDraft } from "../src/schema/page-model.js";

function draft(): PageModelDraft {
  return {
    schemaVersion: 1,
    app: "x",
    generation: 1,
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
              { id: "open_create", by: "testId", value: "open-create", opens: "create", status: "ok" },
            ],
          },
          { id: "create", kind: "dialog", fields: [], actions: [] },
        ],
      },
    ],
  };
}

describe("buildUiGraph", () => {
  it("emits page and dialog nodes and an opens edge", () => {
    const g = buildUiGraph(draft());
    assert.ok(g.nodes.some((n) => n.id === "home" && n.kind === "page"));
    assert.ok(g.nodes.some((n) => n.id === "home::create" && n.kind === "dialog"));
    assert.ok(g.edges.some((e) => e.source === "home" && e.target === "home::create"));
  });

  it("labels pages by id so /login and /u/login stay distinct", () => {
    const g = buildUiGraph({
      schemaVersion: 1,
      app: "x",
      generation: 1,
      pages: [
        {
          id: "login",
          path: "/login",
          entry: true,
          ready: { by: "testId", value: "login" },
          surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
        },
        {
          id: "u_login",
          path: "/u/login",
          entry: true,
          ready: { by: "testId", value: "login" },
          surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
        },
      ],
    });
    assert.equal(g.nodes.find((n) => n.id === "login")?.label, "Login");
    assert.equal(g.nodes.find((n) => n.id === "u_login")?.label, "U / Login");
  });

  it("chains entry pages then hop targets", () => {
    const g = buildUiGraph({
      schemaVersion: 1,
      app: "x",
      generation: 1,
      pages: [
        {
          id: "login",
          path: "/login",
          entry: true,
          ready: { by: "testId", value: "login" },
          surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
        },
        {
          id: "home",
          path: "/",
          ready: { by: "testId", value: "home" },
          surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
        },
        {
          id: "vendors",
          path: "/vendors",
          ready: { by: "testId", value: "vendors" },
          surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
        },
      ],
    }, { hops: [{ from: "home", to: "vendors" }] });
    assert.ok(g.edges.some((e) => e.source === "login" && e.target === "home"));
    assert.ok(g.edges.some((e) => e.source === "home" && e.target === "vendors"));
  });
});

describe("badgeCounts", () => {
  it("splits blocks/errors to red and warns to yellow", () => {
    const counts = badgeCounts({
      path: "/",
      testability: {
        schemaVersion: 1,
        pages: [
          {
            path: "/",
            foundAt: "t",
            insufficient: true,
            issues: [
              { code: "opaqueControl", severity: "block", tag: "button" },
              { code: "noMain", severity: "warn", tag: "document" },
            ],
          },
        ],
      },
      quality: {
        schemaVersion: 1,
        pages: [
          {
            path: "/",
            foundAt: "t",
            html: [{ source: "html", rule: "no-dup-id", severity: "error", message: "dup", count: 1 }],
            a11y: [],
            runtime: [
              {
                source: "console",
                rule: "console.warning",
                severity: "warning",
                message: "w",
                count: 1,
                firstSeen: "t",
                lastSeen: "t",
              },
            ],
          },
        ],
      },
    });
    assert.equal(counts.red, 2);
    assert.equal(counts.yellow, 2);
  });

  it("does not paint url-less findings on every page", () => {
    const counts = badgeCounts({
      path: "/",
      findings: [
        {
          id: "fnd_1_expectFailed",
          runId: "r",
          runDir: "/tmp",
          finding: {
            schemaVersion: 1,
            id: "fnd_1_expectFailed",
            kind: "expectFailed",
            message: "x",
            tapePath: "/tmp/x",
            stepIndex: 1,
          },
          severity: "major",
          title: "x",
          description: "x",
          tape: "open home\n",
        },
      ],
    });
    assert.equal(counts.red, 0);
    assert.equal(counts.yellow, 0);
  });
});
