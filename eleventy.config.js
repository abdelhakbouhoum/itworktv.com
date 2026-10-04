/**
 * eleventy.config.js — IT Work TV build configuration (P1.2 skeleton).
 *
 * Owns: eleventy-engineer. Read PLAN §1.2 (pipeline), §1.3 (CSS hash
 * consumption), §2.2 (frozen collection contract) before touching this file.
 *
 *   - dir: input `src`, output `_site`; `includes`/`data` are input-relative
 *     ("_includes"/"_data" -> src/_includes, src/_data) in Eleventy 3.1.6
 *   - collections (FROZEN names, §2.2): posts, postsAll, tags, postsByTag,
 *     pagesAll, newestPost — four agents code against these; do not rename
 *     `posts` = publishable set (non-draft, future-dated excluded in prod;
 *     dev-only via --serve / ELEVANTY_DEV) — the single production source
 *   - markdown-it (via amendLibrary — see note at the call site) with the
 *     four approved plugins (§6.1): anchor, attrs, footnote, container
 *   - syntax highlighting: @11ty/eleventy-plugin-syntaxhighlight (PrismJS,
 *     build-time, zero client JS — hard rule 1)
 *   - htmlmin transform registered LAST, gated on .html, skipped on --serve
 *   - passthrough: .cache/css -> assets (hashed CSS, PLAN §1.3) and src/assets
 *   - global data: cssManifest (lazy, tolerates pre-CSS-build dev), themeInit
 *     (lazy, tolerates the design-engineer's file being absent)
 *   - filters: stripDatePrefix (permalink, PLAN §3), jsonld (JSON.stringify —
 *     never hand-write JSON in a template, CLAUDE.md)
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { minify } from "html-minifier-terser";
import markdownItAnchor from "markdown-it-anchor";
import markdownItAttrs from "markdown-it-attrs";
import markdownItFootnote from "markdown-it-footnote";
import markdownItContainer from "markdown-it-container";
import syntaxHighlight from "@11ty/eleventy-plugin-syntaxhighlight";
import rssPlugin from "@11ty/eleventy-plugin-rss";
import { stripDatePrefix } from "./scripts/lib/slug.mjs";

const rootDir = path.join(fileURLToPath(new URL("./", import.meta.url)));

/**
 * Dev mode = `npm run dev` (eleventy --serve) or ELEVANTY_DEV=true.
 * Affects ONLY collection membership (2026-10-04 routing): dev builds may
 * include future-dated posts (the layout badges them Scheduled); production
 * output (home, tags, pagination, sitemap, feeds, search) must never contain
 * them.
 */
const isDev = process.argv.includes("--serve") || process.env.ELEVANTY_DEV === "true";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Posts live in src/posts/ (and src/posts/seed/) — glob relative to input dir. */
const POSTS_GLOB = "posts/**/*.md";

const toMillis = (d) => (d instanceof Date ? d.getTime() : Date.parse(String(d ?? "")) || 0);
const byDateDesc = (a, b) => toMillis(b.data?.date) - toMillis(a.data?.date);

/**
 * True when the post's UTC day is strictly in the future. The schema is
 * date-only `YYYY-MM-DD` (validate-content.mjs enforces it); YAML may hand us
 * a Date object, and a Date with a time-of-day is normalised to its UTC day.
 * An unparseable value never hides a post.
 */
function isFutureDate(dateValue) {
  if (!dateValue) return false;
  const d = dateValue instanceof Date ? dateValue : new Date(String(dateValue));
  if (Number.isNaN(d.getTime())) return false;
  const dayUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return dayUtc > Date.now();
}

/**
 * Date-descending posts from the glob. `includeDrafts` switches between the
 * frozen `posts` and `postsAll` shapes (§2.2); `includeFuture` is the
 * production/dev split (future-dated posts are dev-only, 2026-10-04 routing).
 */
