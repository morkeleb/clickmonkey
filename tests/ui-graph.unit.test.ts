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
        description: "Home with a create dialog",
        describedBy: "explore",
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
    const home = g.nodes.find((n) => n.id === "home");
    assert.equal(home?.blurb, "Home with a create dialog");
    assert.equal(home?.describedBy, "explore");
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
  it("counts finding folders, not html-validate or axe rows", () => {
    const findings = [
      {
        pageId: "home",
        severity: "critical",
        finding: { url: "http://127.0.0.1/login" },
      },
      {
        pageId: "home",
        severity: "suggestion",
        finding: { url: "http://127.0.0.1/" },
      },
      {
        pageId: "login",
        severity: "major",
        finding: { url: "http://127.0.0.1/login" },
      },
    ];
    const home = badgeCounts({ pageId: "home", path: "/", findings });
    assert.equal(home.red, 1);
    assert.equal(home.yellow, 1);
    const login = badgeCounts({ pageId: "login", path: "/login", findings });
    assert.equal(login.red, 1);
    assert.equal(login.yellow, 0);
  });

  it("does not paint url-less findings on every page", () => {
    const counts = badgeCounts({
      pageId: "home",
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

  it("matches a finding URL onto a templated map path", () => {
    const counts = badgeCounts({
      pageId: "customer",
      path: "/customers/:id1/profile",
      findings: [
        {
          severity: "critical",
          url: "http://127.0.0.1/customers/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/profile",
        },
      ],
    });
    assert.equal(counts.red, 1);
  });
});
