#!/usr/bin/env node
/**
 * scripts/check-budgets.mjs — stage 6 of the build pipeline (PLAN §1.2, §10.7).
 *
 * The hard budget gate. Runs LAST so it measures the artefact that ships
 * (`_site/`). Any rule that cannot be evaluated because its inputs do not
 * exist yet (mid-Phase-1, when parallel agents are still landing files) is
 * reported as SKIP with a reason — a gate that passes silently while blind
 * is the failure mode this script is designed to avoid, so every SKIP is
 * visible in the output.
 *
 * Rules (PLAN §10.7):
 *   B1  css gzip <= 15,360 bytes                    (fail)
 *   B2  exactly one _site/assets/main.<8hex>.css    (fail)
 *   B3  client-JS allow-list                         (fail)
 *   B4  file count warn >=15k / fail >=19k; <25MiB  (warn/fail)
 *   B5  no file > 1MiB outside /pagefind/            (warn)
 *   B6  indexable pages: one self-canonical          (fail)
 *   B7  noindex pages: zero canonicals; indexable:   (fail)
 *       one h1, title, meta description
 *   B8  no <img> from own origin; no r2.dev          (fail)
 *   B9  external hosts only the 3-allow-list         (fail)
 *   B10 _site/_headers hash matches theme-init bytes (fail)
 *   B11 <3-post tag pages: noindex,follow, no        (fail)
 *       canonical, not in sitemap
 *   B12 >=3-post tag pages: canonical + sitemap      (fail)
 *   B13 no URL contains \d{4}/\d{2}/\d{2}            (fail)
 *   B14 every ld+json block parses, is non-empty,   (fail)
 *       and contains no HowTo/FAQPage/SearchAction
 *   B15 any single HTML page <= 100 KiB gzipped      (warn)
 *   B16 inline theme-init script <= 400 bytes        (fail)
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadPosts, readTagRegistry } from "./validate-content.mjs";
import { parseFrontMatter } from "./lib/frontmatter.mjs";
import { stripDatePrefix } from "./lib/slug.mjs";

const repoRoot = path.join(fileURLToPath(new URL("../", import.meta.url)));
const siteDir = path.join(repoRoot, "_site");

const CSS_GZIP_BUDGET = 15_360; // B1 (PLAN §10.2)
const FILE_COUNT_WARN = 15_000; // B4 (PLAN §10.2)
const FILE_COUNT_FAIL = 19_000; // B4 — deliberately below the 20,000 Pages cap (R5)
const MAX_FILE_SIZE = 25 * 1024 * 1024; // B4 (PLAN §10.6)
const LARGE_FILE_WARN = 1024 * 1024; // B5
const HTML_PAGE_GZIP_WARN = 100 * 1024; // B15 (PLAN §10.2 — "any single HTML page <= 100 KB gzipped", warn)
const THEME_INIT_MAX_BYTES = 400; // B16 (PLAN §10.7 allow-list row 1)

/** PLAN §10.7 allow-list — the complete client-JS surface. No 6th entry without a §6.4 row + owner approval. */
const JS_ALLOW_LIST = new Set(["assets/js/theme-toggle.js", "assets/js/copy-code.js"]);

/** PLAN §10.8 — the complete third-party request list. */
const ALLOWED_EXTERNAL_HOSTS = new Set(["img.itworktv.com", "static.cloudflareinsights.com", "itworktv.com"]);

/** PLAN §2.3 — URLs that are never indexable, by shape. */
const NEVER_INDEXABLE_EXACT = new Set(["/404.html", "/feed.xml", "/feed.json", "/sitemap.xml", "/robots.txt"]);

/**
 * CLAUDE.md / jsonld.njk: structured-data types that must NEVER be emitted.
 * HowTo and FAQPage are rich-result bait that Google penalises on a help-blog
 * with no real Q&A; SearchAction is a sitelinks-searchbox deprecation risk.
 * B14 asserts their absence from every shipped page — a "conventions" note in
 * a template is not a gate.
 */
