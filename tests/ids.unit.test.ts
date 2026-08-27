import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isActiveTabsSurfaceId, mintedBase, stableAccName } from "../src/surveyor/ids.js";

describe("stableAccName", () => {
  it("strips the overflow tab count", () => {
    assert.equal(stableAccName("Active tabs: 1"), "Active tabs");
    assert.equal(stableAccName("Active tabs: 17"), "Active tabs");
    assert.equal(stableAccName("ACTIVE TABS: 3"), "Active tabs");
    assert.equal(stableAccName("  Active tabs: 12  "), "Active tabs");
  });

  it("treats count-suffixed surface ids as the same chrome", () => {
    assert.equal(isActiveTabsSurfaceId("active_tabs"), true);
    assert.equal(isActiveTabsSurfaceId("active_tabs_12"), true);
    assert.equal(isActiveTabsSurfaceId("create"), false);
  });

  it("leaves other names alone", () => {
    assert.equal(stableAccName("Settings"), "Settings");
    assert.equal(stableAccName("Inactive tabs: 1"), "Inactive tabs: 1");
  });
});

describe("mintedBase", () => {
  it("does not mint a count suffix for Active tabs", () => {
    const id = mintedBase({ by: "role", value: "button", name: "Active tabs: 16" });
    assert.match(id, /active_tabs/);
    assert.doesNotMatch(id, /__16/);
    assert.equal(id, "button_active_tabs");
  });
});
