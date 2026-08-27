import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dateControlRejectedNonDate,
  dateFillValue,
  formatIsoDate,
  looksLikeDateInput,
  looksLikeDateMask,
  parseDateMask,
} from "../src/executor/date-mask.js";

describe("date-mask", () => {
  it("parses letter-token placeholders regardless of separator", () => {
    assert.deepEqual(parseDateMask("MM/DD/YYYY"), { order: "mdy", sep: "/" });
    assert.deepEqual(parseDateMask("mm/dd/yyyy"), { order: "mdy", sep: "/" });
    assert.deepEqual(parseDateMask("MM-DD-YYYY"), { order: "mdy", sep: "-" });
    assert.deepEqual(parseDateMask("DD/MM/YYYY"), { order: "dmy", sep: "/" });
    assert.deepEqual(parseDateMask("dd.mm.yyyy"), { order: "dmy", sep: "." });
    assert.deepEqual(parseDateMask("YYYY-MM-DD"), { order: "ymd", sep: "-" });
    assert.deepEqual(parseDateMask("yyyy/mm/dd"), { order: "ymd", sep: "/" });
    assert.equal(parseDateMask("Enter a date"), undefined);
    assert.equal(looksLikeDateMask("MM/DD/YYYY"), true);
    assert.equal(looksLikeDateMask(""), false);
  });

  it("formats ISO into the mask", () => {
    assert.equal(formatIsoDate("2026-01-31", parseDateMask("MM/DD/YYYY")!), "01/31/2026");
    assert.equal(formatIsoDate("2026-01-31", parseDateMask("DD/MM/YYYY")!), "31/01/2026");
    assert.equal(formatIsoDate("2026-01-31", parseDateMask("dd.mm.yyyy")!), "31.01.2026");
    assert.equal(formatIsoDate("2026-01-31", parseDateMask("YYYY-MM-DD")!), "2026-01-31");
    assert.equal(formatIsoDate("not-iso", parseDateMask("MM/DD/YYYY")!), undefined);
  });

  it("keeps native date ISO and rewrites masked text", () => {
    assert.equal(dateFillValue("2026-01-31", { placeholder: "MM/DD/YYYY" }), "01/31/2026");
    assert.equal(dateFillValue("2026-01-31", { fieldType: "date" }), "2026-01-31");
    assert.equal(dateFillValue("2026-01-31", { htmlType: "date", placeholder: "MM/DD/YYYY" }), "2026-01-31");
  });

  it("does not treat a mask that refused SQL/XSS as a fill miss", () => {
    assert.equal(looksLikeDateInput("2026-01-31"), true);
    assert.equal(looksLikeDateInput("01/31/2026"), true);
    assert.equal(looksLikeDateInput("31.01.2026"), true);
    assert.equal(looksLikeDateInput("') OR ('1'='1"), false);
    assert.equal(looksLikeDateInput("{{constructor}}"), false);
    assert.equal(looksLikeDateInput("<script>alert(1)</script>"), false);
    assert.equal(looksLikeDateInput("<img src=x onerror=alert(1)>"), false);
    const mask = { placeholder: "MM/DD/YYYY" };
    assert.equal(dateControlRejectedNonDate("') OR ('1'='1", mask), true);
    assert.equal(dateControlRejectedNonDate("<img src=x onerror=alert(1)>", mask), true);
    assert.equal(dateControlRejectedNonDate("<script>alert(1)</script>", mask), true);
    assert.equal(dateControlRejectedNonDate("01/31/2026", mask), false);
    assert.equal(dateControlRejectedNonDate("2026-01-31", mask), false);
    assert.equal(dateControlRejectedNonDate("') OR ('1'='1", { placeholder: "Name" }), false);
    assert.equal(dateControlRejectedNonDate("') OR ('1'='1", { htmlType: "date" }), true);
  });
});
