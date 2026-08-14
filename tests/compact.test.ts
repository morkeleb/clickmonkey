import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compactLog } from "../src/playbooks/compact.js";
import { parseLog, formatLog } from "../src/schema/dsl.js";

describe("compactLog", () => {
  it("drops wander clicks before the last open and keeps the bug header", () => {
    const log = parseLog(`# bug: empty name is accepted on create
# found: 2026-08-14
# note: first pass

click page.wander
click page.other
open home
fill createDialog.name ""
click createDialog.submit
expect createDialog.name invalid
`);
    const compacted = compactLog(log);
    assert.equal(compacted.bug, "empty name is accepted on create");
    assert.equal(compacted.found, "2026-08-14");
    assert.deepEqual(compacted.comments, ["note: first pass"]);
    assert.equal(compacted.steps[0]?.kind, "open");
    if (compacted.steps[0]?.kind === "open") assert.equal(compacted.steps[0].page, "home");
    assert.equal(compacted.steps.length, 4);
    const text = formatLog(compacted);
    assert.match(text, /^# bug: empty name is accepted on create/m);
    assert.match(text, /^# found: 2026-08-14/m);
    assert.doesNotMatch(text, /click page\.wander/);
    assert.match(text, /^open home$/m);
    assert.match(text, /expect createDialog\.name invalid/);
  });
});
