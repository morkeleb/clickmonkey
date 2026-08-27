import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPageState, type PageStateSnapshot } from "../src/executor/page-state.js";

describe("formatPageState", () => {
  it("lists disabled Save and live field values", () => {
    const snap: PageStateSnapshot = {
      page: "vouchers_new",
      surface: "page",
      url: "https://app/vouchers/new",
      mode: "form",
      widgets: [
        {
          kind: "field",
          id: "invoicedate",
          present: true,
          visible: true,
          enabled: true,
          disabled: false,
          ariaDisabled: false,
          value: "03/23/2025",
          required: true,
          type: "text",
          placeholder: "MM/DD/YYYY",
        },
        {
          kind: "action",
          id: "button_save",
          present: true,
          visible: true,
          enabled: false,
          disabled: true,
          ariaDisabled: true,
          label: "Save",
        },
      ],
    };
    const text = formatPageState(snap);
    assert.match(text, /page: vouchers_new/);
    assert.match(text, /mode: form/);
    assert.match(text, /invoicedate: "03\/23\/2025"/);
    assert.match(text, /placeholder=MM\/DD\/YYYY/);
    assert.match(text, /button_save/);
    assert.match(text, /disabled/);
    assert.match(text, /aria-disabled/);
  });
});
