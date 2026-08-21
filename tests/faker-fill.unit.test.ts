import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakerFill, fillRuleId } from "../src/brains/faker-fill.js";
import { plausibleFill } from "../src/brains/unleash.js";
import { formatStep, parseLine } from "../src/schema/dsl.js";
import type { ShownField } from "../src/schema/view.js";

function field(partial: Partial<ShownField> & Pick<ShownField, "id">): ShownField {
  return { value: "", type: "text", ...partial };
}

describe("fill rule matching", () => {
  it("scores name, type, autocomplete, and html type to a faker kind", () => {
    assert.equal(fillRuleId(field({ id: "email", type: "email" })), "email");
    assert.equal(fillRuleId(field({ id: "contact", constraints: { autocomplete: "email" } })), "email");
    assert.equal(fillRuleId(field({ id: "user_name" })), "username");
    assert.equal(fillRuleId(field({ id: "firstName" })), "firstName");
    assert.equal(fillRuleId(field({ id: "last_name" })), "lastName");
    assert.equal(fillRuleId(field({ id: "name" })), "fullName");
    assert.equal(fillRuleId(field({ id: "company_name" })), "organization");
    assert.equal(fillRuleId(field({ id: "phone", constraints: { htmlType: "tel" } })), "phone");
    assert.equal(fillRuleId(field({ id: "zip" })), "zip");
    assert.equal(fillRuleId(field({ id: "qty", type: "number" })), "quantity");
    assert.equal(fillRuleId(field({ id: "password", type: "password" })), "password");
    assert.equal(fillRuleId(field({ id: "website" })), "url");
    assert.equal(fillRuleId(field({ id: "q" })), "search");
    assert.equal(fillRuleId(field({ id: "notes", type: "textarea" })), "textarea");
    assert.equal(fillRuleId(field({ id: "dob", label: "Date of birth" })), "birthdate");
    assert.equal(
      fillRuleId(field({ id: "card", constraints: { autocomplete: "cc-number" } })),
      "ccNumber",
    );
  });

  it("treats camel/kebab/concatenated names as a contained kind, even on type=text", () => {
    assert.equal(fillRuleId(field({ id: "salesPersonEmail", type: "text" })), "email");
    assert.equal(fillRuleId(field({ id: "user-email", type: "text" })), "email");
    assert.equal(fillRuleId(field({ id: "salespersonemail", type: "text" })), "email");
    assert.equal(fillRuleId(field({ id: "first", type: "text" })), "firstName");
    assert.equal(fillRuleId(field({ id: "ssn", type: "text" })), "ssn");
  });

  it("matches a same-length typo and does not turn estate into state", () => {
    assert.equal(fillRuleId(field({ id: "emial", type: "text" })), "email");
    assert.equal(fillRuleId(field({ id: "estate", type: "text" })), "text");
    assert.equal(fillRuleId(field({ id: "username", type: "text" })), "username");
    assert.equal(fillRuleId(field({ id: "company_name", type: "text" })), "organization");
  });
});

describe("fakerFill", () => {
  it("emits an example.com email and a non-x name", () => {
    const email = fakerFill(field({ id: "email", type: "email" }), () => 0.3);
    assert.match(email, /@example\./);
    assert.match(fakerFill(field({ id: "salesPersonEmail", type: "text" }), () => 0.3), /@example\./);
    const name = fakerFill(field({ id: "name" }), () => 0.3);
    assert.ok(name.length > 1);
    assert.notEqual(name, "x");
    const line = formatStep({ kind: "fill", surface: "page", id: "name", value: name });
    const parsed = parseLine(line);
    assert.ok(parsed && !("comment" in parsed) && parsed.kind === "fill");
    if (parsed.kind === "fill") assert.equal(parsed.value, name);
  });

  it("respects min/max on a number field", () => {
    const n = Number(
      fakerFill(field({ id: "qty", type: "number", constraints: { min: "2", max: "9" } }), () => 0),
    );
    assert.equal(n, 2);
    const hi = Number(
      fakerFill(field({ id: "qty", type: "number", constraints: { min: "2", max: "9" } }), () => 0.999),
    );
    assert.ok(hi >= 2 && hi <= 9);
  });

  it("respects maxlength and minlength", () => {
    const short = fakerFill(
      field({ id: "bio", type: "textarea", constraints: { maxLength: 8 } }),
      () => 0.4,
    );
    assert.ok(short.length <= 8, short);
    const padded = fakerFill(
      field({ id: "code", constraints: { minLength: 12, maxLength: 12 } }),
      () => 0.4,
    );
    assert.equal(padded.length, 12);
    const clamped = fakerFill(
      field({ id: "bio", type: "textarea", constraints: { minLength: 20, maxLength: 4 } }),
      () => 0.4,
    );
    assert.ok(clamped.length <= 4, clamped);
    const patterned = fakerFill(
      field({
        id: "qty",
        type: "number",
        constraints: { pattern: "2", min: "2", max: "2", minLength: 10 },
      }),
      () => 0,
    );
    assert.equal(patterned, "2");
  });

  it("varies across rng streams", () => {
    const a = fakerFill(field({ id: "name" }), () => 0.11);
    const b = fakerFill(field({ id: "name" }), () => 0.77);
    assert.notEqual(a, b);
  });
});

describe("plausibleFill + faker", () => {
  it("keeps native select on live options", () => {
    assert.equal(
      plausibleFill(
        {
          id: "addressType",
          value: "",
          type: "select",
          options: [
            { value: "", label: "Select type" },
            { value: "mailing", label: "Mailing" },
          ],
        },
        () => 0,
        false,
      ),
      "mailing",
    );
  });

  it("fills email via faker, not the old constant", () => {
    const value = plausibleFill({ id: "email", value: "", type: "email" }, () => 0.6, false);
    assert.match(value, /@example\./);
    assert.notEqual(value, "user@example.com");
  });
});
