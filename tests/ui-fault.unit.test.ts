import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { formatUiFault, sourceNewerThanStarted } from "../src/ui/fault.js";

describe("formatUiFault", () => {
  it("leads with a restart hint and keeps zod issues in detail", () => {
    const err = {
      issues: [
        {
          code: "unrecognized_keys",
          keys: ["where"],
          path: ["pages", 0, "issues", 0],
          message: 'Unrecognized key: "where"',
        },
      ],
    };
    const fault = formatUiFault(err);
    assert.equal(fault.error, true);
    assert.match(fault.message, /where/);
    assert.match(fault.message, /pages\.0\.issues\.0/);
    assert.match(fault.hint, /clickmonkey ui --port 4174/);
    assert.match(fault.copy, /^UI snapshot failed/m);
    assert.match(fault.copy, /Hard-refresh/);
    assert.match(fault.copy, /Unrecognized key/);
    assert.ok(fault.copy.startsWith("UI snapshot failed"));
  });
});

describe("sourceNewerThanStarted", () => {
  it("is true when src is newer than the process start", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-ui-stale-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.ts"), "export {}\n");
    assert.equal(sourceNewerThanStarted(Date.now() + 60_000, root), false);
    assert.equal(sourceNewerThanStarted(Date.now() - 60_000, root), true);
  });
});
