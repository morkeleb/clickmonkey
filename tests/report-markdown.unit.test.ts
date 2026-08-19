import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeHtmlToken } from "../web/src/lib/html-escape.ts";
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
    const md = `### Pages with unique issues

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
