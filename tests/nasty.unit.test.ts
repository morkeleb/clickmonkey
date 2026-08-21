import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideUnleashNasty,
  listCatalogs,
  loadPayloads,
  pickNasty,
  pickNastyFill,
  samplePayloads,
  textContainsNastyPayload,
} from "../src/brains/nasty.js";
import { parseLine } from "../src/schema/dsl.js";
import type { View } from "../src/schema/view.js";

function viewOf(partial: Partial<View>): View {
  return {
    page: "home",
    surface: "page",
    stack: ["page"],
    shown: [],
    actions: [],
    ...partial,
  };
}

describe("nasty payloads", () => {
  it("textContainsNastyPayload matches catalog strings, not the word malicious", () => {
    assert.equal(textContainsNastyPayload("cells contain <script>alert(1)</script>"), true);
    assert.equal(textContainsNastyPayload("name is ' OR 1=1--"), true);
    assert.equal(textContainsNastyPayload("Listing looks malicious and broken"), false);
    assert.equal(textContainsNastyPayload("two cards overlap on the header"), false);
  });

  it("loadPayloads has sqli and xss", () => {
    const catalog = loadPayloads();
    assert.ok(Array.isArray(catalog.sqli) && catalog.sqli.length > 0);
    assert.ok(Array.isArray(catalog.xss) && catalog.xss.length > 0);
    assert.ok(catalog.sqli!.some((p) => p.includes("OR") || p.includes("DROP")));
    assert.ok(catalog.xss!.some((p) => p.includes("<script>") || p.includes("onerror=")));
  });

  it("pickNasty returns a string from the catalog", () => {
    const catalog = loadPayloads();
    const pool = [
      ...(catalog.xss ?? []),
      ...(catalog.sqli ?? []),
      ...(catalog.format ?? []),
      ...(catalog.overlong ?? []),
    ];
    assert.ok(pool.length > 0);
    for (let i = 0; i < 40; i++) {
      const value = pickNasty("text");
      assert.equal(typeof value, "string");
      assert.ok(pool.includes(value), value);
    }
    const first = pickNasty("email", () => 0);
    assert.ok(pool.includes(first), first);
  });

  it("decideUnleashNasty fill lines use a catalog value when filling", () => {
    const catalog = loadPayloads();
    const pool = [
      ...(catalog.xss ?? []),
      ...(catalog.sqli ?? []),
      ...(catalog.format ?? []),
      ...(catalog.overlong ?? []),
    ];
    const view = viewOf({
      shown: [{ id: "name", value: "", type: "text" }],
    });
    for (let i = 0; i < 20; i++) {
      const decision = decideUnleashNasty({ view, stepsUsed: i }, () => 0);
      const parsed = parseLine(decision.line);
      assert.ok(parsed && !("comment" in parsed), decision.line);
      assert.equal(parsed.kind, "fill");
      if (parsed.kind === "fill") {
        assert.ok(pool.includes(parsed.value), parsed.value);
      }
    }
  });

  it("picks a listed select option instead of a catalog payload", () => {
    const field = {
      id: "addressType",
      value: "",
      type: "select" as const,
      options: [
        { value: "mailing", label: "Mailing" },
        { value: "remittance", label: "Remittance" },
        { value: "physical", label: "Physical" },
      ],
    };
    assert.equal(pickNastyFill(field, () => 0), "mailing");
    const catalog = loadPayloads();
    const pool = [
      ...(catalog.xss ?? []),
      ...(catalog.sqli ?? []),
      ...(catalog.format ?? []),
      ...(catalog.overlong ?? []),
    ];
    assert.equal(pool.includes("mailing"), false);
    const view = viewOf({ shown: [field] });
    const decision = decideUnleashNasty({ view, stepsUsed: 0 }, () => 0);
    const parsed = parseLine(decision.line);
    assert.ok(parsed && !("comment" in parsed), decision.line);
    assert.equal(parsed.kind, "fill");
    if (parsed.kind === "fill") assert.equal(parsed.value, "mailing");
  });

  it("fills a native date input with yyyy-MM-dd, not catalog junk", () => {
    const field = {
      id: "posted_from",
      value: "",
      type: "text" as const,
      constraints: { htmlType: "date" },
    };
    const value = pickNastyFill(field, () => 0.3);
    assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
    const catalog = loadPayloads();
    const pool = [
      ...(catalog.xss ?? []),
      ...(catalog.sqli ?? []),
      ...(catalog.format ?? []),
      ...(catalog.overlong ?? []),
    ];
    assert.equal(pool.includes(value), false);
  });

  it("hops when the view is empty instead of reopening the same page", () => {
    const view = viewOf({
      page: "settings",
      pages: ["home", "settings"],
    });
    assert.equal(decideUnleashNasty({ view, stepsUsed: 0 }).line, "open home");
  });

  it("with writePolicy allow fills then submits without clicking away", () => {
    const view = viewOf({
      shown: [{ id: "name", value: "", type: "text" }],
      actions: [{ id: "submit" }, { id: "open_create" }],
    });
    const d = decideUnleashNasty({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0);
    assert.equal(d.lines?.at(-1), "click page.submit");
    assert.match(d.lines?.[0] ?? "", /^fill page\.name /);
  });

  it("listCatalogs includes xss and sqli with count and description", () => {
    const catalogs = listCatalogs();
    const ids = catalogs.map((c) => c.id);
    assert.deepEqual(ids, [...ids].sort());
    const xss = catalogs.find((c) => c.id === "xss");
    const sqli = catalogs.find((c) => c.id === "sqli");
    assert.ok(xss && xss.count > 0 && xss.description);
    assert.ok(sqli && sqli.count > 0 && sqli.description);
  });

  it("samplePayloads returns a short list of raw xss lines", () => {
    const samples = samplePayloads("xss");
    assert.ok(samples.length > 0);
    assert.ok(samples.length <= 6);
    for (const s of samples) assert.ok(s.length <= 120);
  });

  it("samplePayloads returns empty for unknown id", () => {
    assert.deepEqual(samplePayloads("nope"), []);
  });
});
