import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanLayout } from "../src/surveyor/layout.js";
import { withPage } from "./helpers/with-page.js";

const sparse = fileURLToPath(new URL("../fixtures/sites/sparse/index.html", import.meta.url));
const overflow = fileURLToPath(new URL("../fixtures/sites/overflow/index.html", import.meta.url));
const broken = fileURLToPath(new URL("../fixtures/sites/broken-images/index.html", import.meta.url));

describe("scanLayout", () => {
  it("runs sparse, overflow, and broken together", async () => {
    await withPage(sparse, async (page) => {
      const issues = await scanLayout(page);
      assert.ok(
        issues.some((i) => i.rule === "sparse"),
        `expected sparse, got ${JSON.stringify(issues.map((i) => i.rule))}`,
      );
    });
    await withPage(overflow, async (page) => {
      const issues = await scanLayout(page);
      assert.ok(
        issues.some((i) => i.rule === "overflow"),
        `expected overflow, got ${JSON.stringify(issues.map((i) => i.rule))}`,
      );
    });
    await withPage(broken, async (page) => {
      const issues = await scanLayout(page);
      assert.ok(
        issues.some((i) => i.rule === "broken"),
        `expected broken, got ${JSON.stringify(issues.map((i) => i.rule))}`,
      );
    });
  });
});
