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

  it("drops leash intro and keeps fills on the path from landing", () => {
    const log = parseLog(`click page.auth0_login_button
fill page.username $CLICKMONKEY_USER
fill page.password $CLICKMONKEY_PASSWORD
click page.button_continue
click page.open_form
fill page.amount "1"
click page.go
`);
    const compacted = compactLog(log);
    assert.equal(compacted.steps.length, 3);
    assert.equal(
      compacted.steps.some((s) => s.kind === "fill" && s.value === "$CLICKMONKEY_USER"),
      false,
    );
    assert.ok(compacted.steps.some((s) => s.kind === "fill" && s.id === "amount"));
    assert.ok(compacted.steps.some((s) => s.kind === "click" && s.id === "open_form"));
  });

  it("drops wander before the last nav-landmark click", () => {
    const log = parseLog(`fill page.q "x"
click page.search
click page.settings nav
fill page.name "y"
click page.save
`);
    const compacted = compactLog(log);
    assert.equal(compacted.steps.length, 3);
    assert.equal(compacted.steps[0]?.kind, "click");
    if (compacted.steps[0]?.kind === "click") {
      assert.equal(compacted.steps[0].id, "settings");
      assert.equal(compacted.steps[0].nav, true);
    }
    assert.ok(compacted.steps.some((s) => s.kind === "fill" && s.id === "name"));
    assert.equal(
      compacted.steps.some((s) => s.kind === "fill" && s.id === "q"),
      false,
    );
  });

  it("keeps from the later of last open and last nav click", () => {
    const log = parseLog(`open home
click page.projects nav
fill page.title "x"
click page.save
`);
    const compacted = compactLog(log);
    assert.equal(compacted.steps.length, 3);
    assert.equal(compacted.steps[0]?.kind, "click");
    if (compacted.steps[0]?.kind === "click") assert.equal(compacted.steps[0].id, "projects");
  });
});
