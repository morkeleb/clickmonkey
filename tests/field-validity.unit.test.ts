import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clipFillValue,
  fieldLooksInvalid,
  fillCtxForPageError,
  fillShouldLookInvalid,
  fillValueInRequest,
  isSilentSubmitMessage,
  shouldReportSilentSubmit,
  SILENT_SUBMIT_MESSAGE,
  upsertTrackedFill,
  validationMissesToReport,
  type TrackedFill,
} from "../src/executor/field-validity.js";
import { looksLikeRowSelectCheckbox } from "../src/brains/unleash.js";
import { isPrimaryFormCommit, looksLikeSubmitClick } from "../src/executor/write-policy.js";
import { findingReportTitle, findingTapeBug, httpErrorTitle, validationMissExplanation } from "../src/schema/finding.js";

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
    assert.equal(ctx?.shouldInvalid, true);
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
    assert.equal(ctx?.shouldInvalid, true);
  });

  it("does not treat a plausible fill as junk on a later click", () => {
    const fills = upsertTrackedFill(undefined, {
      surface: "page",
      id: "name",
      value: "Ada",
      shouldInvalid: false,
      validity: valid,
    });
    const ctx = fillCtxForPageError(fills, { kind: "click", surface: "page", id: "save" });
    assert.equal(ctx?.field, "page.name");
    assert.equal(ctx?.shouldInvalid, false);
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
    assert.match(body, /not marked invalid/);
    assert.match(body, /sent the values or left the form/);
    assert.equal(findingReportTitle("expectFailed", body), "Validation did not catch junk in `page.from_date`");
    assert.equal(findingTapeBug("expectFailed", body), "Validation did not catch junk in `page.from_date`");
  });

  it("names an empty required field", () => {
    const body = validationMissExplanation([{ field: "create.name", value: "" }]);
    assert.match(body, /Required field `create\.name` accepted empty/);
  });
});

describe("httpErrorTitle", () => {
  it("shortens httpError titles so the card heading is not the oracle body", () => {
    const refused =
      "HTTP 409 PATCH https://demo.f2dev.test/api/accounts-payable/settings: AP settings were modified by another writer. Expected version abc";
    assert.equal(httpErrorTitle(refused, 409), "HTTP 409 — server refused submit");
    assert.equal(findingReportTitle("httpError", refused, 409), "HTTP 409 — server refused submit");
    assert.equal(findingReportTitle("httpError", "HTTP 403 GET https://app/secret", 403), "HTTP 403");
    assert.equal(httpErrorTitle("timeout"), "HTTP error");
  });
});

describe("fillValueInRequest", () => {
  it("matches raw, encoded, and JSON-escaped values", () => {
    assert.equal(fillValueInRequest("ab", "/save", "ab"), false);
    assert.equal(fillValueInRequest("' OR 'x'='x", "/save", JSON.stringify({ name: "' OR 'x'='x" })), true);
    assert.equal(fillValueInRequest("javascript:alert(1)", "/x?q=javascript%3Aalert(1)", null), true);
    assert.equal(
      fillValueInRequest('"><img src=x onerror=alert(1)>', "/save", JSON.stringify({ v: '"><img src=x onerror=alert(1)>' })),
      true,
    );
    assert.equal(fillValueInRequest("' OR 'x'='x", "/save", JSON.stringify({ name: "Ada" })), false);
  });
});

describe("validationMissesToReport", () => {
  it("drops unmarked junk that never left the form and was not sent", () => {
    const unmarked: TrackedFill[] = [
      { surface: "page", id: "clientname", value: "' OR 'x'='x", shouldInvalid: true, validity: valid },
    ];
    assert.deepEqual(validationMissesToReport({ unmarked, gone: [], requests: [] }), []);
    assert.equal(
      validationMissesToReport({
        unmarked,
        gone: [],
        requests: [{ url: "/save", postData: JSON.stringify({ clientname: "' OR 'x'='x" }) }],
      }).length,
      1,
    );
  });

  it("treats a write request as sending empty or short junk", () => {
    const unmarked: TrackedFill[] = [
      { surface: "page", id: "name", value: "", shouldInvalid: true, validity: valid },
    ];
    assert.deepEqual(validationMissesToReport({ unmarked, gone: [], requests: [] }), []);
    assert.equal(
      validationMissesToReport({
        unmarked,
        gone: [],
        requests: [{ url: "/save", method: "POST", postData: '{"name":""}' }],
      }).length,
      1,
    );
    assert.equal(
      validationMissesToReport({
        unmarked: [{ surface: "page", id: "name", value: "\t", shouldInvalid: true, validity: valid }],
        gone: [],
        requests: [{ url: "/save", method: "PUT" }],
      }).length,
      1,
    );
  });

  it("reports junk whose control left the form even with no request", () => {
    const gone: TrackedFill[] = [
      { surface: "page", id: "name", value: "' OR 'x'='x", shouldInvalid: true, validity: valid },
    ];
    assert.equal(validationMissesToReport({ unmarked: [], gone, requests: [] }).length, 1);
  });
});

