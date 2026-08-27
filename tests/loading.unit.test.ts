import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blurbLooksLikeLoading,
  htmlLooksLikeLoading,
  readPageLoading,
  textIsLoadingPlaceholder,
} from "../src/surveyor/loading.js";

describe("blurbLooksLikeLoading", () => {
  it("drops the Filevine-style loading-screen caption", () => {
    assert.equal(
      blurbLooksLikeLoading("Loading screen for Filevine Finance app; waits for content to appear."),
      true,
    );
  });

  it("drops a prompt-following loading blurb without a real pane type", () => {
    assert.equal(blurbLooksLikeLoading("loading. Spinner occupying the main pane."), true);
    assert.equal(blurbLooksLikeLoading("Please wait"), true);
  });

  it("keeps a populated page caption, including Loading-dock names", () => {
    assert.equal(
      blurbLooksLikeLoading("Customers list with KPI cards and an empty table; primary action Add customer."),
      false,
    );
    assert.equal(
      blurbLooksLikeLoading("Ledger configuration with Active and Draft ledger cards."),
      false,
    );
    assert.equal(
      blurbLooksLikeLoading("Loading dock inventory list with a table of shipments."),
      false,
    );
  });
});

describe("textIsLoadingPlaceholder", () => {
  it("matches a wait string and ignores empty or real copy", () => {
    assert.equal(textIsLoadingPlaceholder("Loading…"), true);
    assert.equal(textIsLoadingPlaceholder("Please wait"), true);
    assert.equal(textIsLoadingPlaceholder(""), false);
    assert.equal(textIsLoadingPlaceholder("Ledger Configuration Seed Ledger Active"), false);
  });
});

describe("htmlLooksLikeLoading", () => {
  it("treats a busy main landmark as loading", () => {
    assert.equal(
      htmlLooksLikeLoading('<html><body><main aria-busy="true">Loading</main></body></html>'),
      true,
    );
    assert.equal(
      htmlLooksLikeLoading('<div role="main" aria-busy="true"><span>Loading</span></div>'),
      true,
    );
  });

  it("treats a spinner with almost no main copy as loading, not sidenav chrome", () => {
    const html = `
      <html><body>
        <nav>Overview Details Billing Ledger Reports</nav>
        <main><div class="spinner" role="progressbar"></div></main>
      </body></html>
    `;
    assert.equal(htmlLooksLikeLoading(html), true);
  });

  it("does not treat a populated ledger main as loading", () => {
    const html = `
      <html><body>
        <nav>Overview Details Billing Ledger</nav>
        <main>
          <h1>Ledger Configuration</h1>
          <p>Seed Ledger Active</p>
          <p>Main Ledger Draft</p>
          <button>Active</button>
        </main>
      </body></html>
    `;
    assert.equal(htmlLooksLikeLoading(html), false);
  });

  it("treats a heading plus CircularProgress as loading", () => {
    const html = `
      <html><body>
        <nav>Dashboard Trust Settings</nav>
        <main>
          <h1>Trust Settings</h1>
          <div class="MuiCircularProgress-root" role="progressbar"></div>
        </main>
      </body></html>
    `;
    assert.equal(htmlLooksLikeLoading(html), true);
  });

  it("does not treat a small spinner on a populated main as a loading screen", () => {
    const html = `
      <main>
        <h1>Ledger Configuration</h1>
        <p>Seed Ledger Active. Main Ledger Draft. Tabs for Overview Details Billing.</p>
        <div class="spinner" role="progressbar"></div>
      </main>
    `;
    assert.equal(htmlLooksLikeLoading(html), false);
  });
});

describe("readPageLoading", () => {
  function tree(opts: {
    busy?: "html" | "body" | "main";
    mainText?: string;
    spinner?: boolean;
    noMain?: boolean;
  }) {
    const doc: {
      documentElement: ReturnType<typeof el>;
      body: ReturnType<typeof el>;
      querySelector: (sel: string) => ReturnType<typeof el> | null;
    } = {
      documentElement: undefined as never,
      body: undefined as never,
      querySelector: (sel: string) => (/main/.test(sel) && !opts.noMain ? main : null),
    };
    function el(busy: boolean, text: string, isMain = false) {
      return {
        getAttribute: (name: string) => (name === "aria-busy" && busy ? "true" : null),
        innerText: text,
        querySelector: (sel: string) =>
          isMain && opts.spinner && /progressbar|spinner/i.test(sel) ? el(false, "") : null,
        ownerDocument: doc,
      };
    }
    const html = el(opts.busy === "html", "");
    const body = el(opts.busy === "body", opts.noMain ? (opts.mainText ?? "") : "");
    const main = el(opts.busy === "main", opts.mainText ?? "", true);
    doc.documentElement = html;
    doc.body = body;
    return html;
  }

  it("flags busy landmarks and a spinner in a short main", () => {
    assert.equal(readPageLoading(tree({ busy: "main", mainText: "Loading" })), true);
    assert.equal(readPageLoading(tree({ mainText: "Loading…" })), true);
    assert.equal(readPageLoading(tree({ mainText: "", spinner: true })), true);
  });

  it("does not flag a populated main", () => {
    assert.equal(
      readPageLoading(
        tree({
          mainText:
            "Ledger Configuration Seed Ledger Active Main Ledger Draft Overview Details Billing",
          spinner: true,
        }),
      ),
      false,
    );
  });
});