function sortedPosts(collectionApi, { includeDrafts = false, includeFuture = true } = {}) {
  return collectionApi
    .getFilteredByGlob(POSTS_GLOB)
    .filter((post) => includeDrafts || !post.data.draft)
    .filter((post) => includeFuture || !isFutureDate(post.data.date))
    .sort(byDateDesc);
}

let registryWarned = false;
/**
 * The tag registry (src/_data/tag-registry.json, P1.5).
 *
 * NOTE — the file is deliberately NOT named tags.json: in @11ty/eleventy 3.1.6
 * a global data file named `tags.json` assigns the reserved data key `tags`,
 * which TemplateData#getCleanedTagsImmutable must find as a string/array of
 * slugs — a registry OBJECT there crashes every build ("String or Array
 * expected for `tags`", verified empirically in the P1.6 build). The registry
 * is BUILD METADATA: pages reach it through `collections.tags` (built here
 * from the file on disk) and validate-content.mjs reads the same path.
 *
 * Tolerates absence: an empty registry degrades the `tags` collection to []
 * instead of crashing Eleventy's data load.
 */
function loadTagRegistry() {
  const p = fileURLToPath(new URL("./src/_data/tag-registry.json", import.meta.url));
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    if (!registryWarned) {
      registryWarned = true;
      console.warn("[eleventy] src/_data/tag-registry.json not found yet — collections.tags will be empty until it lands (P1.5).");
    }
    return {};
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export default function (eleventyConfig) {
  // ---- Collections (FROZEN contract, PLAN §2.2 — do not rename) -------------

  /**
   * Every PUBLISHABLE post, date DESC: non-draft AND not future-dated in
   * production; dev builds (isDev) also include future-dated posts so the
   * layout can badge them Scheduled. This is the ONE production set —
   * home/archive, tag pages, pagination, sitemap, feed.xml and feed.json all
   * read from `collections.posts` (2026-10-04 routing).
   */
  eleventyConfig.addCollection("posts", (api) => sortedPosts(api, { includeFuture: isDev }));

  /** Every post incl. drafts and future-dated ones, date DESC. */
  eleventyConfig.addCollection("postsAll", (api) => sortedPosts(api, { includeDrafts: true }));

  /**
   * { "<slug>": [post, ...] }, each bucket date DESC. Same production
   * membership as `posts` — a future-dated post must not surface on a tag
   * page ahead of its publish date.
   */
  eleventyConfig.addCollection("postsByTag", (api) => {
    const byTag = Object.create(null);
    for (const post of sortedPosts(api, { includeFuture: isDev })) {
      for (const tag of post.data.tags ?? []) {
        (byTag[tag] ??= []).push(post);
      }
    }
    return byTag; // input is date-sorted, so every bucket already is
  });

  /**
   * Array of { slug, name, description, count } derived from tag-registry.json —
   * the registry is the universe (a tag with 0 posts still appears, count 0,
   * so /tags/ can list it unlinked, §5.4). Sort: count DESC, then name ASC.
   */
  eleventyConfig.addCollection("tags", (api) => {
    const registry = loadTagRegistry();
    const counts = Object.create(null);
    for (const post of sortedPosts(api, { includeFuture: isDev })) {
      for (const tag of post.data.tags ?? []) {
        if (Object.prototype.hasOwnProperty.call(registry, tag)) {
          counts[tag] = (counts[tag] ?? 0) + 1;
        }
      }
    }
    return Object.entries(registry)
      .map(([slug, meta]) => ({
        slug,
        name: meta?.name ?? slug,
        description: meta?.description ?? "",
        count: counts[slug] ?? 0,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  });

  /** Every generated page. */
  eleventyConfig.addCollection("pagesAll", (api) => api.getAll());

  /** Newest PUBLISHABLE post (same membership as `posts`), or null. */
  eleventyConfig.addCollection("newestPost", (api) => sortedPosts(api, { includeFuture: isDev })[0] ?? null);

  // ---- Filters --------------------------------------------------------------

  /** PLAN §3: strip the YYYY-MM-DD- prefix; the date never appears in a URL. */
  eleventyConfig.addFilter("stripDatePrefix", stripDatePrefix);

  /**
   * JSON-LD helper (CLAUDE.md: JSON.stringify in a filter, NEVER
   * hand-written JSON in a template). Usage: {{ jsonldObject | jsonld | safe }}
   * — `| safe` is required because `{{ }}` HTML-escapes its output.
   */
  eleventyConfig.addFilter("jsonld", (obj) => JSON.stringify(obj));

  // ---- Markdown (markdown-it + the four approved plugins, §6.1) ------------

  // amendLibrary, NOT setLibrary: in @11ty/eleventy 3.1.6 the Markdown
  // engine consumes a setLibrary("md", fn) callback as the library itself
  // ("mdlib.render is not a function" — verified empirically, P1.6 spike).
  // amendLibrary("md", fn) runs fn against the default markdown-it instance.
  eleventyConfig.amendLibrary("md", (md) => {
    // Heading ids + clickable anchors (deep links, §6.1).
    // markdown-it-anchor v10 API: permalink.ariaHidden (v5–v9 ariaLabel is gone).
    md.use(markdownItAnchor, {
      permalink: markdownItAnchor.permalink.ariaHidden({
        symbol: "#",
        class: "heading-anchor",
        placement: "after",
      }),
    });
    // Per-element attributes: {.callout} / {: .lang-bash}
    md.use(markdownItAttrs);
    // Backs the "References" section (docs/WRITING.md).
    md.use(markdownItFootnote);
    // Callout blocks: ::: warning / ::: danger (mandatory in several archetypes)
    // markdown-it-container v4 API: a single `render(tokens, idx, ...)` option
    // (the v3-era onenter/onexit names were removed — P1.6 spike, verified in
    // node_modules/markdown-it-container@4.0.0/dist).
    md.use(markdownItContainer, "warning", {
      validate: (params) => /^warning(\s.+)?$/.test(params.trim()),
      render: (tokens, idx) =>
        tokens[idx].nesting === 1
          ? '<div class="callout callout-warning" role="note">\n'
          : "</div>\n",
    });
    md.use(markdownItContainer, "danger", {
      validate: (params) => /^danger(\s.+)?$/.test(params.trim()),
      render: (tokens, idx) =>
        tokens[idx].nesting === 1
          ? '<div class="callout callout-danger" role="alert">\n'
          : "</div>\n",
    });
    return md;
  });

  // ---- Plugins --------------------------------------------------------------

  // Build-time syntax highlighting, PrismJS default (§6.1: "No browser/client
  // JavaScript here"). Colours come from the theme CSS via --code-* tokens
  // (src/assets/css/vendor/prism-itworktv.css, design-engineer P1.7).
  eleventyConfig.addPlugin(syntaxHighlight);

  // ---- RSS helpers (P1.10/P2.2, seo-specialist) -----------------------------
  // The DEFAULT export registers ONLY the date/URL helper filters
  // (dateToRfc822, dateToRfc3339, getNewestCollectionItemDate, absoluteUrl,
  // htmlToAbsoluteUrls, eleventyFeedSortByDate/Head/HasUrl + html-base
  // plugin) — verified in @11ty/eleventy-plugin-rss@3.1.0 src/rssPlugin.js.
  // It does NOT create a virtual template.
  eleventyConfig.addPlugin(rssPlugin);
  // DO NOT register the named `feedPlugin` export (src/virtualTemplate.js):
  // it creates its own virtual /feed.xml and would collide with our custom
  // src/feed.xml.njk, which owns that URL. The feed templates consume the
  // helpers directly via `import { dateToRfc822, ... } from
  // "@11ty/eleventy-plugin-rss"` and read `collections.posts`.

  // ---- Global data (lazy; tolerate missing inputs during Phase 1) -----------

  /**
   * .cache/css-manifest.json — written by scripts/build-css.mjs (stage 2,
   * always before this runs in `npm run build`; in `npm run dev` it may not
   * exist yet, so degrade to an empty manifest instead of crashing).
   */
  eleventyConfig.addGlobalData("cssManifest", () => {
    const p = fileURLToPath(new URL("./.cache/css-manifest.json", import.meta.url));
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      return { css: "", hash: "", bytes: 0, gzipBytes: 0 };
    }
  });

  /**
   * src/_includes/partials/theme-init.njk — inlined VERBATIM on every page.
   * No trimming, no re-encoding: the CSP source hash in _site/_headers is
   * computed over these exact bytes (scripts/build-headers.mjs, B10).
   */
  eleventyConfig.addGlobalData("themeInit", () => {
    const p = fileURLToPath(new URL("./src/_includes/partials/theme-init.njk", import.meta.url));
    try {
      return readFileSync(p, "utf8");
    } catch {
      return ""; // design-engineer's file (P1.8) — dev before it lands still works
    }
  });

  // ---- Passthrough copy ------------------------------------------------------

  // .cache/css -> _site/assets  (the hashed stylesheet, PLAN §1.3 step 3b)
  // Registered only when the dir exists so a bare `npm run dev` before the
  // first CSS build does not crash.
  const cacheCssDir = fileURLToPath(new URL("./.cache/css", import.meta.url));
  if (existsSync(cacheCssDir)) {
    eleventyConfig.addPassthroughCopy({ ".cache/css": "assets" });
  }

  // src/assets -> _site/assets — ALLOW-LIST ONLY (budget B3, hard rule 1):
  // exactly theme-toggle.js, copy-code.js, img/** and manifest.webmanifest.
  // src/assets/js/theme-init.js is a build-time MIRROR of the inline head
  // script (themeInit global) and must NOT ship as a client file.
  // Sources are project-root-relative (verified in TemplatePassthrough.js).
  const assetAllowList = [
    "src/assets/js/theme-toggle.js",
    "src/assets/js/copy-code.js",
    "src/assets/manifest.webmanifest",
  ];
  for (const src of assetAllowList) {
    if (existsSync(fileURLToPath(new URL(`./${src}`, import.meta.url)))) {
      eleventyConfig.addPassthroughCopy(src);
    }
  }
  if (existsSync(fileURLToPath(new URL("./src/assets/img", import.meta.url)))) {
    eleventyConfig.addPassthroughCopy("src/assets/img");
  }

  // ---- HTML minification (registered LAST so it runs after all transforms) --

  eleventyConfig.addTransform("htmlmin", (content, outputPath) => {
    if (process.argv.includes("--serve")) return content; // dev: readable source (§1.5)
    if (!outputPath || !String(outputPath).endsWith(".html")) return content;
    return minify(content, {
      collapseWhitespace: true,
      removeComments: true,
      removeRedundantAttributes: true,
      removeEmptyAttributes: true,
      removeScriptTypeAttributes: true,
      useShortDoctype: true,
      // minifyCSS/minifyJS stay OFF: the theme-init inline script must keep
      // byte-identical output to match the CSP source hash (B10), and there
      // are no inline <style> blocks to minify.
      minifyCSS: false,
      minifyJS: false,
    });
  });

  // ---- Directory / format options --------------------------------------------

  return {
    dir: {
      input: "src",
      output: "_site",
      // includes/data are RELATIVE TO THE INPUT DIR in @11ty/eleventy 3.1.6
      // (verified in ProjectDirectories.js: TemplatePath.join(input, dir)).
      // So these resolve to src/_includes and src/_data.
      includes: "_includes",
      data: "_data",
    },
    templateFormats: ["md", "njk"],
    server: {
      port: 8080,
      liveReload: true,
      domDiff: true,
      indexFileName: "index.html",
    },
  };
}
