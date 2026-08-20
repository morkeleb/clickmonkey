import type { Page } from "playwright";
import { pathPrefixMatch } from "../executor/fence.js";
import type { SeoConfig } from "../schema/config.js";
import { mergeQualityIssues, type QualityIssue } from "../schema/quality.js";

const TITLE_MAX = 60;
const DESC_MIN = 20;
const DESC_MAX = 160;
const PLACEHOLDER_TITLE =
  /^(create next app|vite(?: \+ react)?(?: app)?|react app|document)$/i;

export type PageMeta = {
  title: string;
  description: string;
  robots: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  ogUrl: string;
  canonical: string;
};

export function seoIsPrivate(pathname: string, seo?: SeoConfig): boolean {
  if (!seo) return true;
  const prefixes = seo.private ?? [];
  return prefixes.some((pre) => pathPrefixMatch(pathname, pre));
}

function isAbsoluteHttp(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function robotsNoindex(robots: string): boolean {
  return robots.split(/[,;]/).some((part) => part.trim().toLowerCase() === "noindex");
}

function issue(
  rule: string,
  message: string,
  where: string,
  severity: "error" | "warning" = "error",
): QualityIssue {
  return { source: "seo", rule, severity, message, count: 1, where };
}

/** Pure. `pageUrl` is the live href (for absolute og:url / canonical checks). */
export function issuesFromMeta(meta: PageMeta, pageUrl: string): QualityIssue[] {
  if (robotsNoindex(meta.robots)) return [];
  const out: QualityIssue[] = [];
  const title = meta.title.trim();
  if (!title) {
    out.push(issue("document-title", "Page has no document title", "title"));
  } else if (PLACEHOLDER_TITLE.test(title)) {
    out.push(issue("document-title-placeholder", `Title looks like a framework default (${title})`, "title"));
  } else if (title.length > TITLE_MAX) {
    out.push(
      issue("document-title-long", `Title is ${title.length} characters (keep under ${TITLE_MAX})`, "title", "warning"),
    );
  }

  const description = meta.description.trim();
  if (!description) {
    out.push(issue("meta-description", "Missing meta description", 'meta[name="description"]'));
  } else if (title && description.toLowerCase() === title.toLowerCase()) {
    out.push(
      issue("meta-description-same", "Meta description repeats the title", 'meta[name="description"]', "warning"),
    );
  } else if (description.length < DESC_MIN) {
    out.push(
      issue(
        "meta-description-short",
        `Meta description is ${description.length} characters (aim for ${DESC_MIN}–${DESC_MAX})`,
        'meta[name="description"]',
        "warning",
      ),
    );
  } else if (description.length > DESC_MAX) {
    out.push(
      issue(
        "meta-description-long",
        `Meta description is ${description.length} characters (aim for ${DESC_MIN}–${DESC_MAX})`,
        'meta[name="description"]',
        "warning",
      ),
    );
  }

  if (!meta.ogTitle.trim()) {
    out.push(issue("og-title", "Missing og:title", 'meta[property="og:title"]'));
  }
  if (!meta.ogDescription.trim()) {
    out.push(issue("og-description", "Missing og:description", 'meta[property="og:description"]'));
  }
  const ogImage = meta.ogImage.trim();
  if (!ogImage) {
    out.push(issue("og-image", "Missing og:image", 'meta[property="og:image"]'));
  } else if (!isAbsoluteHttp(ogImage)) {
    out.push(issue("og-image-relative", "og:image must be an absolute http(s) URL", 'meta[property="og:image"]'));
  }
  const ogUrl = meta.ogUrl.trim();
  if (!ogUrl) {
    out.push(issue("og-url", "Missing og:url", 'meta[property="og:url"]'));
  } else if (!isAbsoluteHttp(ogUrl)) {
    out.push(issue("og-url-relative", "og:url must be an absolute http(s) URL", 'meta[property="og:url"]'));
  }

  const canonical = meta.canonical.trim();
  if (!canonical) {
    out.push(issue("canonical", "Missing rel=canonical", 'link[rel="canonical"]', "warning"));
  } else if (!isAbsoluteHttp(canonical)) {
    out.push(issue("canonical-relative", "Canonical URL must be absolute http(s)", 'link[rel="canonical"]'));
  } else {
    try {
      const live = new URL(pageUrl);
      const canon = new URL(canonical);
      if (canon.origin !== live.origin) {
        out.push(
          issue(
            "canonical-origin",
            `Canonical points at ${canon.origin}, not this origin`,
            'link[rel="canonical"]',
            "warning",
          ),
        );
      }
    } catch {
      /* live url parse failed — skip origin check */
    }
  }

  return mergeQualityIssues(out);
}

const READ_META_SRC = `
var attr = function (sel, name) {
  var el = document.head ? document.head.querySelector(sel) : null;
  var v = el ? el.getAttribute(name) : "";
  return (v || "").trim();
};
var og = function (property) {
  return attr('meta[property="' + property + '"]', "content") || attr('meta[name="' + property + '"]', "content");
};
var robots = [attr('meta[name="robots"]', "content"), attr('meta[name="googlebot"]', "content")]
  .filter(Boolean)
  .join(", ");
return {
  title: document.title || "",
  description: attr('meta[name="description"]', "content"),
  robots: robots,
  ogTitle: og("og:title"),
  ogDescription: og("og:description"),
  ogImage: og("og:image"),
  ogUrl: og("og:url"),
  canonical: attr('link[rel="canonical"]', "href")
};
`;

async function readMeta(page: Page): Promise<PageMeta> {
  return page.evaluate((src) => new Function(src)(), READ_META_SRC) as Promise<PageMeta>;
}

/** `undefined` means the meta read failed — not “this page is clean.” */
export async function scanSeo(page: Page): Promise<QualityIssue[] | undefined> {
  try {
    const meta = await readMeta(page);
    return issuesFromMeta(meta, page.url());
  } catch {
    return undefined;
  }
}