const FORBIDDEN_LD_TYPES = new Set(["HowTo", "FAQPage", "SearchAction"]);

const results = [];
function record(rule, status, detail) {
  results.push({ rule, status, detail });
}

// ---- helpers ----------------------------------------------------------------

/** List every file under dir. rel paths use forward slashes. */
function walkFiles(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(abs, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
      else out.push({ rel: rel ? `${rel}/${entry.name}` : entry.name, abs: path.join(abs, entry.name), size: statSync(path.join(abs, entry.name)).size });
    }
  };
  walk(dir, "");
  return out;
}

/** As walkFiles, but a missing directory is an empty list, not a throw. */
function walkFilesSafe(dir) {
  if (!existsSync(dir)) return [];
  try {
    return walkFiles(dir);
  } catch {
    return [];
  }
}

function isHtml(file) {
  return file.rel.endsWith(".html");
}

/** "posts/example/index.html" -> "/posts/example/", "index.html" -> "/", "404.html" -> "/404.html" */
export function pageUrl(rel) {
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return `/${rel.slice(0, -"/index.html".length)}/`;
  return `/${rel}`;
}

/** §2.3 predicate, URL part only (the robots-escape-hatch and tag-count parts are applied per page). */
export function isNeverIndexableByShape(url) {
  if (NEVER_INDEXABLE_EXACT.has(url)) return true;
  if (url.startsWith("/assets/") || url.startsWith("/_headers") || url.startsWith("/_redirects")) return true;
  if (url.startsWith("/search/")) return true;
  if (url.startsWith("/pagefind/")) return true;
  if (url.endsWith(".map")) return true;
  return false;
}

/**
 * Every absolute http(s) URL in the markup, in document order and deduplicated.
 * `stripNamespaces` drops xmlns / xlink:href namespace URIs (www.w3.org/2000/svg
 * etc): they are identifiers the browser never dereferences, so counting them
 * as third-party requests would fail B9 on every inline SVG icon.
 */
function extractAllUrls(html, { stripNamespaces = false } = {}) {
  const urls = new Set();
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>()\\]+/gi)) {
    const url = m[0].replace(/[).,;]+$/, "");
    if (stripNamespaces && /^(?:https?:)?\/\/www\.w3\.org\//i.test(url)) continue;
    urls.add(url);
  }
  return [...urls];
}

function extractCanonicals(html) {
  const out = [];
  const re = /<link\b[^>]*>/gi;
  for (const m of html.matchAll(re)) {
    const tag = m[0];
    const relM = /\brel\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (relM && relM[1].split(/\s+/).includes("canonical")) {
      const hrefM = /\bhref\s*=\s*["']([^"']*)["']/i.exec(tag);
      out.push(hrefM ? hrefM[1] : "");
    }
  }
  return out;
}

function hasNoindexMeta(html) {
  const re = /<meta\b[^>]*\bname\s*=\s*["']robots["'][^>]*>/gi;
  for (const m of html.matchAll(re)) {
    const contentM = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(m[0]);
    if (contentM && /noindex/i.test(contentM[1])) return true;
  }
  return false;
}

function countMatches(html, re) {
  return (html.match(re) ?? []).length;
}

/**
 * Raw inner bytes of every `<script type="application/ld+json">` block.
 *
 * Deliberately NOT an HTML-unescape pass: the whole point of B14 is that the
 * bytes a browser hands to `JSON.parse` must parse as-is. Nunjucks autoescapes
 * by default (node_modules/nunjucks/src/environment.js: `autoescape ?? true`;
 * Eleventy never overrides it), so `{{ … | jsonld }}` without `| safe`
 * emits `{&quot;@context&quot;…}` — HTML that LOOKS like structured data in a
 * source view but that no consumer can parse. Unescaping here would hide
 * exactly the defect the rule exists to catch.
 *
 * @returns {{ index: number, raw: string }[]}
 */
function extractLdJsonBlocks(html) {
  const out = [];
  const re = /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    out.push({ index: out.length, raw: match[1] });
  }
  return out;
}

