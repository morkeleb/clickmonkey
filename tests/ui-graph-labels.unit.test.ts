import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prettyPageLabel, sectionKey } from "../src/ui/graph-labels.js";

describe("graph labels", () => {
  it("uses the last path segment as the title and the first as a kicker", () => {
    assert.deepEqual(prettyPageLabel("/accounts-payable/vendors", "accounts_payable_vendors"), {
      title: "Vendors",
      kicker: "Accounts Payable",
    });
    assert.deepEqual(prettyPageLabel("/", "home"), { title: "Home" });
    assert.deepEqual(prettyPageLabel("/login", "login"), { title: "Login" });
    assert.deepEqual(prettyPageLabel("/u/login", "u_login"), { title: "Login", kicker: "U" });
  });

  it("clusters by the first path segment", () => {
    assert.equal(sectionKey("/accounts-payable/vendors"), "accounts-payable");
    assert.equal(sectionKey("/accounts-payable/payments"), "accounts-payable");
    assert.equal(sectionKey("/settings"), "settings");
    assert.equal(sectionKey("/"), undefined);
  });
});
