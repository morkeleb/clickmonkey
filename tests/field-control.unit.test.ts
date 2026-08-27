import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FIELD_CONTROLS,
  isListedControl,
  isTypedValueField,
  listedFillResult,
  liveLooksEmpty,
  looksLikeListedPicker,
  planControlFill,
  skipTextFillMiss,
  textFillMissMessage,
} from "../src/executor/field-control.js";

const ADDRESS = [
  { value: "", label: "Select type" },
  { value: "mailing", label: "Mailing" },
  { value: "physical", label: "Physical" },
];

describe("field control registry", () => {
  it("treats native select and harvested typeahead lists as listed controls", async () => {
    assert.equal(isListedControl({ type: "select" }), true);
    assert.equal(isListedControl({ type: "text", options: [{ value: "NO", label: "Norway" }] }), true);
    assert.equal(isListedControl({ type: "text" }), false);
    assert.equal(isListedControl({ type: "combobox" }), false);
    assert.equal(isListedControl({ type: "checkbox" }), false);
    const typeahead = FIELD_CONTROLS.find((c) => c.kind === "typeahead");
    assert.equal(typeahead?.applies({ type: "combobox" }, false), true);
    assert.equal(typeahead?.applies({ type: "text" }, false), false);
    assert.equal(typeahead?.applies({ type: "text" }, true), true);
    assert.equal(typeahead?.applies({ id: "vendorid", type: "text" }, false), true);
    assert.equal(
      typeahead?.applies({ id: "create_client_billing_splits_attorney_0", type: "text", value: "Select attorney" }, false),
      true,
    );
    assert.equal(typeahead?.applies({ id: "create_client_billing_splits_attorney_0", type: "text" }, false), false);
    assert.equal(typeahead?.applies({ id: "create_client_billing_splits_attorney_0", type: "text" }, true), true);
    assert.equal(FIELD_CONTROLS.find((c) => c.kind === "select")?.applies({ type: "select" }, true), false);
    assert.equal(isTypedValueField({ id: "lineitems_0__amount", type: "number" }), true);
    assert.equal(looksLikeListedPicker({ id: "accountid" }), true);
    assert.equal(looksLikeListedPicker({ id: "lineitems_0__amount", type: "number" }), false);
    assert.equal(looksLikeListedPicker({ id: "lineitems_0__amount", type: "text", constraints: { htmlType: "number" } }), false);
    assert.equal(typeahead?.applies({ id: "lineitems_0__amount", type: "number" }, true), false);
    assert.equal(looksLikeListedPicker({ id: "matter" }), false);
    assert.equal(looksLikeListedPicker({ id: "vendorid", type: "text" }), true);
    assert.equal(looksLikeListedPicker({ id: "party", type: "text", value: "Select a party" }), true);
    assert.equal(
      looksLikeListedPicker({ id: "vendor", type: "text", constraints: { placeholder: "Search vendors" } }),
      true,
    );
    assert.equal(looksLikeListedPicker({ id: "party", type: "text" }), false);
    assert.equal(looksLikeListedPicker({ id: "accountid", type: "number" }), false);
    assert.equal(
      looksLikeListedPicker({ id: "accountid", type: "text", constraints: { htmlType: "number" } }),
      false,
    );
    assert.equal(
      typeahead?.applies({ id: "party", type: "text", value: "Select a party" }, false),
      true,
    );
    assert.equal(
      typeahead?.applies({ id: "vendor", type: "text", constraints: { placeholder: "Search vendors" } }, false),
      true,
    );
    const text = FIELD_CONTROLS.find((c) => c.kind === "text");
    assert.deepEqual(await text!.peekOptions({} as never, {} as never), []);
  });

  it("plans checkbox, select, and listed typeahead from the same table", () => {
    assert.equal(planControlFill({ id: "agree", value: "false", type: "checkbox" }, () => 0, false), "true");
    assert.equal(planControlFill({ id: "agree", value: "false", type: "checkbox" }, () => 0.9, false), "false");
    assert.equal(
      planControlFill({ id: "addressType", value: "", type: "select", options: ADDRESS }, () => 0, false),
      "mailing",
    );
    assert.equal(
      planControlFill({ id: "addressType", value: "", type: "select", options: ADDRESS }, () => 0, true),
      "",
    );
    assert.equal(
      planControlFill(
        { id: "country", value: "", type: "text", options: [{ value: "NO", label: "Norway" }] },
        () => 0,
        false,
      ),
      "NO",
    );
    assert.equal(planControlFill({ id: "name", value: "", type: "text" }, () => 0.9, false), undefined);
  });

  it("treats a live placeholder as empty for read/empty", () => {
    assert.equal(liveLooksEmpty("", "MM/DD/YYYY"), true);
    assert.equal(liveLooksEmpty("   ", undefined), true);
    assert.equal(liveLooksEmpty("MM/DD/YYYY", "MM/DD/YYYY"), true);
    assert.equal(liveLooksEmpty("Select a party", undefined), true);
    assert.equal(liveLooksEmpty("Search vendors", undefined), true);
    assert.equal(liveLooksEmpty("01/31/2026", "MM/DD/YYYY"), false);
    assert.equal(liveLooksEmpty("Ada", ""), false);
  });

  it("TYPEAHEAD fill misses when a required listed chip stays on Select", () => {
    const miss = listedFillResult({
      wanted: "beatus bos",
      live: "Select a party",
      listed: true,
      required: true,
      widgetKey: "page.party",
      label: "Party",
    });
    assert.equal(miss.ok, false);
    if (!miss.ok) assert.match(miss.message, /Party: no matching options/);
    const leftover = listedFillResult({
      wanted: "beatus bos",
      live: "a",
      listed: true,
      required: true,
      widgetKey: "page.party",
      label: "Party",
    });
    assert.equal(leftover.ok, false);
  });

  it("optional listed empty can skip", () => {
    const skip = listedFillResult({
      wanted: "beatus bos",
      live: "",
      listed: true,
      required: false,
      widgetKey: "page.ownerid",
    });
    assert.equal(skip.ok, true);
    if (skip.ok) {
      assert.equal(skip.value, "");
      assert.equal(skip.track, false);
    }
    const prompt = listedFillResult({
      wanted: "beatus bos",
      live: "Search owners",
      listed: true,
      required: false,
      widgetKey: "page.ownerid",
    });
    assert.equal(prompt.ok, true);
    if (prompt.ok) assert.equal(prompt.value, "");
  });

  it("uses the committed listed label, not a leftover prompt", () => {
    const truncated = listedFillResult({
      wanted: "beatus bos",
      live: "Grea...",
      listed: true,
      required: true,
      widgetKey: "page.lineitems_0__matterid",
      label: "Matter",
    });
    assert.equal(truncated.ok, true);
    if (truncated.ok) assert.equal(truncated.value, "Grea...");
    const hit = listedFillResult({
      wanted: "beatus bos",
      live: "Acme Supplies",
      listed: true,
      required: true,
      widgetKey: "page.vendor",
    });
    assert.equal(hit.ok, true);
    if (hit.ok) {
      assert.equal(hit.value, "Acme Supplies");
      assert.equal(hit.track, true);
    }
  });

  it("names a TEXT fill that left the placeholder in place", () => {
    assert.equal(
      textFillMissMessage("page.invoicedate", "2026-01-31", "MM/DD/YYYY"),
      'page.invoicedate did not accept "2026-01-31" (still MM/DD/YYYY)',
    );
  });

  it("does not treat a date mask that refused catalog XSS as a fill miss", () => {
    assert.equal(
      skipTextFillMiss("<img src=x onerror=alert(1)>", "MM/DD/YYYY", "MM/DD/YYYY"),
      true,
    );
    assert.equal(skipTextFillMiss("') OR ('1'='1", "MM/DD/YYYY", "MM/DD/YYYY"), true);
    assert.equal(skipTextFillMiss("2026-01-31", "MM/DD/YYYY", "MM/DD/YYYY"), false);
    assert.equal(skipTextFillMiss("01/31/2026", "01/31/2026", "MM/DD/YYYY"), false);
  });
});
