import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatClock, formatLiveLine, formatNavLine } from "../src/executor/nav-log.js";

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
