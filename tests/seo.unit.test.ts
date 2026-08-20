import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { issuesFromMeta, scanSeo, seoIsPrivate, type PageMeta } from "../src/surveyor/seo.js";

function meta(partial: Partial<PageMeta> = {}): PageMeta {
  return {
    title: "About us",
    description: "We build tools for legal teams who migrate data.",
    robots: "",
    ogTitle: "About us",
    ogDescription: "We build tools for legal teams who migrate data.",
    ogImage: "https://example.com/og.png",
    ogUrl: "https://example.com/about",
    canonical: "https://example.com/about",
    ...partial,
  };
}

describe("seoIsPrivate", () => {
  it("treats missing seo config as all-private", () => {
    assert.equal(seoIsPrivate("/", undefined), true);
    assert.equal(seoIsPrivate("/docs", undefined), true);
  });

  it("uses / to disable every page", () => {
    assert.equal(seoIsPrivate("/", { private: ["/"] }), true);
    assert.equal(seoIsPrivate("/docs", { private: ["/"] }), true);
  });

  it("skips /app and children but not /application", () => {
    const seo = { private: ["/app"] };
    assert.equal(seoIsPrivate("/app", seo), true);
    assert.equal(seoIsPrivate("/app/customers", seo), true);
    assert.equal(seoIsPrivate("/", seo), false);
    assert.equal(seoIsPrivate("/docs", seo), false);
    assert.equal(seoIsPrivate("/application", seo), false);
  });

  it("empty private list scans every path", () => {
    assert.equal(seoIsPrivate("/app", { private: [] }), false);
  });
});

describe("issuesFromMeta", () => {
  it("is silent when robots says noindex", () => {
    assert.deepEqual(issuesFromMeta(meta({ robots: "noindex, nofollow" }), "https://example.com/about"), []);
  });

  it("flags missing description and OG on an otherwise titled page", () => {
    const issues = issuesFromMeta(
      meta({
        description: "",
        ogTitle: "",
        ogDescription: "",
        ogImage: "",
        ogUrl: "",
        canonical: "",
      }),
      "https://example.com/about",
    );
    const rules = issues.map((i) => i.rule);
    assert.ok(rules.includes("meta-description"));
    assert.ok(rules.includes("og-title"));
    assert.ok(rules.includes("og-image"));
    assert.ok(rules.includes("canonical"));
    assert.equal(issues.some((i) => i.rule === "document-title"), false);
  });

  it("flags placeholder titles and relative og:image", () => {
    const issues = issuesFromMeta(
      meta({ title: "Create Next App", ogImage: "/og.png" }),
      "https://example.com/",
    );
    assert.ok(issues.some((i) => i.rule === "document-title-placeholder"));
    assert.ok(issues.some((i) => i.rule === "og-image-relative"));
  });

  it("accepts a complete public head", () => {
    assert.equal(issuesFromMeta(meta(), "https://example.com/about").length, 0);
  });
});

describe("scanSeo", () => {
  it("returns undefined when the meta read fails, not an empty clean page", async () => {
    const page = {
      url: () => "https://example.com/about",
      evaluate: async () => {
        throw new Error("execution context destroyed");
      },
    };
    assert.equal(await scanSeo(page as never), undefined);
  });
});
