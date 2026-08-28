#!/usr/bin/env node
/**
 * Local stand-in for GitHub Pages (docs/ + Jekyll permalinks + baseurl).
 * Not Jekyll: same paths as docs/_config.yml so a soak of this tree matches
 * https://morkeleb.github.io/clickmonkey/ . Use PAGES_URL for the live site.
 */
import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const docsDir = join(root, "docs");
const host = "127.0.0.1";
const port = Number(process.env.PAGES_PORT ?? 4175);

function readYamlSimple(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function parseFrontMatter(text) {
  if (!text.startsWith("---")) return { attrs: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { attrs: {}, body: text };
  const attrs = readYamlSimple(text.slice(4, end));
  const body = text.slice(end + 4).replace(/^\s*\n/, "");
  return { attrs, body };
}

function walkMarkdown(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkMarkdown(p, acc);
    else if (name.endsWith(".md")) acc.push(p);
  }
  return acc;
}

function normalizePermalink(raw, file) {
  if (raw && raw.startsWith("/")) {
    return raw.endsWith("/") || raw === "/" ? raw : `${raw}/`;
  }
  const rel = relative(docsDir, file).replaceAll(sep, "/").replace(/\.md$/i, "");
  if (rel === "index") return "/";
  const trimmed = rel.replace(/\/index$/i, "");
  return `/${trimmed}/`;
}

async function loadMarked() {
  const esm = join(root, "web", "node_modules", "marked", "lib", "marked.esm.js");
  if (!existsSync(esm)) {
    throw new Error(
      "marked is not installed (npm install --prefix web). Or set PAGES_URL to the live GitHub Pages site.",
    );
  }
  const mod = await import(pathToFileURL(esm).href);
  const marked = mod.marked ?? mod.default;
  marked.use({ gfm: true });
  return marked;
}

const cfg = existsSync(join(docsDir, "_config.yml"))
  ? readYamlSimple(readFileSync(join(docsDir, "_config.yml"), "utf8"))
  : {};
const baseurl = (cfg.baseurl || "/clickmonkey").replace(/\/$/, "");

const files = walkMarkdown(docsDir);
const byPermalink = new Map();
const byFile = new Map();
for (const file of files) {
  const { attrs, body } = parseFrontMatter(readFileSync(file, "utf8"));
  const permalink = normalizePermalink(attrs.permalink, file);
  const page = { file, title: attrs.title || permalink, body, permalink };
  byPermalink.set(permalink, page);
  byFile.set(resolve(file), page);
}

function rewriteMdHrefs(md, fromFile) {
  return md.replace(/\]\(([^)\s]+)\)/g, (full, href) => {
    if (/^[a-z]+:/i.test(href) || href.startsWith("#") || href.startsWith("/")) {
      return full;
    }
    const hash = href.includes("#") ? href.slice(href.indexOf("#")) : "";
    const pathPart = hash ? href.slice(0, href.indexOf("#")) : href;
    if (!pathPart.toLowerCase().endsWith(".md")) return full;
    const target = resolve(dirname(fromFile), pathPart);
    const page = byFile.get(target);
    if (!page) return full;
    return `](${baseurl}${page.permalink}${hash})`;
  });
}

function pageHtml(page, html, origin) {
  const canonical = `${origin}${baseurl}${page.permalink}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(page.title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <style>
    :root { color-scheme: light; }
    body { font: 16px/1.5 system-ui, sans-serif; margin: 0; color: #1a1a1a; background: #fff; }
    header { border-bottom: 1px solid #ccc; padding: 0.75rem 1.25rem; }
    nav a { margin-right: 1rem; }
    main { max-width: 52rem; margin: 0 auto; padding: 1.25rem; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #888; padding: 0.35rem 0.5rem; text-align: left; }
    pre { overflow: auto; padding: 0.75rem; background: #f4f4f4; }
    code { font-family: ui-monospace, monospace; }
    a { color: #063; }
  </style>
</head>
<body>
  <header>
    <nav aria-label="Docs">
      <a href="${baseurl}/">ClickMonkey</a>
      <a href="${baseurl}/findings/">Findings</a>
      <a href="${baseurl}/map/">Map</a>
      <a href="${baseurl}/walkers/">Walkers</a>
    </nav>
  </header>
  <main>
${html}
  </main>
</body>
</html>
`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function lookup(pathname) {
  let path = pathname;
  if (baseurl && (path === baseurl || path.startsWith(`${baseurl}/`))) {
    path = path.slice(baseurl.length) || "/";
  } else if (baseurl && path !== "/") {
    return { kind: "outside" };
  }
  if (path !== "/" && !path.endsWith("/")) {
    return { kind: "slash", location: `${baseurl}${path}/` };
  }
  const page = byPermalink.get(path);
  if (!page) return { kind: "miss" };
  return { kind: "page", page };
}

const marked = await loadMarked();

const server = createServer((req, res) => {
  void handle(req, res);
});

async function handle(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }
  if (pathname === "/") {
    res.writeHead(302, { Location: `${baseurl}/` });
    res.end();
    return;
  }
  const hit = lookup(pathname);
  if (hit.kind === "slash") {
    res.writeHead(301, { Location: hit.location });
    res.end();
    return;
  }
  if (hit.kind !== "page") {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const md = rewriteMdHrefs(hit.page.body, hit.page.file);
  const parsed = marked.parse(md, { async: false });
  const body = typeof parsed === "string" ? parsed : await parsed;
  const hostHeader = req.headers.host ?? `${host}:${port}`;
  const html = pageHtml(hit.page, body, `http://${hostHeader}`);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

server.listen(port, host, () => {
  const addr = server.address();
  const bound = typeof addr === "object" && addr ? addr.port : port;
  process.stdout.write(`http://${host}:${bound}${baseurl}/\n`);
});
