import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractClickmonkeyFences, isFindingsReport, wrapClickmonkeyFence } from "../src/reports/fences.js";
import { parseLog } from "../src/schema/dsl.js";

describe("clickmonkey fences", () => {
  it("extracts titled fences and ignores empty ones", () => {
    const md = `# Findings

## Empty name accepted

Something happened.

\`\`\`clickmonkey
# bug: empty name is accepted
open home
fill create.name ""
click create.submit
expect create.name invalid
\`\`\`

## Other

\`\`\`javascript
console.log(1)
\`\`\`

\`\`\`clickmonkey

\`\`\`
`;
    assert.equal(isFindingsReport(md), true);
    assert.equal(
      isFindingsReport("# Findings report\n\n_No findings in the selected runs._\n"),
      true,
    );
    assert.equal(isFindingsReport("open home\nclick page.x\n"), false);
    const fences = extractClickmonkeyFences(md);
    assert.equal(fences.length, 1);
    assert.equal(fences[0]?.title, "Empty name accepted");
    assert.equal(fences[0]?.log.bug, "empty name is accepted");
    assert.equal(fences[0]?.log.steps[0]?.kind, "open");
  });

  it("captures the screenshot href in the same section as the fence", () => {
    const md = `### Overlap

![screenshot](runs/a/findings/fnd_1/screenshot.png)

\`\`\`clickmonkey
screenshot ui overlap
\`\`\`
`;
    const fences = extractClickmonkeyFences(md);
    assert.equal(fences[0]?.image, "runs/a/findings/fnd_1/screenshot.png");
  });

  it("extracts fences from CRLF reports", () => {
    const md = "# Findings report\r\n\r\n### Empty name\r\n\r\n```clickmonkey\r\nopen home\r\nexpect create.name invalid\r\n```\r\n";
    assert.equal(isFindingsReport(md), true);
    const fences = extractClickmonkeyFences(md);
    assert.equal(fences.length, 1);
    assert.equal(fences[0]?.title, "Empty name");
    assert.equal(fences[0]?.log.steps[0]?.kind, "open");
  });

  it("wrapClickmonkeyFence round-trips a log", () => {
    const log = parseLog("# bug: x\nopen home\n");
    const md = wrapClickmonkeyFence(log);
    assert.match(md, /```clickmonkey/);
    assert.equal(extractClickmonkeyFences(md)[0]?.log.bug, "x");
  });
});