describe("shouldReportSilentSubmit", () => {
  const stay = {
    urlChanged: false,
    submitVisible: true,
    requests: [] as { url: string; method?: string; postData?: string | null }[],
    validity: [valid],
  };

  it("reports when Save stays put with no write and no invalid marks", () => {
    assert.equal(shouldReportSilentSubmit(stay), true);
    assert.equal(shouldReportSilentSubmit({ ...stay, validity: [] }), true);
    assert.equal(isSilentSubmitMessage(SILENT_SUBMIT_MESSAGE), true);
  });

  it("does not report when validation marked a field, a write fired, or the form left", () => {
    assert.equal(
      shouldReportSilentSubmit({
        ...stay,
        validity: [{ ariaInvalid: true, errorVisible: false, nativeInvalid: false }],
      }),
      false,
    );
    assert.equal(
      shouldReportSilentSubmit({
        ...stay,
        validity: [{ ariaInvalid: false, errorVisible: true, nativeInvalid: false }],
      }),
      false,
    );
    assert.equal(
      shouldReportSilentSubmit({
        ...stay,
        validity: [{ ariaInvalid: false, errorVisible: false, nativeInvalid: true }],
      }),
      false,
    );
    assert.equal(
      shouldReportSilentSubmit({ ...stay, requests: [{ url: "/save", method: "POST" }] }),
      false,
    );
    assert.equal(
      shouldReportSilentSubmit({ ...stay, requests: [{ url: "/save", postData: '{"a":1}' }] }),
      false,
    );
    assert.equal(shouldReportSilentSubmit({ ...stay, urlChanged: true }), false);
    assert.equal(shouldReportSilentSubmit({ ...stay, submitVisible: false }), false);
  });
});

describe("looksLikeRowSelectCheckbox", () => {
  it("matches TanStack row-toggle names, not a normal agree box", () => {
    assert.equal(
      looksLikeRowSelectCheckbox({
        id: "checkbox_press_space_to_toggle_row_selection__unchecked_",
        type: "checkbox",
        label: "Press Space to toggle row selection (unchecked)",
      }),
      true,
    );
    assert.equal(
      looksLikeRowSelectCheckbox({ id: "checkbox_column_with_header_selection", type: "checkbox" }),
      false,
    );
    assert.equal(looksLikeRowSelectCheckbox({ id: "agree", type: "checkbox", label: "I agree" }), false);
  });
});

describe("looksLikeSubmitClick", () => {
  it("matches unleash: skip openers and add_row, keep wizard Next, skip list pagers", () => {
    assert.equal(looksLikeSubmitClick({ id: "create", by: "role", opens: "dialog" }), false);
    assert.equal(looksLikeSubmitClick({ id: "add_row", by: "css" }), false);
    assert.equal(
      looksLikeSubmitClick({ id: "next", by: "role" }, [{ id: "previous" }, { id: "next" }]),
      true,
    );
    assert.equal(
      looksLikeSubmitClick({ id: "next", by: "role" }, [
        { id: "previous" },
        { id: "next" },
        { id: "combobox_status", role: "combobox" },
        { id: "sorted_ascending" },
      ]),
      false,
    );
    assert.equal(looksLikeSubmitClick({ id: "save", by: "role" }), true);
    assert.equal(looksLikeSubmitClick({ id: "done", by: "role" }), true);
    assert.equal(isPrimaryFormCommit({ id: "button_save", name: "Save" }), true);
    assert.equal(isPrimaryFormCommit({ id: "submit" }), true);
    assert.equal(isPrimaryFormCommit({ id: "next", name: "Next" }), false);
    assert.equal(isPrimaryFormCommit({ id: "apply", name: "Apply" }), false);
    assert.equal(looksLikeSubmitClick({ id: "next", by: "role" }), true);
    assert.equal(looksLikeSubmitClick({ id: "submit", by: "css" }), true);
  });
});
