import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactLog,
  hoppedStepIndexes,
  introPrefixLength,
  matchingIntroLength,
  replayableSteps,
} from "../src/playbooks/compact.js";
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

  it("does not treat open + $ENV fill as intro", () => {
    const log = parseLog(`open home
fill page.matter $CLICKMONKEY_USER
click page.save
`);
    assert.equal(introPrefixLength(log.steps), 0);
    const compacted = compactLog(log);
    assert.equal(compacted.steps.length, 3);
    assert.ok(compacted.steps.some((s) => s.kind === "fill" && s.value === "$CLICKMONKEY_USER"));
  });

  it("drops wander before a hopped nav-landmark click", () => {
    const log = parseLog(`fill page.q "x"
click page.search
click page.settings nav
fill page.name "y"
click page.save
`);
    const compacted = compactLog(log, { hopped: new Set([2]) });
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

  it("keeps fills before a nav click that did not hop", () => {
    const log = parseLog(`fill page.q "x"
click page.account nav
fill page.name "y"
click page.save
`);
    const compacted = compactLog(log);
    assert.equal(compacted.steps.length, 4);
    assert.ok(compacted.steps.some((s) => s.kind === "fill" && s.id === "q"));
  });

  it("keeps from the later of last open and last hopped nav click", () => {
    const log = parseLog(`open home
click page.projects nav
fill page.title "x"
click page.save
`);
    const compacted = compactLog(log, { hopped: new Set([1]) });
    assert.equal(compacted.steps.length, 3);
    assert.equal(compacted.steps[0]?.kind, "click");
    if (compacted.steps[0]?.kind === "click") assert.equal(compacted.steps[0].id, "projects");
  });
});

describe("replayableSteps", () => {
  it("strips only a prefix that matches config intro", () => {
    const log = parseLog(`click page.auth0_login_button
fill page.username $CLICKMONKEY_USER
fill page.password $CLICKMONKEY_PASSWORD
click page.button_continue
click page.go
`);
    const intro = [
      "click page.auth0_login_button",
      "fill page.username $CLICKMONKEY_USER",
      "fill page.password $CLICKMONKEY_PASSWORD",
      "click page.button_continue",
    ];
    assert.equal(matchingIntroLength(log.steps, intro), 4);
    const steps = replayableSteps(log.steps, intro);
    assert.equal(steps.length, 1);
    assert.equal(steps[0]?.kind, "click");
    if (steps[0]?.kind === "click") assert.equal(steps[0].id, "go");
  });

  it("keeps a post-landing tape that uses $ENV as data", () => {
    const log = parseLog(`open home
fill page.matter $CLICKMONKEY_USER
click page.save
`);
    const intro = [
      "click page.auth0_login_button",
      "fill page.username $CLICKMONKEY_USER",
      "click page.button_continue",
    ];
    const steps = replayableSteps(log.steps, intro);
    assert.equal(steps.length, 3);
    assert.equal(steps[0]?.kind, "open");
  });
});

describe("hoppedStepIndexes", () => {
  it("marks a step whose window contains a URL change", () => {
    const hopped = hoppedStepIndexes(
      [
        JSON.stringify({ type: "step", line: "click page.go", pageId: "home" }),
        JSON.stringify({ type: "nav", from: "https://app.example/", to: "https://app.example/settings", via: "commit" }),
        JSON.stringify({ type: "stepDone", line: "click page.go", ok: true, ms: 10 }),
        JSON.stringify({ type: "step", line: "click page.account", pageId: "settings" }),
        JSON.stringify({ type: "stepDone", line: "click page.account", ok: true, ms: 5 }),
      ].join("\n"),
    );
    assert.deepEqual([...hopped], [0]);
  });
});
