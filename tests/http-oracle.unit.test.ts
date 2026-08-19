import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeNotFoundUi } from "../src/oracles/http.js";

describe("looksLikeNotFoundUi", () => {
  it("matches the Next.js default 404 page", () => {
    assert.equal(
      looksLikeNotFoundUi({
        title: "404: This page could not be found",
        bodyText: "404 This page could not be found.",
        headings: ["404"],
        nextError: true,
      }),
      true,
    );
  });

  it("matches a layout 404: Next.js copy in main, no next-error-h1", () => {
    assert.equal(
      looksLikeNotFoundUi({
        title: "Milkshake",
        bodyText:
          "Milkshake Overview Customers Orchestration Runs 404 This page could not be found. Test Mode",
        mainText: "404 This page could not be found.",
        headings: ["Overview"],
        nextError: false,
      }),
      true,
    );
  });

  it("matches a 404 | This page could not be found heading", () => {
    assert.equal(
      looksLikeNotFoundUi({
        title: "Milkshake",
        bodyText: "404 | This page could not be found.",
        headings: ["404 | This page could not be found."],
        nextError: false,
      }),
      true,
    );
  });

  it("does not treat a dashboard KPI that contains 404 as a missing page", () => {
    assert.equal(
      looksLikeNotFoundUi({
        title: "Milkshake",
        bodyText: "Events failed 24h 404 Overview Customers",
        mainText: "Events failed 24h 404 Overview Customers",
        headings: ["Overview"],
        nextError: false,
      }),
      false,
    );
  });
});
