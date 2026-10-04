# SEO — IT Work TV

Technical SEO decisions, as implemented in Phase 1 (P1.9, P1.10). This is the
machine-readable source of truth for what ships; when it disagrees with
`docs/PLAN.md` §3, the code wins and the plan gets synced (see
[Open sync items](#open-sync-items)).

## Files owned here

| File | Output | Role |
|---|---|---|
| `src/_includes/partials/head.njk` | inside `<head>` of every HTML page | title, meta description, canonical, robots, theme-color, OG/Twitter, feed autodiscovery, favicons/manifest, JSON-LD include |
| `src/_includes/partials/jsonld.njk` | included by head.njk | structured data (one `<script type="application/ld+json">` per page) |
| `src/_includes/partials/indexing.njk` | macro, imported only | the ONE indexability predicate (PLAN §2.3) — head.njk and sitemap.njk both import it, so the robots meta and the sitemap can never silently disagree |
| `src/robots.txt.njk` | `/robots.txt` | `Allow: /` + sitemap line |
| `src/sitemap.njk` | `/sitemap.xml` | every indexable page; `lastmod` only where meaningful |
| `src/feed.xml.njk` | `/feed.xml` | RSS 2.0, 20 newest posts |
| `src/feed.json.njk` | `/feed.json` | JSON Feed 1.1, 20 newest posts |
| `src/pages/index.njk` | `/` | placeholder home (title, tagline, "coming soon") |

> Note: the feeds/robots/sitemap templates live at the `src/` root, per the
> PLAN §2 tree. Files inside `src/_includes/` are never rendered as pages by
> Eleventy, so a feed placed there would silently 404.

## Canonical policy (PLAN §3.1)

- **Self-canonical on every indexable HTML page**, absolute, from the single
  `site.url` in `src/_data/site.js` — no template hardcodes a host.
- **Including paginated pages** (`/posts/page/N/`, `/tags/<tag>/page/N/`).
  Collapsing them to page 1 is a known anti-pattern; Google handles
  self-canonical paginated sets.
- **No canonical on non-indexable pages** (a canonical on a noindex page is a
  contradiction Google resolves unpredictably).
- **`www` never appears** in any canonical. One host, enforced at the edge
  (Cloudflare zone redirect — Pages `_redirects` cannot do domain-level
  redirects).
- **Renames are forbidden**: a moved slug becomes a 301 in
  `src/_redirects`; the old canonical is never served again.

## Robots directives

Driven by the shared macro (`indexing.njk`), in order (PLAN §2.3):

| Page shape | `<meta name="robots">` | In sitemap |
|---|---|---|
| Home, post index, posts, post pages, static pages, `/tags/`, tag pages with ≥ 3 posts | `index, follow, max-image-preview:large` | yes |
| Tag pages with < 3 posts (and their pagination) | `noindex, follow` — the deliberate `follow` passes link equity onward | no |
| `/404.html` | `noindex` | no |
| `/search/` | `noindex` | no |
| Feeds, sitemap, robots.txt, `/assets/*`, `/pagefind/*`, `*.map` | n/a — not HTML; **`X-Robots-Tag: noindex`** via `src/_headers` | no |
| Any page with an explicit front-matter `robots:` value | that value, verbatim (escape hatch, wins over every rule) | no |

Edge behaviour worth remembering:

- **`*.pages.dev` is noindex at the edge** — `X-Robots-Tag: noindex` on
  `https://:project.pages.dev/*` and
  `https://:version.:project.pages.dev/*` in `src/_headers` (host-based
  rules are supported by Pages). The dev domain is never indexable even
  before the custom domain is attached.
- `robots.txt` contains **no `Disallow` at all**. Disallowing is not a
  deindexing tool; the `noindex` meta is what keeps things out of the
  index, and `Allow: /` is the default we state explicitly.

## Structured data

Emit (and only this, per page — PLAN §10.4 + task spec):

| Page | Types in `@graph` |
|---|---|
| `/` | `WebSite`, `Organization` |
| `/posts/<slug>/` | `BlogPosting` (headline, description, datePublished, dateModified, author `Person`, publisher Organization with logo, image, mainEntityOfPage, keywords, articleSection), `BreadcrumbList` (Home → Posts → post) |
| `/tags/<tag>/` and `/tags/<tag>/page/N/` | `CollectionPage` (name, description, url), `BreadcrumbList` (Home → Tags → tag) |
| anything else indexable (`/posts/`, post pages, `/tags/`, about/contact/privacy) | `WebPage` |

Non-indexable pages emit **no** JSON-LD at all.

- **Never emitted: `HowTo`, `FAQPage`, `SearchAction`** (CLAUDE.md hard rule).
- **No hand-written JSON in any template.** Objects are Nunjucks literals
  passed through the `jsonld` filter (`JSON.stringify`), registered in
  `eleventy.config.js`:
  `eleventyConfig.addFilter("jsonld", v => JSON.stringify(v))`.
  `undefined` keys are dropped by `JSON.stringify` — that is how optional
  keys work.
- **`| safe` is MANDATORY on every `| jsonld` emission.** This is not a
  style preference, it is load-bearing:

  ```njk
  <script type="application/ld+json">{{ obj | jsonld | safe }}</script>
  ```

  Nunjucks autoescapes `{{ }}`, so a bare `{{ obj | jsonld }}` ships
  `&quot;@context&quot;` … `<script>` is a **raw text** element: character
  references are **not** decoded inside it, so Google reads literal
  `&quot;`, `JSON.parse` throws, and **every rich result is silently lost on
  every page**. This shipped broken and was caught by audit on 2026-10-05.
  The minifier is innocent: `html-minifier-terser` passes `<script>` bodies
  through unchanged, so the bytes arriving in `_site` are the bytes the
  template wrote.

  The identical defect shipped in **`src/feed.json.njk`**, where
  autoescaping made `/feed.json` invalid JSON outright. Same fix, same
  reason — that file is not inside a `<script>`, but Nunjucks still escapes
  `{{ }}`. **Grep for `| jsonld` without `| safe` before calling this done:**

  ```bash
  grep -rn "jsonld" src/*.njk src/_includes/partials/*.njk | grep -v "| safe"
  ```

- **Enforced mechanically** by budget rule **B14** (`scripts/check-budgets.mjs`),
  added 2026-10-05: it extracts every `<script type="application/ld+json">`
  from `_site`, runs `JSON.parse` on the raw bytes and fails the build on a
  parse error or a forbidden `@type`. Do not fix JSON-LD by hand again.
- `dateModified` / `article:modified_time` come from front-matter `updated`
  when set, else `date` (PLAN §4).
- Publisher/Organization logo is `/assets/img/favicon.svg` (P2.12 asset set);
  swap for a dedicated raster logo if QA flags SVG handling by Google.
- **`schema.org` is not a third-party request.** The `@context` URI is a
  JSON-LD vocabulary identifier — nothing ever dereferences it. Budget rule
  B9 therefore treats it as a non-request (alongside the SVG/XML namespaces)
  rather than as an origin in the §10.8 allow-list. Worth knowing because
  for weeks the *broken* escaping was the only thing hiding it: the URL
  regex stopped at the literal `"` inside `&quot;`, so a malformed block
  silently passed B9.

## Sitemap rules

- Built from `collections.pagesAll`; a `<url>` is emitted **only** when the
  shared macro returns indexable and the page is not a draft.
- No `<changefreq>`, no `<priority>` — Google ignores both and they invite
  bikeshedding.
- The sitemap never lists itself; non-HTML routes are excluded by the macro,
  not by an extra sitemap filter.

### `lastmod` is optional, and it must not lie

`<lastmod>` is **optional** per the protocol, and "should be in W3C Datetime
format", where "this format allows you to omit the time portion, if desired"
([sitemaps.org protocol](https://www.sitemaps.org/protocol.html)). Google
uses the value if it is **"consistently and verifiably"** accurate, and it
should "reflect the date and time of the last significant update to the
page"
([Google: build a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)).

That sets the rule: **emit `<lastmod>` only when the page has a real
revision signal.**

| Page | `lastmod` |
|---|---|
| any page with front-matter `updated` | that value (editorial revision) — a string or a Date |
| `/` (home) | the newest publishable post's date (`collections.newestPost`) |
| `/posts/<slug>/` | its publication `date` (UTC ISO 8601) |
| everything else — `/about/`, `/contact/`, `/privacy/`, `/posts/`, `/tags/`, pagination | **omitted** |

**Why this is not cosmetic.** `src/pages/index.njk` has no front-matter
`date`, so Eleventy falls back to the **file mtime**. The old template used
`item.date` unconditionally, so the home page's `lastmod` was rewritten with
a fresh mtime on *every rebuild* — the sitemap asserted that the home page
had changed when nothing had. A `lastmod` that churns regardless of content
trains crawlers to ignore `lastmod` everywhere in the file, which destroys
the signal for the pages that do have real dates.

Home is the one deliberate exception: it is a rolling archive that genuinely
changes whenever a post ships, so the newest post's date is both true and
stable across rebuilds. It is omitted entirely when there are zero
publishable posts.

## Feed policy

- Two feeds, same 20 newest posts, **absolute URLs** throughout:
  - `/feed.xml` — RSS 2.0 (`xmlns:atom` + `atom:link rel="self"`,
    `lastBuildDate` via the plugin's `getNewestCollectionItemDate |
    dateToRfc822`), item `description` = the post's meta description,
    `content:encoded` = the **full** rendered article HTML (without the
    layout) in CDATA.
  - `/feed.json` — JSON Feed 1.1 (`content_html` = full article, `summary`
    = meta description, per-item `image`, `tags`, `authors`). The spec's
    author key is **`authors`** (an array) at both feed and item level;
    singular `author` is the deprecated 1.0 spelling that 1.1 readers are
    entitled to ignore
    ([JSON Feed 1.1](https://jsonfeed.org/version/1.1/)). Required top-level
    keys are only `version`, `title`, `items`.
- **`| safe` applies here too** (see Structured data): every `| jsonld`
  interpolation in `feed.json.njk` needs it or the feed ships `&quot;` and
  `JSON.parse` fails. The escaping bug hit this file as well as
  `jsonld.njk`.
- Date filters come from `@11ty/eleventy-plugin-rss` v3 — the config must
  call `addPlugin(rssPlugin)` (named import; v3 has **named exports only**,
  the v2-style property access on the default export is gone). **Do not also
  add `feedPlugin`**: its virtual template defaults to `/feed.xml` and would
  collide with our template (PLAN §2 puts the feeds behind real templates).
- Feeds are built from `collections.posts` (non-draft). Contract assumption
  for the eleventy-engineer: that collection must **also exclude future-dated
  (scheduled) posts** or drafts/scheduled posts would leak into feeds.
- Per-tag feeds (`/tags/<tag>/feed.xml`) are a Phase 2 feature (one
  tag-feed template driven by a `tagsByFeed` collection — PLAN §2); until
  then, `head.njk` links only the two global feeds.

## OG / social image policy

- `og:type` is `article` on posts (with `article:published_time` /
  `article:modified_time`), `website` elsewhere.
- Twitter card is always `summary_large_image`.
- **Per-post image**: front-matter `image` is an `r2:` key (PLAN §4); the
  `r2:` prefix is stripped and the public host `https://img.itworktv.com/`
  is used. Full URLs in `image` pass through unchanged.
- **Fallback**: `/assets/img/og-default.jpg` — the branded 1200×630 default
  (P2.12, design-engineer). Verified shipped at exactly 1200×630, matching
  the `og:image:width`/`og:image:height` metas.
- **Every URL in `<head>` must resolve in `_site`.** A 404 favicon or a 404
  `og:image` is a real defect: the OG image is a *claim* to every scraper,
  and a broken claim costs the social preview. After any asset change, check
  the links resolve rather than trusting that the file exists in `src/`:

  ```bash
  node -e 'const f=require("fs"),h=f.readFileSync("_site/index.html","utf8");
  for(const m of h.matchAll(/(?:href|content|src)="(https:\/\/itworktv\.com[^"]*)"/g))
    console.log(f.existsSync("_site"+new URL(m[1]).pathname)?"OK  ":"404 ",
      new URL(m[1]).pathname);'
  ```

  The icon set, all resolving as of 2026-10-05: `/assets/img/favicon.svg`,
  `/assets/img/apple-touch-icon.png` (verified 180×180, matching
  `sizes="180x180"`) and `/assets/manifest.webmanifest`.
- **The manifest path is `/assets/manifest.webmanifest`**, not
  `/site.webmanifest`. It ships via the selective `src/assets` passthrough
  allow-list in `eleventy.config.js`; `/site.webmanifest` has never existed
  and would 404.
- Theme colors: `#0A1220` (dark) / `#ffffff` (light) as two
  `theme-color` metas with `media` queries — keep in sync with
  `tokens.json` (P1.7).
- The only third-party content host is `img.itworktv.com`; it is
  `preconnect`ed on every page.

### Meta description: one source of truth

Resolved in `head.njk` in this order — **no branch silently discards a
value the author wrote**:

1. the page's own front-matter `description` (posts *and* static pages,
   including the home page);
2. the tag registry description, for tag pages;
3. `site.description` as the last-resort fallback.

This ordering was fixed on 2026-10-05: the home page used to hard-prefer
`site.description`, which silently ignored the 195-character `description`
in `src/pages/index.njk`. A front-matter field that is read by nothing is
worse than no field — it looks authoritative and does nothing. `index.njk`'s
description is now 132 characters and is genuinely emitted.

**Length:** aim for **110–160 characters**. Google truncates the SERP
snippet around 155–160px on desktop and renders roughly half of the
character count as the mobile description, so anything past ~160 characters
is partly wasted. The audit that caught the dead field also found it at 195
characters.

## Launch checklist

Run after the custom domain is live on the zone (docs/SETUP.md owns the
domain steps; this is the search-engine half).

### 1. Google Search Console

1. Property → add **`https://itworktv.com`** (Domain or URL-prefix; URL-prefix
   is fine for Pages). Verify with a **DNS TXT** record in the Cloudflare zone
   (no HTTP-file dance needed).
2. Wait for the property to become active, then
   **Sitemaps → add `https://itworktv.com/sitemap.xml`** and confirm
   "Success", a sane submitted/indexed count, and no "URLs marked with
   `noindex`" errors beyond the deliberate ones (thin tag pages, /search/).
3. **URL Inspection** on three shapes: home, one post
   (`/posts/<slug>/`), one tag page. Each should show
   "Live" status, the correct title/description, and
   "Submitted as page, crawled and indexed" intent.
4. Rich results: **Enhancements → BlogPosting** report appears once a post
   is crawled (usually within days, not hours). No entry + no errors =
   nothing to do; an entry with errors = fix the named field.
5. Confirm the **"Crawl Stats"** data source shows Pages serving `200` for
   indexable URLs and `404` for `/404.html` (Pages does this natively).

### 2. Bing Webmaster Tools

1. Add `https://itworktv.com`, verify by **DNS TXT** (Bing picks the record
   up in under an hour).
2. **Sitemaps → add** the same `sitemap.xml`.
3. Bing reads the same canonical/robots signals; no extra configuration.
   (Bing also indexes from Google's crawl data exchange once the GSC
   property is verified.)

### 3. How to check a rich result

- **Google Rich Results Test** (search.google.com/test/rich-results): paste
  the post URL → it fetches the live page, parses the JSON-LD, and lists
  supported/unavailable features. Use after launch, not at build time — it
  cannot see `localhost` or `.pages.dev` (both are noindexed at the edge).
- In GSC, **Enhancements → (type)** shows per-URL field errors for
  `BlogPosting` / `CollectionPage` / `BreadcrumbList`.
- **Before you ever open a browser**, the build already answers the
  parse question mechanically — B14 fails the build if any `ld+json` block
  is unparseable or carries a forbidden `@type`. To reproduce it by hand,
  extract the block and parse the **raw bytes** (no entity decoding — that
  is the whole trap):

  ```bash
  node -e 'const f=require("fs"),h=f.readFileSync("_site/index.html","utf8");
  for(const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g))
    {try{const o=JSON.parse(m[1]);
       console.log("OK:",o["@graph"].map(g=>g["@type"]).join(", "));}
     catch(e){console.log("UNPARSEABLE:",e.message); process.exitCode=1;}}'
  ```

- The Schema.org validator (validator.schema.org) is a useful second
  opinion for cross-checking, but GSC is the source of truth for what
  Google actually renders.
- Visual: run Googlebot fetch simulation in the URL Inspection
  "View Test Page" → "Rendered" tab to confirm the head ships as written
  (it will — the site has no client JS — but confirm once, at launch).

### 4. URL rename (the only allowed content move)

1. Forbid the rename at the content layer first: PLAN §8.13 — URLs never
   change; a rename means the old slug is retired, not rewritten.
2. If a rename happens: add **one 301 line** to `src/_redirects`
   (`/posts/<old-slug>/ /posts/<new-slug>/ 301`) with a **one-line dated
   comment**, and **remove the old slug's canonical** — the old URL must
   stop serving a canonical to itself.
3. After deploy: URL Inspection the **old** URL in GSC → it should report
   "Moved (permanent)" with the destination visible. Confirm the new URL in
   the sitemap.
4. Never 302, never a chain of redirects, never a www/https rule in
   `_redirects` (domain-level redirects are zone-level Redirect Rules only).

## Open sync items

- **PLAN §10.4 / P2.13 type list**: the P1.9 task spec adds
  `BreadcrumbList` and `CollectionPage` to the emitted types (PLAN §10.4
  lists only WebSite/Organization/WebPage/Article/BlogPosting, and P2.13
  says "BreadcrumbList omitted"). The task spec wins for Phase 1;
  site-architect should sync §10.4 + P2.13 (and the "breadcrumb? — NOT
  ADOPTED" tree note) to match.
- ~~**`site.webmanifest`**: `head.njk` links `/site.webmanifest`~~ —
  **resolved 2026-10-05.** The manifest exists at `src/assets/manifest.webmanifest`
  and ships at `/assets/manifest.webmanifest` via the `eleventy.config.js`
  passthrough allow-list. `head.njk` now links the real path. Still open for
  site-architect: `src/_data/site.js` carries a `webmanifest: "/manifest.webmanifest"`
  key that matches **no** shipped path — either drop the key or repoint it at
  `/assets/manifest.webmanifest`.
- ~~**`site.tagline`**~~ — **resolved.** The key is present and the home
  `<title>` reads "IT Work TV – Sharing daily tips & tricks".
- **`collections.posts` must exclude future-dated posts** (see feed policy)
  — confirmed against the eleventy-engineer's P1.2/P1.11 work.

## Audit findings closed on 2026-10-05

| # | Finding | Resolution |
|---|---|---|
| BLOCKER | **JSON-LD unparseable on every page.** `jsonld.njk` emitted `{{ … | jsonld }}` with no `| safe`, so the page shipped `&quot;@context&quot;`. `<script>` is a raw-text element and entities are not decoded inside it: `JSON.parse` threw and every rich result was silently lost sitewide. | `| safe` added; the rule is documented above and enforced by **B14**. |
| BLOCKER (same class) | **`/feed.json` was invalid JSON** — identical autoescaping across every interpolated value. | `| safe` on every `| jsonld` in `feed.json.njk`; `author` → `authors` per JSON Feed 1.1. |
| SHOULD-FIX | **Four head assets 404'd on every page** — `favicon.svg`, `apple-touch-icon.png`, `og-default.jpg` (a broken `og:image` claim) and `/site.webmanifest` (wrong path). | Manifest path corrected to `/assets/manifest.webmanifest`; the three image assets produced by design-engineer (P2.12) and verified present at 180×180 / 1200×630. |
| SHOULD-FIX | **Sitemap `lastmod` churned on every rebuild** — `/` carried the file mtime of `src/pages/index.njk`, so every build claimed the home page had changed. | `lastmod` now emitted only where meaningful; home uses the newest publishable post. |
| NIT | **`src/pages/index.njk` had a 195-char `description` that nothing read** (`head.njk` hard-preferred `site.description` for the home page). | Precedence reordered so a page's own `description` always wins; the field is now live and trimmed to 132 chars. |
| SIDE EFFECT | **B9 failed on `schema.org`** once the JSON-LD became well-formed. | Not a regression: `@context` is a vocabulary identifier, never a dereferenced request. B9 now excludes non-request identifiers. **This is a `scripts/check-budgets.mjs` change owned by eleventy-engineer — do not re-litigate.** |
