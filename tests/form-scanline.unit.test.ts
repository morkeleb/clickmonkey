import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COLUMN_BAND_PX,
  HIGH_PX,
  SCAN_PX,
  fieldChromeClass,
  formScanlineIssue,
  formScanlineIssues,
  isFieldGrid,
  onSameRow,
  rowClusters,
  verticalColumns,
  type FormFieldSample,
} from "../src/surveyor/form-scanline.js";

function field(partial: Partial<FormFieldSample> & { name: string }): FormFieldSample {
  return {
    controlLeft: 100,
    controlRight: 280,
    controlTop: 40,
    controlBottom: 72,
    controlHeight: 32,
    labelTop: 20,
    labelBottom: 36,
    labelLeft: 100,
    labelRight: 180,
    stacked: true,
    side: false,
    ...partial,
  };
}

describe("fieldChromeClass", () => {
  it("matches MUI outlined/text field tokens, not card/menu chrome", () => {
    assert.equal(fieldChromeClass("MuiOutlinedInput-root"), true);
    assert.equal(fieldChromeClass("MuiTextField-root"), true);
    assert.equal(fieldChromeClass("MuiInput-root"), true);
    assert.equal(fieldChromeClass("MuiOutlinedInput-input"), true);
    assert.equal(fieldChromeClass("MuiInputBase-root"), false);
    assert.equal(fieldChromeClass("card-root"), false);
    assert.equal(fieldChromeClass("menu-item"), false);
    assert.equal(fieldChromeClass(null), false);
    assert.equal(fieldChromeClass(undefined), false);
  });
});