/**
 * The document with every `<script type="application/ld+json">…</script>`
 * block removed, for rules that scan the whole markup for URLs (B9).
 * See ruleB9 for why structured data is excluded from host extraction.
 */
function stripLdJsonBlocks(html) {
  return html.replace(
    /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script\s*>/gi,
    ""
  );
}

/** Every `@type` value anywhere in a parsed JSON-LD document (graph or bare). */
function collectLdTypes(node, acc = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) collectLdTypes(item, acc);
  } else if (node && typeof node === "object") {
    const t = node["@type"];
    if (typeof t === "string") acc.add(t);
    else if (Array.isArray(t)) for (const v of t) if (typeof v === "string") acc.add(v);
    for (const value of Object.values(node)) collectLdTypes(value, acc);
  }
  return acc;
}

// ---- rules ------------------------------------------------------------------

function ruleB1(files) {
  const manifestPath = path.join(repoRoot, ".cache", "css-manifest.json");
  if (!existsSync(manifestPath)) return record("B1", "skip", ".cache/css-manifest.json not found (run npm run css)");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.gzipBytes > CSS_GZIP_BUDGET) {
    return record("B1", "fail", `css gzip ${manifest.gzipBytes} bytes > ${CSS_GZIP_BUDGET} budget`);
  }
  record("B1", "pass", `css gzip ${manifest.gzipBytes}/${CSS_GZIP_BUDGET} bytes`);
  return files;
}

