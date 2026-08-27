import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeNotFoundUi, summarizeHttpErrorBody } from "../src/oracles/http.js";

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

describe("summarizeHttpErrorBody", () => {
  it("reads a JSON message field", () => {
    assert.equal(
      summarizeHttpErrorBody(
        JSON.stringify({
          message: "Vendor has status Blacklisted; vouchers may only reference Active or OnHold.",
        }),
      ),
      "Vendor has status Blacklisted; vouchers may only reference Active or OnHold.",
    );
  });

  it("reads nested error.message and redacts JWTs", () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.aaaa.bbbb";
    const out = summarizeHttpErrorBody(JSON.stringify({ error: { message: `denied ${token}` } }));
    assert.match(out, /denied/);
    assert.doesNotMatch(out, /eyJhbGci/);
  });

  it("returns empty for a blank body", () => {
    assert.equal(summarizeHttpErrorBody("  "), "");
  });
});
