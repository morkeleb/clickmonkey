import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { promptQualityFull, promptRuns } from "../src/cli/prompt-runs.js";

describe("report prompts", () => {
  it("skips inquirer off a TTY and defaults to digest quality", async (t) => {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      t.skip("would open inquirer on a TTY");
      return;
    }
    assert.equal(await promptQualityFull(), false);
    assert.deepEqual(
      await promptRuns([
        { id: "run-a", dir: "/tmp/a", findingCount: 2 },
        { id: "run-b", dir: "/tmp/b", findingCount: 0 },
      ]),
      ["run-a"],
    );
  });
});
