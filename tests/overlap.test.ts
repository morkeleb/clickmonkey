import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanOverlap } from "../src/surveyor/overlap.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/overlap/index.html", import.meta.url));

describe("scanOverlap", () => {
  it("flags two absolute buttons that share pixels", async () => {
    await withPage(html, async (page) => {
      const issues = await scanOverlap(page);
      const hit = issues.find((i) => i.rule === "overlap");
      assert.ok(hit, `expected overlap on Alpha/Beta, got ${JSON.stringify(issues)}`);
      assert.equal(hit.source, "visual");
      assert.equal(hit.severity, "warning");
      assert.match(`${hit.where} ${hit.message}`, /Alpha/);
      assert.match(`${hit.where} ${hit.message}`, /Beta/);
      assert.equal(
        issues.some((i) => i.rule === "overlap" && /Email|Name/i.test(`${i.where} ${i.message}`)),
        false,
        "labels-on-labels is not overlap",
      );
    });
  });

  it("does not flag a menu open over a table", async () => {
    await withPage(html, async (page) => {
      await page.evaluate(() => {
        document.getElementById("file-menu")!.classList.add("open");
      });
      const issues = await scanOverlap(page);
      const pair = issues.filter(
        (i) =>
          i.rule === "overlap" &&
          /Edit|New|Open|File/i.test(`${i.where} ${i.message}`),
      );
      assert.equal(
        pair.length,
        0,
        `open menu over a table must not overlap-flag that pair, got ${JSON.stringify(issues)}`,
      );
      assert.equal(
        issues.some((i) => i.rule === "zIndex" && /Edit/i.test(i.where ?? "")),
        false,
        `open menu must not zIndex-flag the table control, got ${JSON.stringify(issues)}`,
      );
    });
  });

  it("does not flag a sticky header covering a button", async () => {
    await withPage(html, async (page) => {
      const issues = await scanOverlap(page);
      assert.equal(
        issues.some((i) => i.rule === "zIndex" && /Save/i.test(i.where ?? "")),
        false,
        `sticky header covering Save is expected chrome, got ${JSON.stringify(issues)}`,
      );
    });
  });

  it("skips a centered dialog covering the page", async () => {
    await withPage(html, async (page) => {
      await page.evaluate(() => {
        document.getElementById("modal")!.classList.add("open");
      });
      const issues = await scanOverlap(page);
      const covered = issues.filter(
        (i) => i.rule === "zIndex" && /Save|Behind/i.test(i.where ?? ""),
      );
      assert.equal(
        covered.length,
        0,
        `centered dialog covering the page must skip zIndex, got ${JSON.stringify(issues)}`,
      );
    });
  });
});