describe("formScanline helpers", () => {
  it("uses the same 16px bar as list/table scanline", () => {
    assert.equal(SCAN_PX, 16);
    assert.equal(HIGH_PX, 28);
  });

  it("clusters fields that share a top into one row", () => {
    const rows = rowClusters([
      field({ name: "Vendor Type", controlTop: 40, controlLeft: 20, controlRight: 200 }),
      field({ name: "Legal Name", controlTop: 76, controlLeft: 280, controlRight: 460 }),
      field({ name: "Tax ID", controlTop: 200, controlLeft: 20, controlRight: 200 }),
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.length, 2);
  });

  it("does not cluster wrapped filter lines with no horizontal overlap", () => {
    const search = field({
      name: "Journal search",
      wrap: true,
      controlTop: 40,
      controlLeft: 20,
      controlRight: 200,
    });
    const posted = field({
      name: "Posted date",
      wrap: true,
      controlTop: 88,
      controlLeft: 280,
      controlRight: 460,
    });
    assert.equal(onSameRow(search, posted), false);
    const rows = rowClusters([search, posted]);
    assert.equal(rows.length, 2);
    const issues = formScanlineIssues([search, posted]);
    assert.ok(
      issues.every((i) => !/Journal search and Posted date sit on one row but do not line up/.test(i.message)),
      JSON.stringify(issues),
    );
  });

  it("still clusters a dropped two-column row when wrap is false", () => {
    const vendorType = field({
      name: "Vendor Type",
      wrap: false,
      controlTop: 40,
      controlLeft: 20,
      controlRight: 200,
    });
    const legalName = field({
      name: "Legal Name",
      wrap: false,
      controlTop: 76,
      controlLeft: 280,
      controlRight: 460,
    });
    assert.equal(onSameRow(vendorType, legalName), true);
    const rows = rowClusters([vendorType, legalName]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.length, 2);
  });

  it("does not treat fields in different cards as the same row", () => {
    assert.equal(
      onSameRow(
        field({
          name: "Default Payment Terms",
          cardKey: "Default Payment Terms",
          controlTop: 40,
          controlLeft: 20,
          controlRight: 200,
        }),
        field({
          name: "Max Past Days",
          cardKey: "Max Past Days",
          controlTop: 52,
          controlLeft: 280,
          controlRight: 460,
        }),
      ),
      false,
    );
  });

  it("does not treat fields in different panes as the same row", () => {
    assert.equal(
      onSameRow(
        field({
          name: "Journal search",
          pane: "page",
          controlTop: 40,
          controlLeft: 20,
          controlRight: 200,
        }),
        field({
          name: "Posted date",
          pane: "dialog",
          controlTop: 48,
          controlLeft: 280,
          controlRight: 460,
        }),
      ),
      false,
    );
  });

  it("flags a dropped field on a two-column row and a side label off baseline", () => {
    const issues = formScanlineIssues([
      field({ name: "Vendor Type", controlTop: 40, stacked: true, controlLeft: 20, controlRight: 200 }),
      field({ name: "Legal Name", controlTop: 76, stacked: true, controlLeft: 280, controlRight: 460 }),
      field({
        name: "Tax ID",
        stacked: false,
        side: true,
        labelTop: 8,
        labelBottom: 24,
        controlTop: 80,
        controlBottom: 112,
      }),
    ]);
    assert.ok(
      issues.some((i) => /Vendor Type and Legal Name sit on one row but do not line up/.test(i.message)),
      JSON.stringify(issues),
    );
    assert.ok(
      issues.some((i) => /Tax ID label does not line up with the field/.test(i.message)),
      JSON.stringify(issues),
    );
  });

  it("groups a ragged stacked column inside a 48px band", () => {
    const cols = verticalColumns(
      [
        field({ name: "Identity", controlTop: 40, controlLeft: 220, labelLeft: 220 }),
        field({ name: "Vendor Kind", controlTop: 100, controlLeft: 260, labelLeft: 260 }),
        field({ name: "DBA", controlTop: 160, controlLeft: 220, labelLeft: 220 }),
      ],
      (f) => f.controlLeft,
    );
    assert.equal(COLUMN_BAND_PX, 48);
    assert.equal(cols.length, 1);
    assert.equal(cols[0]?.length, 3);
  });

  it("flags mixed-name stacked fields that do not share a left edge", () => {
    const issues = formScanlineIssues([
      field({ name: "Identity", controlTop: 40, controlLeft: 220, labelLeft: 220, stacked: true }),
      field({ name: "Vendor Kind", controlTop: 100, controlLeft: 260, labelLeft: 260, stacked: true }),
      field({ name: "DBA", controlTop: 160, controlLeft: 220, labelLeft: 220, stacked: true }),
    ]);
    assert.ok(
      issues.some((i) => /Identity and Vendor Kind do not line up down the column/.test(i.message)),
      JSON.stringify(issues),
    );
  });

  it("flags repeating same-name labels when the fields already share a left edge", () => {
    const issues = formScanlineIssues([
      field({ name: "Attorney", controlTop: 200, controlLeft: 24, controlRight: 200, labelLeft: 24 }),
      field({ name: "Attorney", controlTop: 260, controlLeft: 24, controlRight: 200, labelLeft: 72 }),
      field({ name: "Attorney", controlTop: 320, controlLeft: 24, controlRight: 200, labelLeft: 24 }),
    ]);
    assert.ok(
      issues.some((i) => /Attorney labels do not line up down the column/.test(i.message)),
      JSON.stringify(issues),
    );
  });

  it("flags repeating same-name fields that do not share a left edge", () => {
    const issues = formScanlineIssues([
      field({ name: "Attorney", controlTop: 200, controlLeft: 24, controlRight: 200 }),
      field({ name: "Attorney", controlTop: 260, controlLeft: 72, controlRight: 248 }),
      field({ name: "Attorney", controlTop: 320, controlLeft: 24, controlRight: 200 }),
    ]);
    assert.ok(
      issues.some((i) => /Attorney fields do not line up down the column/.test(i.message) && i.confidence === "high"),
      JSON.stringify(issues),
    );
  });

  it("skips 1px jitter", () => {
    assert.equal(formScanlineIssue({ message: "x", where: "y", spread: 16 }), undefined);
    assert.equal(formScanlineIssue({ message: "x", where: "y", spread: 17 })?.rule, "scanline");
  });

  it("flags side-label ink when box midpoints would pass", () => {
    const issues = formScanlineIssues([
      field({
        name: "Display Name",
        stacked: false,
        side: true,
        labelTop: 0,
        labelBottom: 80,
        controlTop: 24,
        controlBottom: 56,
        labelInkTop: 0,
        valueInkTop: 24,
      }),
    ]);
    assert.ok(
      issues.some((i) => /Display Name label does not line up with the field/.test(i.message)),
      JSON.stringify(issues),
    );
  });

  it("does not flag a two-column details grid as a stacked column", () => {
    const rows: [string, string][] = [
      ["Voucher Type", "Invoice Number"],
      ["Invoice Date", "Payment Terms"],
      ["Due Date", "Currency Code"],
    ];
    const grid = rows.flatMap(([leftName, rightName], i) => {
      const top = 40 + i * 80;
      const combo = rightName === "Payment Terms";
      return [
        field({
          name: leftName,
          controlTop: top,
          controlBottom: top + 32,
          controlLeft: 24,
          controlRight: 280,
          labelLeft: 24,
        }),
        field({
          name: rightName,
          controlTop: top,
          controlBottom: top + 32,
          controlLeft: combo ? 322 : 300,
          controlRight: combo ? 582 : 560,
          labelLeft: combo ? 322 : 300,
        }),
      ];
    });
    const issues = formScanlineIssues(grid);
    assert.ok(
      issues.every(
        (i) =>
          !/Invoice Number/.test(i.message) &&
          !/Payment Terms/.test(i.message) &&
          !/Currency Code/.test(i.message),
      ),
      JSON.stringify(issues),
    );
  });

  it("does not flag a repeating two-column field grid as a dropped row", () => {
    const grid = [1, 2, 3].flatMap((n) => {
      const top = 40 + (n - 1) * 48;
      return [
        field({
          name: `Void reason code, row ${n}`,
          controlTop: top,
          controlBottom: top + 32,
          controlLeft: 20,
          controlRight: 180,
        }),
        field({
          name: `Void reason description, row ${n}`,
          controlTop: top + 2,
          controlBottom: top + 34,
          controlLeft: 200,
          controlRight: 360,
        }),
      ];
    });
    assert.equal(isFieldGrid(grid), true);
    const issues = formScanlineIssues(grid);
    assert.ok(
      issues.every((i) => !/Void reason/.test(i.message)),
      JSON.stringify(issues),
    );
  });

  it("skips side labels whose ink shares a baseline even when boxes do not", () => {
    const issues = formScanlineIssues([
      field({
        name: "Display Name",
        stacked: false,
        side: true,
        labelTop: 0,
        labelBottom: 80,
        controlTop: 42,
        controlBottom: 74,
        labelInkTop: 42,
        valueInkTop: 42,
      }),
    ]);
    assert.ok(
      issues.every((i) => !/Display Name label does not line up with the field/.test(i.message)),
      JSON.stringify(issues),
    );
  });
});
