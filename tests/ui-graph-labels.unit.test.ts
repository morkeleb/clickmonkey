import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prettyIdent, prettyLeadingIdent, prettyPageLabel, sectionKey } from "../src/ui/graph-labels.js";

describe("graph labels", () => {
  it("uses the last path segment as the title and the first as a kicker", () => {
    assert.deepEqual(prettyPageLabel("/accounts-payable/vendors", "accounts_payable_vendors"), {
      title: "Vendors",
      kicker: "Accounts Payable",
    });
    assert.deepEqual(prettyPageLabel("/", "home"), { title: "Home" });
    assert.deepEqual(prettyPageLabel("/login", "login"), { title: "Login" });
    assert.deepEqual(prettyPageLabel("/u/login", "u_login"), { title: "Login", kicker: "U" });
    assert.deepEqual(prettyPageLabel("/customers/:id1/migrations", "customers_id1_migrations"), {
      title: "Migrations",
      kicker: "Customers",
    });
  });

  it("splits camelCase and kebab-case ids into words", () => {
    assert.equal(prettyIdent("visualIssue"), "Visual Issue");
    assert.equal(prettyIdent("expectFailed"), "Expect Failed");
    assert.equal(prettyIdent("implicitSubmit"), "Implicit Submit");
    assert.equal(prettyIdent("nested-interactive"), "Nested Interactive");
    assert.equal(prettyIdent("uiIssue"), "UI Issue");
    assert.equal(prettyIdent("httpError"), "HTTP Error");
    assert.equal(prettyIdent("overlap"), "Overlap");
    assert.equal(prettyLeadingIdent("implicitSubmit: Button Cancel has no type"), "Implicit Submit: Button Cancel has no type");
    assert.equal(prettyLeadingIdent("overlap: two controls collide"), "overlap: two controls collide");
  });

  it("clusters by the first path segment", () => {
    assert.equal(sectionKey("/accounts-payable/vendors"), "accounts-payable");
    assert.equal(sectionKey("/accounts-payable/payments"), "accounts-payable");
    assert.equal(sectionKey("/settings"), "settings");
    assert.equal(sectionKey("/"), undefined);
  });
});