function ruleB2() {
  // Top level only: the CSS bundle is copied to _site/assets/<file>, so a
  // matching name in _site/assets/css/ would be a duplicate, not the bundle.
  const cssFiles = walkFilesSafe(path.join(siteDir, "assets")).filter(
    (f) => !f.rel.includes("/") && /^main\.[0-9a-f]{8}\.css$/.test(f.rel)
  );
  if (cssFiles.length !== 1) {
    return record("B2", "fail", `expected exactly one _site/assets/main.<8hex>.css, found ${cssFiles.length}`);
  }
  const manifestPath = path.join(repoRoot, ".cache", "css-manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    // The manifest path is SITE-absolute ("/assets/main.<hash>.css"); these
    // entries are _site-relative.
    const expected = manifest.css.replace(/^\//, "").replace(/^assets\//, "");
    if (cssFiles[0].rel !== expected) {
      return record("B2", "fail", `shipped ${cssFiles[0].rel} but manifest says ${expected}`);
    }
  }
  record("B2", "pass", `single stylesheet ${cssFiles[0].rel}`);
}

function ruleB3(files) {
  const js = files.filter((f) => f.rel.endsWith(".js") && !f.rel.startsWith("pagefind/"));
  const offenders = js.filter((f) => !JS_ALLOW_LIST.has(f.rel));
  if (offenders.length > 0) {
    return record("B3", "fail", `client JS outside the §10.7 allow-list: ${offenders.map((f) => f.rel).join(", ")}`);
  }
  record("B3", "pass", `${js.length} client script(s), all allow-listed`);
}

function ruleB4(files) {
  if (files.length >= FILE_COUNT_FAIL) {
    return record("B4", "fail", `deployed file count ${files.length} >= ${FILE_COUNT_FAIL} (Pages cap 20,000)`);
  }
  let warn = files.length >= FILE_COUNT_WARN;
  const tooBig = files.filter((f) => f.size >= MAX_FILE_SIZE);
  if (tooBig.length > 0) {
    record("B4", "fail", `file(s) >= 25 MiB: ${tooBig.map((f) => f.rel).join(", ")}`);
    return;
  }
  record("B4", warn ? "warn" : "pass", `file count ${files.length}${warn ? ` >= ${FILE_COUNT_WARN} (warn)` : ` < ${FILE_COUNT_WARN}`}`);
}

function ruleB5(files) {
  const big = files.filter((f) => f.size > LARGE_FILE_WARN && !f.rel.startsWith("pagefind/"));
  if (big.length > 0) {
    return record("B5", "warn", `file(s) > 1 MiB outside /pagefind/: ${big.map((f) => `${f.rel} (${f.size} B)`).join(", ")}`);
  }
  record("B5", "pass", "no deployed file > 1 MiB outside /pagefind/");
}

function ruleB8(files) {
  let offenders = [];
  for (const f of files.filter(isHtml)) {
    const html = readFileSync(f.abs, "utf8");
    for (const img of html.matchAll(/<img\b[^>]*>/gi)) {
      const srcM = /\bsrc\s*=\s*["']([^"']*)["']/i.exec(img[0]);
      if (!srcM) continue;
      const src = srcM[1];
      const ok = /^https:\/\/img\.itworktv\.com\//.test(src) || /^data:/i.test(src) || src === "";
      if (!ok) offenders.push(`${f.rel}: <img src="${src}">`);
    }
  }
  if (offenders.length > 0) return record("B8", "fail", `<img> sourced from the site's own origin: ${offenders.slice(0, 5).join("; ")}`);

  for (const f of files) {
    if (f.size > 5_000_000) continue;
    const text = readFileSync(f.abs, "utf8");
    if (text.includes("r2.dev")) return record("B8", "fail", `"r2.dev" found in ${f.rel}`);
  }
  record("B8", "pass", "no own-origin <img>, no r2.dev references");
}

function ruleB9(files) {
  const seen = new Set();
  for (const f of files.filter(isHtml)) {
    // ld+json blocks are removed before host extraction. Their URLs are
    // JSON string values ("@context": "https://schema.org") — identifiers
    // the browser never dereferences, exactly like the SVG xmlns URIs that
    // `stripNamespaces` already excludes. Without this, B9 fails on
    // schema.org: the JSON-LD escape bug (Nunjucks autoescapes a filter
    // output without `| safe`) also turned `"` into `&quot;`, which merged
    // every URL in the block into one unparsable run starting at
    // `https://schema.org&quot;…`. That masked the bug for weeks — B9 failed
    // on a garbage hostname instead of the real defect, and B14 now owns it.
    const html = stripLdJsonBlocks(readFileSync(f.abs, "utf8"));
    for (const url of extractAllUrls(html, { stripNamespaces: true })) {
      let host;
      try {
        host = new URL(url).hostname;
      } catch {
        continue;
      }
      if (!ALLOWED_EXTERNAL_HOSTS.has(host) && !seen.has(host)) seen.add(host);
    }
  }
  if (seen.size > 0) return record("B9", "fail", `external host(s) outside §10.8 allow-list: ${[...seen].join(", ")}`);
  record("B9", "pass", "external hosts limited to the §10.8 allow-list");
}

function ruleB10() {
  const outHeaders = path.join(siteDir, "_headers");
  const themeInit = path.join(repoRoot, "src", "_includes", "partials", "theme-init.njk");
  if (!existsSync(outHeaders)) return record("B10", "skip", "_site/_headers not built yet (run npm run headers)");
  if (!existsSync(themeInit)) return record("B10", "skip", "theme-init.njk not present yet (design-engineer P1.8)");
  const headers = readFileSync(outHeaders, "utf8");
  if (headers.includes("__SCRIPT_HASH__")) {
    return record("B10", "fail", "_site/_headers still contains the __SCRIPT_HASH__ literal");
  }
  const expected = `sha256-${createHash("sha256").update(readFileSync(themeInit)).digest("base64")}`;
  const m = /sha256-[A-Za-z0-9+/=]+/.exec(headers);
  if (!m) return record("B10", "fail", "no sha256-… source hash found in _site/_headers");
  if (m[0] !== expected) {
    return record("B10", "fail", `CSP hash ${m[0]} does not match theme-init bytes (${expected})`);
  }
  record("B10", "pass", `CSP hash matches theme-init.njk (${m[0].slice(0, 24)}…)`);
}

function ruleB13(files) {
  const DATE_URL_RE = /\d{4}\/\d{2}\/\d{2}/;
  const offenders = [];
  for (const f of files.filter(isHtml)) {
    for (const url of extractAllUrls(readFileSync(f.abs, "utf8"))) {
      if (DATE_URL_RE.test(url)) offenders.push(`${f.rel}: ${url}`);
    }
  }
  const sitemap = path.join(siteDir, "sitemap.xml");
  if (existsSync(sitemap)) {
    for (const m of readFileSync(sitemap, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)) {
      if (DATE_URL_RE.test(m[1])) offenders.push(`sitemap.xml: ${m[1]}`);
    }
  }
  if (offenders.length > 0) return record("B13", "fail", `date-shaped URL found: ${offenders.slice(0, 5).join("; ")}`);
  record("B13", "pass", "no URL contains a YYYY/MM/DD date segment");
}

/**
 * B14 — structured data must parse, be non-empty, and stay inside the
 * CLAUDE.md type allow-list.
 *
 * Three independent defects, one rule, because they share an input and all
 * fail the same way — silently, to the consumer rather than to us:
 *   1. JSON.parse error        -> HTML-escaped or malformed block
 *   2. empty / whitespace-only -> page "ships structured data" but has none
 *   3. forbidden @type         -> HowTo / FAQPage / SearchAction
 *
 * A page that emits no ld+json block at all is NOT a failure: the partial is
 * gated on `indexable`, so noindex pages legitimately ship none. What is a
 * failure is an empty block — that is the template rendering an empty graph,
 * which reads as "has structured data" in the source and parses as nothing.
 */
function ruleB14(files) {
  const htmlFiles = files.filter(isHtml);
  if (htmlFiles.length === 0) return record("B14", "skip", "no HTML generated yet");

  const parseErrors = [];
  const empties = [];
  const forbidden = [];
  let blocks = 0;

  for (const f of htmlFiles) {
    for (const block of extractLdJsonBlocks(readFileSync(f.abs, "utf8"))) {
      blocks += 1;
      if (block.raw.trim() === "") {
        empties.push(`${f.rel}: block #${block.index} is empty`);
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(block.raw);
      } catch (err) {
        const snippet = block.raw.slice(0, 60).replace(/\s+/g, " ");
        parseErrors.push(`${f.rel}: JSON.parse failed (${err.message}) — starts "${snippet}"`);
        continue;
      }
      if (parsed === null || (typeof parsed === "object" && Object.keys(parsed).length === 0)) {
        empties.push(`${f.rel}: block #${block.index} parses to an empty object`);
        continue;
      }
      for (const type of collectLdTypes(parsed)) {
        if (FORBIDDEN_LD_TYPES.has(type)) forbidden.push(`${f.rel}: @type "${type}" (forbidden by CLAUDE.md)`);
      }
    }
  }

  if (parseErrors.length > 0) {
    return record("B14", "fail", `${parseErrors.length} ld+json block(s) do not parse — ${parseErrors.slice(0, 5).join("; ")}`);
  }
  if (empties.length > 0) {
    return record("B14", "fail", `${empties.length} ld+json block(s) empty — ${empties.slice(0, 5).join("; ")}`);
  }
  if (forbidden.length > 0) {
    return record("B14", "fail", `forbidden @type in ${forbidden.length} block(s) — ${forbidden.slice(0, 5).join("; ")}`);
  }
  record("B14", "pass", `${blocks} ld+json block(s) across ${htmlFiles.length} page(s) parse; no forbidden @type`);
}

/**
 * B15 — per-page HTML weight. PLAN §10.2 states "any single HTML page
 * <= 100 KB gzipped … warn". A WARN, deliberately: it is an ASSUMPTION in the
 * plan, not a published limit, and a long-but-useful post should prompt a
 * look rather than block a deploy. Reported against the LARGEST page so the
 * number is actionable.
 */
function ruleB15(files) {
  const htmlFiles = files.filter(isHtml);
  if (htmlFiles.length === 0) return record("B15", "skip", "no HTML generated yet");

  let largest = { rel: "", bytes: 0 };
  const over = [];
  for (const f of htmlFiles) {
    const bytes = gzipSync(readFileSync(f.abs)).length;
    if (bytes > largest.bytes) largest = { rel: f.rel, bytes };
    if (bytes > HTML_PAGE_GZIP_WARN) over.push(`${f.rel} (${bytes} B)`);
  }
  if (over.length > 0) {
    return record("B15", "warn", `${over.length} page(s) > ${HTML_PAGE_GZIP_WARN} B gzipped: ${over.slice(0, 5).join(", ")}`);
  }
  record("B15", "pass", `largest page ${largest.rel} ${largest.bytes}/${HTML_PAGE_GZIP_WARN} B gzipped`);
}

/**
 * B16 — the inline theme-init script must stay <= 400 bytes (PLAN §10.7
 * allow-list row 1). It is a real constraint, not hygiene: the CSP
 * `script-src` carries a SHA-256 of these bytes (B10), and an inline script
 * that cannot shrink is one nobody can safely evolve.
 *
 * Checked against the SOURCE partial, which is inlined verbatim (global data
 * `themeInit`, eleventy.config.js) — so source length == shipped length, and
 * B16 measures the thing the CSP hashes rather than re-deriving it.
 */
function ruleB16() {
  const themeInit = path.join(repoRoot, "src", "_includes", "partials", "theme-init.njk");
  if (!existsSync(themeInit)) {
    return record("B16", "skip", "src/_includes/partials/theme-init.njk not present yet (design-engineer P1.8)");
  }
  const bytes = readFileSync(themeInit).length;
  if (bytes > THEME_INIT_MAX_BYTES) {
    return record("B16", "fail", `theme-init.njk is ${bytes} bytes > ${THEME_INIT_MAX_BYTES} (PLAN §10.7 row 1)`);
  }
  record("B16", "pass", `theme-init ${bytes}/${THEME_INIT_MAX_BYTES} bytes`);
}

/**
 * B6/B7/B11/B12 — the indexability rules (§2.3, §5.4).
 * Skipped as a block when no HTML has been generated yet.
 */
function rulesIndexable(files, siteUrl, tagCount, registry, sitemapLocs) {
  const htmlFiles = files.filter(isHtml);
  if (htmlFiles.length === 0) {
    record("B6", "skip", "no HTML generated yet");
    record("B7", "skip", "no HTML generated yet");
    record("B11", "skip", "no HTML generated yet");
    record("B12", "skip", "no HTML generated yet");
    return;
  }

  const byUrl = new Map();
  for (const f of htmlFiles) byUrl.set(pageUrl(f.rel), f);

  // B6: every indexable page — exactly one canonical, absolute, self-referencing.
  const b6 = [];
  const b7 = [];
  for (const f of htmlFiles) {
    const url = pageUrl(f.rel);
    const html = readFileSync(f.abs, "utf8");
    const ruleIndexable =
      !isNeverIndexableByShape(url) && tagOkForUrl(url, tagCount, registry);
    const indexable = ruleIndexable && !hasNoindexMeta(html);
    const canonicals = extractCanonicals(html);

    if (indexable) {
      if (canonicals.length !== 1) {
        b6.push(`${url}: ${canonicals.length} canonical link(s)`);
      } else if (canonicals[0] !== `${siteUrl}${url}`) {
        b6.push(`${url}: canonical ${canonicals[0]} is not self-referencing (${siteUrl}${url})`);
      }
      const h1 = countMatches(html, /<h1\b/gi);
      if (h1 !== 1) b7.push(`${url}: ${h1} <h1> element(s), need exactly 1`);
      const titleM = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
      if (!titleM || titleM[1].trim() === "") b7.push(`${url}: missing or empty <title>`);
      if (!/<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*content\s*=\s*["'][^"']+["']/i.test(html) &&
          !/<meta\b[^>]*\bcontent\s*=\s*["'][^"']+["'][^>]*\bname\s*=\s*["']description["']/i.test(html)) {
        b7.push(`${url}: missing <meta name="description">`);
      }
    } else {
      if (canonicals.length > 0) {
        b7.push(`${url}: non-indexable page carries ${canonicals.length} canonical link(s)`);
      }
    }
  }
  record("B6", b6.length ? "fail" : "pass", b6.length ? b6.slice(0, 10).join("; ") : "all indexable pages self-canonical");
  record("B7", b7.length ? "fail" : "pass", b7.length ? b7.slice(0, 10).join("; ") : "noindex pages canonical-free; indexable pages have h1/title/description");

  // B11: <3-post tag pages: noindex,follow, no canonical, out of sitemap.
  const b11 = [];
  const b12 = [];
  const tagsDir = path.join(siteDir, "tags");
  const hasTagPages = existsSync(tagsDir);
  if (registry && hasTagPages) {
    for (const [tag, count] of Object.entries(tagCount)) {
      const rel = `tags/${tag}/index.html`;
      const f = byUrl.get(`/tags/${tag}/`);
      const inSitemap = sitemapLocs.some((loc) => loc.endsWith(`/tags/${tag}/`) || loc.includes(`/tags/${tag}/page/`));
      if (count < 3) {
        if (count === 0 && f) b11.push(`/tags/${tag}/: page generated for a tag with 0 posts`);
        if (f) {
          const html = readFileSync(f.abs, "utf8");
          if (!hasNoindexMeta(html)) b11.push(`/tags/${tag}/: missing noindex robots meta (<3 posts)`);
          if (extractCanonicals(html).length > 0) b11.push(`/tags/${tag}/: canonical on a <3-post tag page`);
        }
        if (inSitemap) b11.push(`/tags/${tag}/: in sitemap.xml with <3 posts`);
      } else {
        if (!f) b12.push(`/tags/${tag}/: page missing (>=3 posts)`);
        else if (extractCanonicals(readFileSync(f.abs, "utf8")).length !== 1) {
          b12.push(`/tags/${tag}/: canonical missing on >=3-post tag page`);
        }
        if (!inSitemap) b12.push(`/tags/${tag}/: absent from sitemap.xml (>=3 posts)`);
      }
    }
  }
  record(
    "B11",
    b11.length ? "fail" : "pass",
    b11.length ? b11.slice(0, 10).join("; ") : "thin tag pages: noindex, no canonical, out of sitemap"
  );
  record(
    "B12",
    b12.length ? "fail" : "pass",
    b12.length ? b12.slice(0, 10).join("; ") : ">=3-post tag pages: canonical + sitemap"
  );
}

/** Does URL belong to a tag with >=3 posts? (true when the rule does not apply.) */
function tagOkForUrl(url, tagCount, registry) {
  const m = /^\/tags\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/page\/\d+)?\/$/.exec(url);
  if (!m) return true;
  const tag = m[1];
  if (!registry) return true; // registry missing: B11/B12 skip, do not guess indexability
  const count = tagCount.get(tag) ?? 0;
  return count >= 3;
}

// ---- runner -----------------------------------------------------------------

async function main() {
  if (!existsSync(siteDir)) {
    console.log("[budgets] No _site/ directory found — run `npm run build` first. Nothing to check.");
    return;
  }

  const files = walkFiles(siteDir);
  ruleB1(files);
  ruleB2();
  ruleB3(files);
  ruleB4(files);
  ruleB5(files);
  ruleB8(files);
  ruleB9(files);
  ruleB10();
  ruleB13(files);
  ruleB14(files);
  ruleB15(files);
  ruleB16();

  // Inputs for the indexability rules.
  let siteUrl = "https://itworktv.com";
  try {
    const site = (await import("../src/_data/site.js")).default;
    if (site && typeof site.url === "string") siteUrl = site.url;
  } catch {
    record("B6", "skip", "src/_data/site.js not loadable yet");
  }

  const tagReg = readTagRegistry();
  const tagCount = new Map();
  for (const post of loadPosts()) {
    const parsed = parseFrontMatter(readFileSync(post.abs, "utf8"), { filename: post.rel });
    if (parsed.error || !parsed.data) continue; // validate-content already gates this
    if (parsed.data.draft) continue;
    for (const tag of parsed.data.tags ?? []) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
  }

  const sitemapPath = path.join(siteDir, "sitemap.xml");
  const sitemapLocs = existsSync(sitemapPath)
    ? [...readFileSync(sitemapPath, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    : null;

  if (tagReg.ok && sitemapLocs) {
    rulesIndexable(files, siteUrl, tagCount, tagReg.registry, sitemapLocs);
  } else if (tagReg.ok) {
    // Sitemap not generated yet: run B6/B7 (page-level), defer the sitemap halves.
    ruleB67Only(files, siteUrl, tagCount, tagReg.registry);
  } else {
    ruleB67Only(files, siteUrl, tagCount, null);
    record("B11", "skip", "tag registry src/_data/tag-registry.json not present yet");
    record("B12", "skip", "tag registry src/_data/tag-registry.json not present yet");
  }

  let fails = 0;
  let warns = 0;
  for (const r of results) {
    const mark = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "SKIP" }[r.status];
    if (r.status === "fail") fails++;
    if (r.status === "warn") warns++;
    console.log(`${mark.padEnd(4)} ${r.rule.padEnd(4)} ${r.detail}`);
  }

  if (fails > 0) {
    console.error(`[budgets] ${fails} rule(s) failed — the build must not ship.`);
    process.exit(1);
  }
  console.log(`[budgets] ${results.length - fails - warns} passed, ${warns} warning(s).`);
}

/** B6/B7 without the sitemap-dependent halves (used while sitemap.xml is not generated yet). */
function ruleB67Only(files, siteUrl, tagCount, registry) {
  const htmlFiles = files.filter(isHtml);
  if (htmlFiles.length === 0) {
    record("B6", "skip", "no HTML generated yet");
    record("B7", "skip", "no HTML generated yet");
    return;
  }
  const b6 = [];
  const b7 = [];
  for (const f of htmlFiles) {
    const url = pageUrl(f.rel);
    const html = readFileSync(f.abs, "utf8");
    const ruleIndexable = !isNeverIndexableByShape(url) && tagOkForUrl(url, tagCount, registry);
    const indexable = ruleIndexable && !hasNoindexMeta(html);
    const canonicals = extractCanonicals(html);
    if (indexable) {
      if (canonicals.length !== 1) b6.push(`${url}: ${canonicals.length} canonical link(s)`);
      else if (canonicals[0] !== `${siteUrl}${url}`) b6.push(`${url}: canonical is not self-referencing`);
      const h1 = countMatches(html, /<h1\b/gi);
      if (h1 !== 1) b7.push(`${url}: ${h1} <h1>, need 1`);
    } else if (canonicals.length > 0) {
      b7.push(`${url}: non-indexable page carries ${canonicals.length} canonical link(s)`);
    }
  }
  record("B6", b6.length ? "fail" : "pass", b6.length ? b6.slice(0, 10).join("; ") : "indexable pages self-canonical (sitemap halves deferred)");
  record("B7", b7.length ? "fail" : "pass", b7.length ? b7.slice(0, 10).join("; ") : "noindex pages canonical-free (sitemap halves deferred)");
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()
) {
  main().catch((err) => {
    console.error(`[budgets] internal error: ${err.stack ?? err}`);
    process.exit(1);
  });
}
