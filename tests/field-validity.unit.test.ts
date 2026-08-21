import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clipFillValue,
  fieldLooksInvalid,
  fillCtxForPageError,
  fillShouldLookInvalid,
  upsertTrackedFill,
  type TrackedFill,
} from "../src/executor/field-validity.js";
import { looksLikeSubmitClick } from "../src/executor/write-policy.js";
import { findingReportTitle, findingTapeBug, validationMissExplanation } from "../src/schema/finding.js";

const valid: TrackedFill["validity"] = { ariaInvalid: false, errorVisible: false, nativeInvalid: false };

describe("fillShouldLookInvalid", () => {
  it("treats nasty payloads and typed junk as values that should look invalid", () => {
    assert.equal(
      fillShouldLookInvalid({ id: "from_date", type: "text" }, "%00%00%00%00"),
      true,
    );
    assert.equal(
      fillShouldLookInvalid({ id: "email", type: "email", constraints: { htmlType: "email" } }, "not-an-email"),
      true,
    );
    assert.equal(
      fillShouldLookInvalid({ id: "site", constraints: { htmlType: "url" } }, "not-a-url"),
      true,
    );
    assert.equal(
      fillShouldLookInvalid({ id: "qty", type: "number", constraints: { htmlType: "number" } }, "abc"),
      true,
    );
    assert.equal(
      fillShouldLookInvalid({ id: "when", constraints: { htmlType: "date" } }, "%00%00%00%00"),
      true,
    );
    assert.equal(
      fillShouldLookInvalid({ id: "name", type: "text", required: true }, ""),
      true,
    );
    assert.equal(
      fillShouldLookInvalid({ id: "name", type: "text" }, "Ada"),
      false,
    );
    assert.equal(
      fillShouldLookInvalid({ id: "search", type: "text" }, "' OR 1=1--"),
      false,
    );
  });

  it("respects live min/max/minlength/pattern", () => {
    assert.equal(
      fillShouldLookInvalid({ id: "qty", constraints: { htmlType: "number", min: "1", max: "10" } }, "99"),
      true,
    );
    assert.equal(
      fillShouldLookInvalid({ id: "qty", constraints: { htmlType: "number", min: "1", max: "10" } }, "5"),
      false,
    );
    assert.equal(
      fillShouldLookInvalid({ id: "code", constraints: { minLength: 4 } }, "ab"),
      true,
    );
    assert.equal(
      fillShouldLookInvalid({ id: "zip", constraints: { pattern: "\\d{5}" } }, "abc"),
      true,
    );
    assert.equal(
      fillShouldLookInvalid({ id: "zip", constraints: { pattern: "\\d{5}" } }, "02115"),
      false,
    );
  });
});

describe("fieldLooksInvalid", () => {
  it("is true for aria, error node, or native validity", () => {
    assert.equal(fieldLooksInvalid({ ariaInvalid: true, errorVisible: false, nativeInvalid: false }), true);
    assert.equal(fieldLooksInvalid({ ariaInvalid: false, errorVisible: true, nativeInvalid: false }), true);
    assert.equal(fieldLooksInvalid({ ariaInvalid: false, errorVisible: false, nativeInvalid: true }), true);
    assert.equal(fieldLooksInvalid({ ariaInvalid: false, errorVisible: false, nativeInvalid: false }), false);
  });
});

describe("clipFillValue", () => {
  it("clips long values", () => {
    assert.equal(clipFillValue("short"), "short");
    assert.ok(clipFillValue("x".repeat(200)).length <= 80);
  });
});

describe("fillCtxForPageError", () => {
  it("prefers the fill step that is running, not the previous field", () => {
    const fills = upsertTrackedFill(undefined, {
      surface: "page",
      id: "vendor",
      value: "9999",
      shouldInvalid: true,
      validity: valid,
    });
    const ctx = fillCtxForPageError(fills, {
      kind: "fill",
      surface: "page",
      id: "from_date",
      value: "%00%00%00%00",
    });
    assert.equal(ctx?.field, "page.from_date");
    assert.equal(ctx?.value, "%00%00%00%00");
    assert.equal(ctx?.markedInvalid, undefined);
  });

  it("after a click, names the last junk fill", () => {
    let fills = upsertTrackedFill(undefined, {
      surface: "page",
      id: "name",
      value: "Ada",
      shouldInvalid: false,
      validity: valid,
    });
    fills = upsertTrackedFill(fills, {
      surface: "page",
      id: "from_date",
      value: "%00%00%00%00",
      shouldInvalid: true,
      validity: valid,
    });
    const ctx = fillCtxForPageError(fills, { kind: "click", surface: "page", id: "save" });
    assert.equal(ctx?.field, "page.from_date");
    assert.equal(ctx?.markedInvalid, false);
  });

  it("uses the in-flight fill value, not a prior fill of the same field", () => {
    const fills = upsertTrackedFill(undefined, {
      surface: "page",
      id: "from_date",
      value: "2020-01-01",
      shouldInvalid: false,
      validity: { ariaInvalid: true, errorVisible: false, nativeInvalid: false },
    });
    const ctx = fillCtxForPageError(fills, {
      kind: "fill",
      surface: "page",
      id: "from_date",
      value: "%00%00%00%00",
    });
    assert.equal(ctx?.value, "%00%00%00%00");
    assert.equal(ctx?.markedInvalid, undefined);
  });
});

describe("validationMissExplanation", () => {
  it("names junk that submit did not mark invalid", () => {
    const body = validationMissExplanation([{ field: "page.from_date", value: "%00%00%00%00" }]);
    assert.match(body, /^Validation did not catch junk in `page\.from_date`/m);
    assert.match(body, /product bug/);
    assert.match(body, /%00%00%00%00/);
    assert.match(body, /still not marked invalid/);
    assert.equal(findingReportTitle("expectFailed", body), "Validation did not catch junk in `page.from_date`");
    assert.equal(findingTapeBug("expectFailed", body), "Validation did not catch junk in `page.from_date`");
  });

  it("names an empty required field", () => {
    const body = validationMissExplanation([{ field: "create.name", value: "" }]);
    assert.match(body, /Required field `create\.name` accepted empty/);
  });
});

describe("looksLikeSubmitClick", () => {
  it("skips openers, add_row, and pager next when previous exists", () => {
    assert.equal(looksLikeSubmitClick({ id: "create", by: "role", opens: "dialog" }), false);
    assert.equal(looksLikeSubmitClick({ id: "add_row", by: "css" }), false);
    assert.equal(
      looksLikeSubmitClick({ id: "next", by: "role" }, [{ id: "previous" }, { id: "next" }]),
      false,
    );
    assert.equal(looksLikeSubmitClick({ id: "save", by: "role" }), true);
    assert.equal(looksLikeSubmitClick({ id: "next", by: "role" }), true);
    assert.equal(looksLikeSubmitClick({ id: "submit", by: "css" }), true);
  });
});
