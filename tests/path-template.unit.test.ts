import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pageMatchesHref } from "../src/surveyor/ready.js";
import {
  ledgerPath,
  looksParametric,
  pathHasParams,
  templatizePath,
} from "../src/surveyor/path-template.js";
import { foldPathTemplates } from "../src/surveyor/merge.js";
import type { Page } from "../src/schema/page-model.js";

function page(id: string, path: string, extra: Partial<Page> = {}): Page {
  return {
    id,
    path,
    params: extra.params ?? [],
    ready: { by: "testId", value: id },
    surfaces: [
      {
        id: "page",
        kind: "page",
        fields: [],
        actions: extra.surfaces?.[0]?.actions ?? [
          { id: "go", by: "testId", value: "go", status: "ok", opens: extra.id },
        ],
      },
    ],
    ...extra,
  };
}

describe("templatizePath", () => {
  it("turns a customer migrations URL into /customers/:id1/migrations", () => {
    const t = templatizePath("/customers/b43e460d-4619-4e45-88ed-7791a8cb07fa/migrations");
    assert.equal(t.path, "/customers/:id1/migrations");
    assert.deepEqual(t.params, ["id1"]);
    assert.equal(ledgerPath("/customers/b43e460d-4619-4e45-88ed-7791a8cb07fa/migrations"), "/customers/:id1/migrations");
  });

  it("names two slots id1 and id2", () => {
    const t = templatizePath(
      "/orgs/11111111-1111-4111-8111-111111111111/projects/22222222-2222-4222-8222-222222222222",
    );
    assert.equal(t.path, "/orgs/:id1/projects/:id2");
    assert.deepEqual(t.params, ["id1", "id2"]);
  });

  it("does not templatize vocabulary segments", () => {
    const t = templatizePath("/settings/profile");
    assert.equal(t.path, "/settings/profile");
    assert.deepEqual(t.params, []);
  });

  it("leaves a lone token path alone", () => {
    const t = templatizePath("/b43e460d-4619-4e45-88ed-7791a8cb07fa");
    assert.equal(t.path, "/b43e460d-4619-4e45-88ed-7791a8cb07fa");
    assert.deepEqual(t.params, []);
  });
});

describe("looksParametric", () => {
  it("accepts uuids and mixed tokens, not migrations", () => {
    assert.equal(looksParametric("b43e460d-4619-4e45-88ed-7791a8cb07fa"), true);
    assert.equal(looksParametric("migrations"), false);
    assert.equal(looksParametric("profile"), false);
    assert.equal(looksParametric("42"), false);
    assert.equal(looksParametric("1001"), true);
  });
});

describe("foldPathTemplates", () => {
  it("merges two UUID customer migration pages onto one template", () => {
    const a = page("customers_aaa_migrations", "/customers/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/migrations");
    a.surfaces[0]!.actions = [
      { id: "edit", by: "testId", value: "edit", status: "ok", opens: "customers_aaa_migrations" },
    ];
    const b = page("customers_bbb_migrations", "/customers/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/migrations");
    const folded = foldPathTemplates([a, b]);
    assert.equal(folded.length, 1);
    assert.equal(folded[0]!.path, "/customers/:id1/migrations");
    assert.deepEqual(folded[0]!.params, ["id1"]);
    assert.equal(folded[0]!.id, "customers_id1_migrations");
    assert.equal(folded[0]!.surfaces[0]!.actions[0]!.opens, "customers_id1_migrations");
  });
});

describe("pageMatchesHref templates", () => {
  it("matches a live UUID URL to /customers/:id1/migrations", () => {
    const p = { path: "/customers/:id1/migrations", params: ["id1"] };
    assert.equal(
      pageMatchesHref(p, "https://app.example.com/customers/b43e460d-4619-4e45-88ed-7791a8cb07fa/migrations", "https://app.example.com"),
      true,
    );
    assert.equal(pathHasParams(p), true);
  });
});
