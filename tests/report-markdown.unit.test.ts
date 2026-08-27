import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeHtmlToken } from "../web/src/lib/html-escape.ts";
import { wrapReportPrintBlocks, wrapShotFrames } from "../web/src/lib/wrap-report-blocks.ts";
import { marked } from "../web/node_modules/marked/lib/marked.esm.js";

describe("report markdown HTML tokens", () => {
  it("escapes <style> so later headings are not swallowed as CSS", () => {
    marked.use({
      renderer: {
        html(token: { text?: string } | string) {
          const text = typeof token === "string" ? token : (token.text ?? "");
          return escapeHtmlToken(text);
        },
      },
    });
    const md = `### Pages

- \`/designer\` — 1 error
  - \`element-permitted-content\` error — <style> element is not permitted as content under <div>
- \`/pipelines\` — 1 error
  - \`button-name\` error — Buttons must have discernible text

## Appendix

Source finding folders live under each run's \`findings/\` directory.
`;
    const html = marked.parse(md, { async: false }) as string;
    assert.match(html, /&lt;style&gt;/);
    assert.doesNotMatch(html, /<style>/);
    assert.match(html, /<h2[^>]*>Appendix<\/h2>/);
    assert.match(html, /\/pipelines/);
  });
});

describe("wrapShotFrames", () => {
  it("wraps each img in a reserved shot frame", () => {
    const html = wrapShotFrames("<p><img src='/files/runs/a/x.png' alt='shot'></p>");
    assert.equal(html, "<p><span class=\"shot-frame\"><img src='/files/runs/a/x.png' alt='shot'></span></p>");
  });
});

describe("wrapReportPrintBlocks", () => {
  it("wraps a finding heading with its screenshot, leaves the tape outside", () => {
    const html = wrapReportPrintBlocks(
      [
        "<h2>Critical</h2>",
        "<h3>HTTP 409</h3>",
        "<p>httpError</p>",
        "<blockquote>why</blockquote>",
        "<p><img src='shot.png'></p>",
        "<pre>open home</pre>",
        "<h3>Invalid time value</h3>",
        "<p>pageError</p>",
        "<pre>fill date</pre>",
      ].join(""),
    );
    assert.match(html, /<div class="report-card"><h3>HTTP 409<\/h3>/);
    assert.match(html, /<img src='shot.png'><\/p><\/div><pre>open home<\/pre>/);
    assert.match(html, /<div class="report-card"><h3>Invalid time value<\/h3>/);
    assert.equal((html.match(/class="report-card"/g) ?? []).length, 2);
  });

  it("does not wrap Quality digest headings, wraps page groups", () => {
    const html = wrapReportPrintBlocks(
      [
        "<h2>Quality</h2>",
        "<h3>Pages</h3>",
        "<h4><code>/vouchers</code></h4>",
        "<p>1 error</p>",
        "<ul><li>clip</li></ul>",
        "<h2>Appendix</h2>",
      ].join(""),
    );
    assert.doesNotMatch(html, /report-card"><h3>Pages/);
    assert.match(html, /<div class="report-subcard"><h4>/);
    assert.match(html, /<\/ul><\/div><h2>Appendix<\/h2>/);
  });

  it("does not wrap chapter h2s or digest h3s, still wraps finding h3s", () => {
    const html = wrapReportPrintBlocks(
      [
        "<h2>Summary</h2>",
        "<h3>Labels</h3>",
        "<p>T testability, A accessibility, V visual, Q quality.</p>",
        "<h3>Start here</h3>",
        "<ul><li>Fix color-contrast</li></ul>",
        "<h2>Findings</h2>",
        "<h2>Critical</h2>",
        "<h3>HTTP 409</h3>",
        "<p>httpError</p>",
        "<h2>Testability</h2>",
        "<h3>Chrome</h3>",
        "<ul><li>duplicateName</li></ul>",
        "<h2>Accessibility</h2>",
        "<h3>On several pages</h3>",
        "<ul><li>color-contrast</li></ul>",
        "<h2>Visual</h2>",
        "<h3>Pages</h3>",
        "<h4><code>/vouchers</code></h4>",
        "<p>overlap</p>",
        "<h2>Quality</h2>",
        "<h3>Chrome</h3>",
        "<ul><li>element-permitted-content</li></ul>",
        "<h2>By page</h2>",
        "<ul><li>/vouchers</li></ul>",
        "<h2>Appendix</h2>",
      ].join(""),
    );
    assert.doesNotMatch(html, /report-card"><h2>/);
    assert.doesNotMatch(html, /report-card"><h3>Labels/);
    assert.doesNotMatch(html, /report-card"><h3>Start here/);
    assert.doesNotMatch(html, /report-card"><h3>Chrome/);
    assert.doesNotMatch(html, /report-card"><h3>On several pages/);
    assert.doesNotMatch(html, /report-card"><h3>Pages/);
    assert.match(html, /<div class="report-card"><h3>HTTP 409<\/h3>/);
    assert.match(html, /<div class="report-subcard"><h4>/);
    assert.equal((html.match(/class="report-card"/g) ?? []).length, 1);
    for (const chapter of ["Testability", "Accessibility", "Visual", "Quality", "By page"]) {
      assert.match(html, new RegExp(`<h2>${chapter}</h2>`));
    }
  });
});
