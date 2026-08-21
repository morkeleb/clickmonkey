import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withRun } from "../src/executor/session.js";
import { pageLooksLikeLoading, waitOutLoading } from "../src/surveyor/loading.js";

describe("page loading wait", () => {
  it("sees a busy main as loading and a populated main as not", async () => {
    await withRun({}, async ({ page }) => {
      await page.setContent("<html><body><main aria-busy=\"true\">Loading</main></body></html>");
      assert.equal(await pageLooksLikeLoading(page), true);
      await page.setContent(
        "<html><body><main><h1>Ledger Configuration</h1><p>Seed Ledger Active Main Ledger Draft</p></main></body></html>",
      );
      assert.equal(await pageLooksLikeLoading(page), false);
    });
  });

  it("waits until aria-busy clears", async () => {
    await withRun({}, async ({ page }) => {
      await page.setContent(`<!DOCTYPE html><html><body>
        <main id="m" aria-busy="true">Loading</main>
        <script>
          setTimeout(() => {
            const m = document.getElementById("m");
            m.removeAttribute("aria-busy");
            m.textContent = "Ledger Configuration Seed Ledger Active";
          }, 200);
        </script>
      </body></html>`);
      const t0 = Date.now();
      await waitOutLoading(page, 1500);
      const waited = Date.now() - t0;
      assert.ok(waited >= 150, `expected to wait for busy to clear, waited ${waited}ms`);
      assert.ok(waited < 1200, `waited ${waited}ms`);
      assert.equal(await pageLooksLikeLoading(page), false);
    });
  });
});
