# PLAN — IT Work TV

> **Single source of truth for structure.** Every other doc links here; no other doc may restate a number from §10.
> Companion narrative: [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — *how it fits together*, not *what it is*.
> Version **1.0.0** · last updated **2026-10-04 (UTC)** · owner `site-architect`.

---

## 0. Open questions carried as defaults

**GATE 1 PASSED — 2026-10-04.** The owner approved the plan and answered the open questions: Q2 brand colour is **confirmed from the brand assets in `itworktv_images/`**; Q4 GitHub identity is **confirmed** (user `itworktv`, public repo `itworktv`); Q1 has the home tagline confirmed as **“Sharing daily tips & tricks”** (from the banner) with the same folder as the visual reference — the author-name placeholder stands. Q3 and Q5 remain at their defaults unless the owner objects. Search the file for `DEFAULT` to find every remaining assumption.

| # | Question | Default written into this plan | Where it lands | If changed |
|---|---|---|---|---|
| Q1 | Author name, bio, photo | Author **`IT Work TV Team`** (DEFAULT in effect). No photo: a monogram SVG in `src/assets/img/monogram.svg`. Home tagline **CONFIRMED: “Sharing daily tips & tricks”** (from `itworktv_images/Banner_ITWORKTV.jpg`). Brand reference: `itworktv_images/itworkstv_logo.png` (gear + monitor with `</>` mark + orbit swoosh). | `src/_data/site.js` → `site.author`, `site.tagline`; rendered by `partials/author.njk` | Edit one object in `site.js`, re-run `npm run check`. Author name appears in `<title>` suffixes, JSON-LD `publisher`/`author`, `about.njk`, RSS `<managingEditor>`. Changing it later is cheap. |
| Q2 | Brand colour | **CONFIRMED from brand assets** (`itworktv_images/`): cyan→blue on deep navy. Dark-theme accent **≈ `#22D3EE`** (the “TV” mark), light-theme accent **≈ `#0E7490`** (cyan-700, to hold 4.5:1 on white — the contrast script is the final arbiter), dark surface **≈ `#0A1220`**. Approximations read off the logo/banner; design-engineer finalises in `tokens.json`. | `src/assets/css/tokens.json` → `accent` | Only file to edit. Verify contrast script passes for both themes before flipping. Cheap. |
| Q3 | Contact address | **`contact@itworktv.com`** (DEFAULT — awaiting owner confirmation) | `src/_data/site.js` → `site.email`; `/contact/`; `footer.njk` | Cheap. **Do not** put a Gmail/Proton address on a site whose selling point is IT competence. |
| Q4 | GitHub repo | Public repo **`itworktv`** — **CONFIRMED** (owner’s GitHub username is `itworktv`; commit identity `itworkwebmaster@gmail.com` is repo-local git config only, never rendered on the site). | remote origin; `.github/dependabot.yml` | Cheap — repo is empty at GATE 1. |
| Q5 | Domain on Cloudflare NS? | **No** (DEFAULT — awaiting owner confirmation). The nameserver move is documented as a Phase 3 task, not assumed done. | `docs/SETUP.md` §DNS | If it is *already* on Cloudflare NS, Phase 3 tasks 3.2/3.3 collapse to "verify". No code change either way. |
| Q6 | Content licence | Prose **all rights reserved**, code snippets **MIT** (DEFAULT — awaiting owner confirmation) | `src/pages/privacy.md`, `src/_includes/partials/footer.njk`, SPDX header in snippets | Cheap. Note: an all-rights-reserved site with an MIT code licence is deliberate — reviewers see a licence *file*, not a per-file header. |

---

## 1. Architecture

### 1.1 The one-line version

A Markdown file in `src/posts/YYYY/YYYY-MM-DD-slug.md` becomes a minified, hashed, zero-JS HTML page at `https://itworktv.com/posts/<slug>/` through one deterministic, cross-platform Node pipeline that Cloudflare Pages runs on every push.

### 1.2 Build pipeline — exact stage order

**Corrections to the brief.** The task brief lists the order as *Eleventy → CSS → HTML minify → Pagefind → budget check → header hash*. That order is **wrong and cannot work**, for one mechanical reason: the CSS filename contains a content hash, and the HTML template must be able to print that filename. If Eleventy renders first, the hash does not exist yet. **CSS must be built before Eleventy renders.** Everything else is as briefed. Two further corrections are noted inline at stages 3 and 7.

| # | Stage | Command | Script / file | Runs where | Notes |
|---|---|---|---|---|---|
| 0 | Install | `npm ci` | `package.json` (`engines.node: ">=22"`) | local, CI, Pages | Pages v2 build image defaults to Node **22.16.0** (assumption, pinned explicitly via `NODE_VERSION=22` env var). |
| 1 | **Validate content** | `npm run validate` | `scripts/validate-content.mjs` | local, CI, Pages | Front-matter schema check, tag-registry check, duplicate-slug check, unknown-key check. Fails fast — a bad post never reaches the renderer. |
| 2 | **CSS** | `npm run css` | `scripts/build-css.mjs` | local, CI, Pages | Generates `:root{}` from `tokens.json`, bundles + minifies with **lightningcss**, computes the hash, writes `.cache/css/main.<hash8>.css` and `.cache/css-manifest.json`. **Must precede stage 3.** |
| 3 | **Eleventy render** | `npm run elephant` | `eleventy.config.js` | local, CI, Pages | Markdown-it (4 plugins), build-time Prism highlighting, Nunjucks layouts, `r2:` image rewriting, JSON-LD filter, pagination. Paginates `/posts/` and `/tags/<tag>/`. |
| 3a | **HTML minify** *(inside stage 3)* | — | `addTransform("htmlmin", …)` in `eleventy.config.js` | same process | **Correction:** minification is an Eleventy transform, not a post-process script — Eleventy v3 has no native HTML minifier, so it must be registered as a transform gated on `this.page.outputPath.endsWith(".html")`. Registered **last** in `eleventy.config.js` so it runs after every other transform. Skipped entirely when `--serve`. |
| 3b | **Passthrough** *(inside stage 3)* | — | `addPassthroughCopy({ ".cache/css": "assets" })` | same process | Copies the hashed CSS into `_site/assets/`. Static path, no hashing magic needed. Eleventy cleans `_site` at build start, which is exactly why the CSS is staged in `.cache/` outside `_site`. |
| 4 | **Pagefind** | `npm run pagefind` | `pagefind` CLI | local, CI, Pages | `pagefind --site _site` → emits `_site/pagefind/`. Runs **after** minification so it indexes the shipped bytes, and **after** passthrough so it can see the CSS. |
| 5 | **Header + CSP hash** | `npm run headers` | `scripts/build-headers.mjs` | local, CI, Pages | Reads `src/_includes/partials/theme-init.njk`, SHA-256s the exact inline bytes, emits `sha256-<base64>`, substitutes `__SCRIPT_HASH__` into `src/_headers`, writes `_site/_headers`. |
| 6 | **Budget check** | `npm run check:budgets` | `scripts/check-budgets.mjs` | local, CI, Pages | Hard gate. Fails the build. Runs last so it measures the artefact that ships. |
| 7 | Ship | — | Cloudflare Pages | Cloudflare edge | Pages runs `npm run build`, publishes `_site/`, reads `_site/_headers`. Auto-injects the Web Analytics beacon at the edge (see §8.9). |

`npm run build` = `clean && validate && css && elephant && pagefind && headers && check:budgets`.
`npm run check` = `validate && check:contrast` — **does not need a build**, so it is the fast pre-commit gate.

### 1.3 The CSS hash scheme (expensive to reverse — get it right now)

There is **no hash/fingerprint flag in lightningcss**. The napi option surface is only `filename`, `minify`, `source_map`, `input_source_map`, `css_modules`. Content-hash filenames are therefore **hand-rolled**, and this is a deliberate design decision, not an oversight.

`scripts/build-css.mjs`, exact algorithm:

```
1.  read  src/assets/css/main.css                       (UTF-8 string)
2.  read  src/assets/css/tokens.json
3.  css   = ':root{' + flattenTokens(tokens.json) + '}\n' + css
    // flattenTokens emits --name:value pairs from tokens.json in key order.
4.  out   = lightningcss.bundle({ filename: 'main.css', minify: true,
                                  targets: CSS_TARGETS })      // see targets note below
5.  code  = out.code                                        // string, UTF-8
6.  hash  = createHash('sha256').update(code).digest('hex').slice(0, 8)
7.  name  = `main.${hash}.css`
8.  rm    every *.css in .cache/css/                       // kills stale hashes
9.  write .cache/css/<name>                               // the file
10. write .cache/css-manifest.json =
    { "css": "/assets/<name>", "hash": "<hash>", "bytes": code.length,
      "gzipBytes": gzipSync(code).length }
```

`CSS_TARGETS` is a single exported constant in `scripts/build-css.mjs`:
`{ chrome: 111 << 16, firefox: 111 << 16, safari: 16 << 16 }` — **ASSUMPTION**, chosen as a "boring, wide, evergreen" baseline. It is one constant; lowering it costs CSS bytes and raising it risks shipping syntax the LCP target browser cannot parse. Do not change it casually; if you do, re-measure the 15 KB gzip budget.

**Consumption.** `eleventy.config.js` exposes it to Nunjucks without a data file:

```js
// eleventy.config.js — eleventy-engineer
import { readFileSync } from "node:fs";
eleventyConfig.addGlobalData("cssManifest", () =>
  JSON.parse(readFileSync(new URL("./.cache/css-manifest.json", import.meta.url), "utf8")));
```

Templates print `{{ cssManifest.css }}`. `_headers` uses a glob (`/assets/*`), so it never needs the concrete name — this is why the hash scheme is contained to one file and one script. **Note:** 8 hex chars = 32 bits; collision probability is negligible for a handful of builds per day and would only ever cost one extra byte in a filename.

**Why not put the manifest in `src/_data/`:** it is generated output and `src/_data/` is source that is committed. `.cache/` is gitignored; `src/_data/` stays clean. (Rationale recorded because the choice of `src/_data/` file locations is flagged expensive-to-reverse in §8.13.)

### 1.4 Runtime assets (what a reader downloads)

| Asset | When | Size |
|---|---|---|
| HTML, minified, inline critical CSS? **No** — one external stylesheet | every page | see §10 |
| `/assets/main.<hash8>.css` | every page | ≤ 15 KB gzip, `Cache-Control: public, max-age=31536000, immutable` |
| inline `<script>` theme-init | every page, in `<head>` | ≤ 400 B, inlined, hashed into CSP |
| `/assets/js/theme-toggle.js` | every page | < 1 KB, `defer` |
| `/assets/js/copy-code.js` | **only** pages with a code block | < 1 KB, `defer` |
| `/pagefind/*` | **only** `/search/` | Pagefind's own bundle, excluded from our JS budget |
| `https://img.itworktv.com/*` | images | R2, `Cache-Control: public, max-age=31536000, immutable` |
| Web Analytics beacon | every page, edge-injected | Cloudflare's, not ours |

**Zero images pass through `_site`.** Every post image lives in R2 and is referenced absolutely. This is what keeps the deployed file count in the low hundreds instead of thousands, and it is the whole reason the 20,000-file Pages cap (§10.6) is a non-issue for years.

### 1.5 Development vs production build

`npm run dev` = `eleventy --serve` — port **8080**, `liveReload: true`, `domDiff: true`, `indexFileName: "index.html"` (all Eleventy v3 defaults, https://www.11ty.dev/docs/). Dev differences, all deliberate:

- HTML minification transform **disabled** (readable DevTools source).
- Pagefind **not run** — `/search/` shows a build-needed notice in dev.
- Inline-script CSS hash **not injected** — CSP is development-only and loose; see §8.9.
- `theme-init.njk` still renders, so theme flash behaviour matches production.

---

## 2. Folder tree — fully annotated

Ownership comes from the roster in `CLAUDE.md`. **Each agent writes only inside its own subtree.** Anything crossing a boundary is routed to `main` as a request, never edited directly.

```
itworktv.com/
│
├── CLAUDE.md                          [main]            project brief, hard rules, budgets summary
├── README.md                          [main]            repo front door, badge + build status
├── package.json                       [eleventy-engineer]  scripts, deps, engines >=22
├── package-lock.json                  [eleventy-engineer]  committed; CI uses npm ci
├── eleventy.config.js                 [eleventy-engineer]  ESM config: passthrough, filters, collections,
│                                                            transforms, plugins, global data
├── .nvmrc                             [main]            "22"
├── .node-version                      [devops-engineer] "22"  (same value, belt-and-braces for Pages)
├── .gitignore                         [main]            _site/ .cache/ images-out/ node_modules/ .env
├── .editorconfig                      [main]            already created
├── .env.example                       [devops-engineer] REPLACE_ME placeholders only, never real values
│
├── .claude/                           [main]
│   ├── agents/*.md                    [main]            the 7 agent definitions
│   └── settings.json                  [main]            GITIGNORED — holds a live token, must never commit
│
├── .github/                           [devops-engineer]  all of it
│   ├── workflows/
│   │   ├── ci.yml                     [devops-engineer]  node 22 matrix, npm ci, run check, run build,
│   │   │                                              upload _site artefact
│   │   ├── lighthouse.yml             [devops-engineer]  LHCI against the preview deployment
│   │   └── weekly-audit.yml           [devops-engineer]  monthly link + contrast + budget sweep
│   ├── dependabot.yml                 [devops-engineer]  npm weekly, github-actions weekly
│   (labeler.yml / ISSUE_TEMPLATE dropped at Phase 1 — not worth the ceremony on a one-author site; see PROGRESS D13)
│
├── docs/                              [see per file]
│   ├── PLAN.md                        [site-architect]  THIS FILE. Structure, numbers, gates.
│   ├── ARCHITECTURE.md                [site-architect]  narrative: how the pieces fit
│   ├── PROGRESS.md                    [main]            done / next / decisions / open questions
│   ├── WRITING.md                     [content-strategist] post archetype, pre-publish checklist
│   ├── SEO.md                         [seo-specialist]  technical decisions + launch checklist
│   ├── SETUP.md                       [devops-engineer]  click-by-click Cloudflare go-live
│   └── IMAGES.md                      [devops-engineer]  image workflow, r2: syntax, storage math
│
├── images-src/                        [owner drops / devops-engineer processes]  GITIGNORED — originals stay local, never in git or in the deploy
│   └── YYYY/MM/<slug>/                source screenshots (see IMAGES.md)
├── images-out/                        [devops-engineer]  GITIGNORED. sharp output: responsive WebP variants
│
└── src/
    │
    ├── _data/                                       [eleventy-engineer]  global data. Locations are
    │   │                                            EXPENSIVE TO REVERSE (§8.13).
    │   ├── site.js                     [eleventy-engineer]  site title, url, description, email (Q1,Q3),
    │   │                                              nav, postsPerPage, author {name,bio,monogram}
    │   ├── nav.js                      [eleventy-engineer]  ordered nav array [{url,label}]
    │   ├── difficulty.js               [eleventy-engineer]  beginner|intermediate|advanced → {label,order,icon}
    │   ├── tags.json                   [eleventy-engineer]  TAG REGISTRY. shape:
    │   │                                             { "<slug>": { "name": "…", "description": "…" } }
    │   │                                             Content authored by content-strategist (task 2.1),
    │   │                                             file owned by eleventy-engineer (schema stability).
    │   ├── authors.json                [eleventy-engineer]  ONE author today (Q1); array so a second is additive
    │   ├── images.json                 [eleventy-engineer]  GENERATED by scripts/img-optimize.mjs, GITIGNORED.
    │   │                                             { "r2:2026/10/<slug>/hero.webp":
    │   │                                               { width, height, alt, variants:[{w,src}] } }
    │   └── redirects.json              [eleventy-engineer]  internal-only alias map; devops mirrors it into _redirects
    │
    ├── _includes/                                    [see per file]
    │   ├── layouts/
    │   │   ├── base.njk                [design-engineer]  <html>, head include, header, <main>, footer,
    │   │   │                                             skip link, theme-init script, CSS link
    │   │   ├── page.njk                [design-engineer]  base + single <h1> + prose wrapper
    │   │   └── post.njk                [design-engineer]  base + article, post-meta, TOC?, code blocks
    │   │
    │   └── partials/
    │       ├── head.njk                [seo-specialist]  title, meta description, canonical, robots,
    │       │                                         OG/Twitter, preconnect to img.itworktv.com, feed <link>
    │       ├── jsonld.njk              [seo-specialist]  driven by a JSON.stringify filter; NEVER hand-written JSON
    │       ├── indexing.njk            [seo-specialist]  Nunjucks macro `is_indexable(page, collections)` —
    │       │                                         the ONE implementation of the indexability rule
    │       ├── header.njk              [design-engineer]  site header + nav + theme toggle button
    │       ├── footer.njk              [design-engineer]  nav repeat, licence line, contact link
    │       ├── theme-init.njk          [design-engineer]  the inline <head> script. MUST be byte-identical
    │       │                                         on every page (see §1.3 step 5 and §8.9)
    │       ├── theme-toggle.js         [design-engineer]  the <1 KB handler. Static, no bundler.
    │       ├── copy-code.js            [design-engineer]  the <1 KB handler. Only emitted on pages with code.
    │       ├── post-meta.njk           [design-engineer]  date, difficulty, tested_on chips, tags
    │       ├── post-card.njk           [design-engineer]  used by /posts/ and /tags/<tag>/ listings
    │       ├── pagination.njk          [design-engineer]  prev/next + numbered, rel=prev/next
    │       ├── tag-chip.njk            [design-engineer]  a single tag pill
    │       ├── author.njk              [design-engineer]  author byline block (monogram, name, bio)
    │       ├── breadcrumb?             — NOT ADOPTED. One level of hierarchy; breadcrumbs add schema risk.
    │       └── icons.njk               [design-engineer]  inline SVG sprite (search, rss, chevron, sun, moon)
    │
    ├── posts/
    │   ├── posts.json                 [eleventy-engineer]  directory data file: layout post.njk, tags ["posts"],
    │   │                                             permalink "/posts/{{ page.fileSlug | stripDatePrefix }}/"
    │   ├── YYYY/                       [content-strategist]
    │   │   └── YYYY-MM-DD-<slug>.md    [content-strategist]  <-- the ONLY content file type
    │   └── seed/                      [content-strategist]  D4: bootstrap posts, deletable in one step
    │       └── YYYY-MM-DD-<slug>.md
    │
    ├── pages/
    │   ├── index.njk                  [seo-specialist]  permalink "/"        — hmm, owner: seo-specialist
    │   ├── posts.njk                  [eleventy-engineer] permalink "/posts/page/{{ n }}/" + "/posts/"
    │   ├── tags.njk                   [eleventy-engineer] permalink "/tags/"
    │   ├── tags-page.njk              [eleventy-engineer] permalink "/tags/<tag>/" + "/tags/<tag>/page/<n>/"
    │   ├── tags-feed.njk?             — NOT USED. Per-tag feeds are generated from ONE tag-feed template
    │   │                                     driven by the tagsByFeed collection; one file, not 20.
    │   ├── search.njk                 [eleventy-engineer] permalink "/search/" — noindex, Pagefind only here
    │   ├── 404.njk                    [design-engineer] permalink "/404.html" — never linked in nav
    │   ├── about.md                   [content-strategist] permalink "/about/"
    │   ├── contact.md                  [content-strategist] permalink "/contact/"
    │   └── privacy.md                  [content-strategist] permalink "/privacy/"
    │
    ├── assets/
    │   ├── css/
    │   │   ├── tokens.json            [design-engineer]  *** SINGLE SOURCE OF TRUTH for colour/type/space.
    │   │   │                                        Consumed by build-css.mjs (emits :root) AND by
    │   │   │                                        check-contrast.mjs (reads raw hex). Never duplicated in CSS.
    │   │   ├── main.css               [design-engineer]  the whole stylesheet. No preprocessor, no @import of
    │   │   │                                        node_modules. Budget ≤15 KB gzip.
    │   │   └── vendor/
    │   │       └── prism-itworktv.css [design-engineer]  hand-written Prism theme: every .token.* rule maps to a
    │   │                                            var(--code-*) token from tokens.json. This is how
    │   │                                            code-block colours follow light/dark with zero JS.
    │   ├── js/                        [design-engineer]
    │   │   ├── theme-toggle.js
    │   │   └── copy-code.js
    │   └── img/                       [design-engineer]  favicon.svg, icon-192.png, icon-512.png,
    │       │                                         monogram.svg (Q1), apple-touch-icon.png, og-default.jpg
    │
    ├── feed.xml.njk                   [seo-specialist]  permalink "/feed.xml"   — RSS 2.0
    ├── feed.json.njk                  [seo-specialist]  permalink "/feed.json"  — JSON Feed 1.1
    ├── sitemap.njk                    [seo-specialist]  permalink "/sitemap.xml"
    ├── robots.txt.njk                 [seo-specialist]  permalink "/robots.txt"
    ├── _headers                       [devops-engineer]  policy. Contains the literal token
    │                                                       __SCRIPT_HASH__ replaced at stage 5.
    └── _redirects                     [devops-engineer]  301s for renamed slugs ONLY. No www rule — see §8.7.
```

### 2.1 Things deliberately NOT in the tree

- **No `_data/` file per page.** No `head.json` overrides. Every indexable-page decision flows through one macro (§2.3) so head and sitemap cannot silently disagree.
- **No `src/_includes/layouts/rss.njk`.** The RSS plugin owns the rendering.
- **No `.eleventy.js` / `.eleventy.cjs`.** Only `eleventy.config.js`, the Eleventy v3 default filename. Adding a second config file is how "which file wins" confusion starts.
- **No `node_modules` in `_site`, ever.** Pagefind is the only node_modules code we ship, and only under `/pagefind/`.
- **No `public/` or `static/` copy of R2 images.** Images are absolute URLs.
- **No `src/blog/`.** The folder is `src/posts/` and the URL segment is `/posts/`. One word, everywhere.

### 2.2 Collection contract (frozen in Phase 1 — every agent codes against these names)

Defined in `eleventy.config.js`; these names appear in templates owned by four different agents, so they must not be renamed later.

| Collection | Shape | Sort |
|---|---|---|
| `collections.posts` | every non-draft post | `date` DESC |
| `collections.postsAll` | every post incl. drafts | `date` DESC |
| `collections.tags` | array of `{ slug, name, description, count }` derived from `tags.json` | `count` DESC, then `name` ASC |
| `collections.postsByTag` | `{ "<slug>": [post, …] }` | each bucket `date` DESC |
| `collections.pagesAll` | every generated page | — |
| `collections.newestPost` | newest post or null | — |

### 2.3 The indexability rule — one implementation, drift caught by CI

`src/_includes/partials/indexing.njk` exports the macro `is_indexable(page, collections)`; `head.njk` and `sitemap.njk` both `{% import %}` it. The predicate, in order:

```
false  if url == "/404.html"
false  if url matches ^/(assets|_headers|_redirects)/            or ends with .map
false  if url starts with /search/
false  if url in { /feed.xml, /feed.json, /sitemap.xml, /robots.txt }
false  if page.data.robots is explicitly set        (escape hatch, wins)
postsByTag[<tag>].length < 3  →  false              for /tags/<tag>/ and /tags/<tag>/page/N/
otherwise  true
```

`< 3 posts` ⇒ `<meta name="robots" content="noindex, follow">` **and** omitted from `sitemap.xml`. The follow is deliberate: thin tag pages should pass link equity onward, not trap the crawler.

**Known risk, flagged not hidden:** Nunjucks `{% import %}` + async macro behaviour inside Eleventy v3 is not certain. Task 1.6 timeboxes a 2-hour spike. **Fallback if the spike fails:** duplicate the 12-line predicate into a filter registered in `eleventy.config.js`. Either way, **budget rule B11 (§10.7) mechanically asserts head-robot and sitemap agreement**, so drift fails CI rather than shipping. We prefer a detectable failure over a fragile structure.

---

## 3. URL map

Policy in one line: **`/posts/<slug>/`, no dates, ever.** The date lives in the filename `YYYY-MM-DD-<slug>.md` and is stripped by the `stripDatePrefix` filter before the permalink is built. A future date schedules; it never appears in a URL.

| Route | Output file in `_site` | Indexable | Fed from (internal links) | Canonical | Notes |
|---|---|---|---|---|---|
| `/` | `index.html` | **yes** | every page header logo, `sitemap.xml` | self, absolute | Home. Newest 10 posts + tag cloud. |
| `/posts/` | `posts/index.html` | **yes** | header nav, footer, home "all posts" | self | Post list page 1. |
| `/posts/page/2/` … `/page/N/` | `posts/page/2/index.html` | **yes** | `pagination.njk` rel=prev/next | **self** | **Never** canonicalised to page 1. Google handles self-canonical paginated sets; collapsing them hides pages from users and is a known anti-pattern. `rel=prev`/`rel=next` emitted. |
| `/posts/<slug>/` | `posts/<slug>/index.html` | **yes** | every listing, every tag page, `/feed.xml`, related posts | self | The money pages. `<slug>` = filename with the `YYYY-MM-DD-` prefix removed. **Immutable once published** (§8.13). |
| `/tags/` | `tags/index.html` | **yes** | header nav, home, every post's tag chips | self | Tag index with post counts. Genuinely useful as a hub, so indexable. |
| `/tags/<tag>/` | `tags/<tag>/index.html` | **yes if ≥3 posts**, else `noindex,follow` + out of sitemap | every post's tag chips, `/tags/` | self when indexable | See §5.4. |
| `/tags/<tag>/page/N/` | `tags/<tag>/page/N/index.html` | inherits its `/tags/<tag>/` parent | `pagination.njk` | self when indexable | Same ≥3 rule, evaluated against the whole tag, not the page. |
| `/tags/<tag>/feed.xml` | `tags/<tag>/feed.xml` | **no** — `X-Robots-Tag: noindex` via `_headers`, out of sitemap | `<link rel="alternate" type="application/rss+xml">` on that tag page only | none | Same RSS plugin, one template over a collection. Feed URLs are not HTML and take no canonical. |
| `/search/` | `search/index.html` | **no** — `noindex,follow`, out of sitemap | header search icon, `/404.html` | none | The only route where a real JS dependency ships. |
| `/about/` | `about/index.html` | **yes** | header nav, footer, every post's author block | self | |
| `/contact/` | `contact/index.html` | **yes** | header nav, footer, `/privacy/` | self | `mailto:` only, no contact form. A form needs a JS handler, a spam trap, and an email provider — all three break the $0 rule. |
| `/privacy/` | `privacy/index.html` | **yes** | footer, `/contact/` | self | Carries the Q6 licence default. |
| `/404.html` | `404.html` | **no** — `noindex`, out of sitemap, no canonical, never in `<nav>` | — | none | Cloudflare Pages serves this for any unmatched path with a real HTTP 404. Links to `/search/` and `/posts/`. |
| `/feed.xml` | `feed.xml` | **no** — `X-Robots-Tag: noindex`, out of sitemap | `<link rel="alternate">` in `head.njk` on **every** page | none | RSS 2.0, 20 newest posts. |
| `/feed.json` | `feed.json` | **no** — same | same | none | JSON Feed 1.1, same 20 posts. Written by a template, not the RSS plugin. |
| `/sitemap.xml` | `sitemap.xml` | **no** — `X-Robots-Tag: noindex`, out of sitemap (a sitemap listing itself is a loop) | `robots.txt` | none | `<lastmod>` from `updated ?? date`. No `<changefreq>`/`<priority>` — Google ignores them and they invite bikeshedding. |
| `/robots.txt` | `robots.txt` | **no** — `X-Robots-Tag: noindex` | — | none | `Allow: /`, `Sitemap: https://itworktv.com/sitemap.xml`. No `Disallow` of anything — disallowing is not a deindexing tool. |
| `/assets/*` | `assets/*` | **no** — `X-Robots-Tag: noindex` | every page | none | `Cache-Control: public, max-age=31536000, immutable`. Safe because the name is content-hashed. |
| `/pagefind/*` | `pagefind/*` | **no** — `X-Robots-Tag: noindex` | `/search/` only | none | Pagefind runtime + index shards. Loaded on `/search/` and nowhere else. |

**Total surface: 12 indexable route shapes.** Everything else is explicitly non-indexable, which is stated in the file rather than left to inference.

### 3.1 Canonical policy (the whole rule)

1. Every indexable HTML page emits exactly one `<link rel="canonical" href="…">`, absolute, `https://`, **self-referencing** — including `/posts/page/N/` and `/tags/<tag>/page/N/`.
2. Non-indexable pages emit **no** canonical at all (a canonical on a `noindex` page is a contradiction Google will resolve unpredictably).
3. `www` never appears in a canonical. One canonical host, enforced at the edge by the www→apex redirect (§8.7), so there is never a host to choose between.
4. Canonical URLs are generated from a single `site.url` constant in `src/_data/site.js`. No template hardcodes `itworktv.com`.
5. Renaming a published slug is forbidden. It becomes a 301 in `src/_redirects` and the old canonical is never served again.

### 3.2 Redirects

`src/_redirects` is for **content moves only**:

```
/posts/<old-slug>/    /posts/<new-slug>/    301
```

- Status **301**, never 302.
- Every entry needs a one-line comment with the date it was added, so `qa-auditor` can confirm it still exists in the sitemap of the destination.
- **No www rule, no https rule, no apex rule.** Domain-level redirects are explicitly unsupported in Pages `_redirects` — see §8.7.
- `_redirects` wins over `_headers` on conflict. That is fine here: they never overlap (redirects change the path, headers decorate the response).

---

## 4. Front-matter schema

Enforced mechanically by `scripts/validate-content.mjs`. A post that fails does not build; it does not warn.

| Field | Type | Required | Constraints | Meaning | Default |
|---|---|---|---|---|---|
| `title` | string | **yes** | **≤ 65 chars** (owner hard spec); no trailing `.`; no ALL CAPS; no `"` unescaped | The H1 and the `<title>` suffix. Written for a searcher with a problem, not for a brand. | — |
| `description` | string | **yes** | **120–160 chars** (owner hard spec); ends with a period; no keyword stuffing. Aim for ≤ 158 for clean Google snippet rendering — the validator allows up to 160. | Meta description and the RSS `<description>`. Must stand alone as a Google snippet. | — |
| `date` | string | **yes** | `YYYY-MM-DD` (UTC date, as in the owner brief's example); **must equal** the `YYYY-MM-DD` in the filename | Publication date. UTC, always (hard rule 6). Also the scheduler: a future date keeps the post out of the build. Date-level granularity is the contract — no time-of-day. | — |
| `updated` | string \| null | no | Same format as `date`; must be ≥ `date` | Real editorial revision time. Feeds `<lastmod>` and sitemap `<lastmod>`. | `null` → falls back to `date` |
| `tags` | array of strings | **yes** | **1–5 entries** (owner hard spec); every entry must exist as a key in `src/_data/tag-registry.json`; **no duplicates**. Editorial guidance: 1–3 is plenty; use 4–5 only when the post genuinely spans them. | **The first tag is the primary topic** — it drives `post-card` emphasis, the breadcrumb-free "related" block, and the tag feed most readers follow. | — |
| `difficulty` | enum string | **yes** | exactly `beginner` \| `intermediate` \| `advanced` | Reader self-selection. Shown as a chip; used as a facet on tag pages. | `intermediate` |
| `tested_on` | array of strings | **no** (owner brief marks it optional; strongly recommended) | 1–5 entries; each ≤ 40 chars | Exactly what the commands were run against, e.g. `"Windows 11 23H2"`, `"PowerShell 7.4"`. The golden rule says a post without a named test environment should not ship — enforced by the pre-publish checklist, not by the build. | `[]` |
| `image` | string \| null | no | `null` or `r2:<YYYY>/<MM>/<slug>/<file>`; the key **must exist** in `src/_data/images.json` | Hero/social image. Referenced by `r2:` so it never passes through `_site`. | `null` → no OG image, site default is used |
| `imageAlt` | string | **conditional** | **required if `image` is set.** 10–125 chars; must not begin "image of", "picture of", "screenshot of", "graph of" | Describes the *information* in the image, not its existence. A screenshot of a terminal showing a PID is alt `"Task Manager showing explorer.exe holding PID 4321"`, not `"screenshot"`. | — |
| `draft` | boolean | no | `true` \| `false` | Excluded from `_site` entirely and from every feed. For work in progress on a public repo. | `false` |

**Deliberately absent — do not add these:**

| Rejected field | Why not |
|---|---|
| `permalink` | Hard rule: URLs never change. The permalink is *derived* from the filename. A hand-written permalink is how URLs drift from filenames and rot. |
| `layout` | Set once in `src/posts/posts.json`. A per-post override is an accident waiting to happen. |
| `excerpt` | `description` already does this job. Two fields, one meaning, guaranteed drift. |
| `author` | One author today (Q1). Adding an `authors.json` key and a front-matter field later is additive and does not touch the schema validator's required list. |
| `featured` / `sticky` | Home page is "newest N". A featured flag is a manual-override treadmill on a one-post-per-day site. |
| `seo_title` / `seo_description` | The whole premise is that `title` and `description` are written for search already. |

### 4.1 Unknown-key rule

**Any front-matter key not in the table above is a hard error.** `titlee:` must fail the build, not silently ship. This is the single cheapest defence against a whole class of silent SEO bugs, and it costs about fifteen lines in the validator.

### 4.2 Worked example

```yaml
---
title: "Find the process using a port on Windows"
description: "Identify which process owns a given TCP or UDP port on Windows with netstat or Get-NetTCPConnection, then stop it safely without rebooting the machine."
date: "2026-10-04"
updated: null
tags: [networking, windows]
difficulty: intermediate
tested_on: ["Windows 11 23H2", "PowerShell 7.4"]
image: "r2:2026/10/find-process-using-port/hero.webp"
imageAlt: "PowerShell output showing PID 4321 owning TCP port 8080"
draft: false
---
```

Resolves to: URL `/posts/find-the-process-using-port/` · primary tag `networking` · og:image `https://img.itworktv.com/2026/10/find-process-using-port/hero.webp`.

---

## 5. Tag registry

### 5.1 Shape of `src/_data/tag-registry.json`

```json
{
  "windows": {
    "name": "Windows",
    "description": "Windows 10 and 11 client tasks: Group Policy, servicing, Defender, networking and the settings an administrator actually changes."
  }
}
```

Keys are slugs. `count` is **not stored** — it is derived from `collections.postsByTag` at build time, because a stored count is stale the moment someone publishes a post.

`src/_data/redirects.json` holds `"aliases": { "iis": "windows-server" }` for slugs that were used once and are being retired. Aliases get a 301 in `src/_redirects`; they are never rendered as pages.

### 5.2 Slug naming rules

1. Lowercase ASCII. `[a-z0-9]` and single hyphens only. Matched by `/^[a-z0-9]+(-[a-z0-9]+)*$/`.
2. ≤ 32 characters.
3. **No dates, no version numbers, no years.** `windows-11`, never `windows-11-23h2`.
4. Singular, lowercase, no vendor casing. `active-directory`, not `ActiveDirectory`.
5. Platform vs concept never mixed in one slug: `windows` (platform) and `powershell` (tool) are separate; `networking` is a concept and is its own slug.
6. **Renaming a published slug is forbidden.** Add a new slug and a 301. Slug permanence is what makes the registry a stable public URL namespace.

### 5.3 The initial 26 tags

Authored by `content-strategist` (task 2.1). Each description is 1–2 sentences, written for someone deciding whether a page is worth opening — not a keyword string.

> **Spec-compliance addition (orchestrator, 2026-10-04):** the owner's brief explicitly named `dns`, `azure`, `aws`, `databases`, `sql-server` and `postgresql` as starter tags, and the site's stated topics include cloud (Azure/AWS/GCP) and databases. The final six rows below were added to the architect's list rather than replacing it. Thin tags cost nothing: `< 3 posts` ⇒ `noindex, follow`, out of the sitemap (§5.4).

| Slug | Display name | Description |
|---|---|---|
| `windows` | Windows | Windows 10 and 11 client work: Group Policy, Windows Update, Defender, networking, and the settings an administrator actually changes. |
| `windows-server` | Windows Server | Active Directory, DNS, DHCP, file and print services, Group Policy, and day-to-day care of Windows Server hosts. |
| `linux` | Linux | Distributions, systemd, package management, filesystems and permissions on the machines that do not have a desktop. |
| `macos` | macOS | Managing Macs in a mixed fleet: MDM enrolment, defaults, permissions, and the Unix-shaped parts underneath. |
| `powershell` | PowerShell | PowerShell 5.1 and 7 for real administration: remoting, CIM, pipelines, error handling and scripts that are safe to run twice. |
| `bash` | Bash and Shell | Shell scripting for systems work: quoting done right, exit codes, `set -euo pipefail`, and small scripts that survive contact with production. |
| `networking` | Networking | DNS, DHCP, routing, VLANs, firewalls and the layered packet walk that turns "it won't connect" into a specific hop. |
| `active-directory` | Active Directory | Domains, OU design, group policy, replication, Kerberos and the identity plumbing an organisation runs on. |
| `security` | Security | Patching, hardening, least privilege, key and certificate handling, and first-response triage when something looks wrong. |
| `helpdesk` | Help Desk | Tier-1 workflows: remote support, ticket triage, repeatable diagnostics, and deflecting the same three tickets every week. |
| `automation` | Automation | Task Scheduler, cron, configuration management and idempotent scripting — making the second run free. |
| `virtualization` | Virtualization | Hyper-V, Proxmox, VMware ESXi, snapshots, checkpoints, and the backup conversations people postpone. |
| `containers` | Containers | Docker and OCI images: building lean images, running with the right limits, and reading the logs when a container will not start. |
| `kubernetes` | Kubernetes | Clusters, deployments, services and manifests for administrators who did not write the platform. |
| `ci-cd` | CI/CD | Pipelines, GitHub Actions, build and release automation, and keeping a pipeline honest as it grows. |
| `cloud` | Cloud | AWS, Azure and Google Cloud day-to-day operations: IAM, quotas, storage classes, billing and cost surprises. |
| `cloudflare` | Cloudflare | DNS, Workers, Pages, R2, WAF and Zero Trust for the team that owns the zone rather than the vendor contract. |
| `backup-recovery` | Backup and Recovery | Designing backups you have actually restored, retention that does not fill the disk, and rehearsing a recovery. |
| `storage` | Storage | Disks, RAID, SMART, filesystems, quotas, shares and the space emergency at 02:00. |
| `monitoring` | Monitoring | Metrics, logs, uptime checks and alerting — including how to build an alert somebody will actually read. |
| `dns` | DNS | Zone design, record types, replication, and the "why can't I resolve this" diagnostics: dig, nslookup, zone transfers and split-brain resolvers. |
| `azure` | Microsoft Azure | The Azure surfaces IT actually manages: identities and access, storage, virtual machines, diagnostics and the billing rules that surprise people. |
| `aws` | Amazon Web Services | The AWS surfaces IT actually manages: IAM, S3, EC2, VPC, CloudWatch and the cost centres that quietly grow. |
| `databases` | Databases | Data-model fundamentals, indexes, locking, and the daily admin of keeping a production database fast, backed up and upgradable. |
| `sql-server` | SQL Server | Always On, maintenance plans, backups, and the service-pack-and-cumulative-update treadmill on the servers that hold the company's data. |
| `postgresql` | PostgreSQL | psql and pgAdmin day-to-day: vacuum, replication, logical decoding, and extending a Postgres install without breaking the people who depend on it. |

**Coverage check at launch:** §9 Phase 2 requires ≥ 9 seed posts arranged so at least **3 tags have ≥ 3 posts**. Otherwise the tag pages we ship on day one are all `noindex` and the taxonomy launches invisible to search.

### 5.4 The "< 3 posts" rule

For every `/tags/<tag>/` and `/tags/<tag>/page/N/`:

| `postsByTag[tag].length` | robots | in sitemap? | canonical? | internal links to it |
|---|---|---|---|---|
| 0 | tag page not generated at all | no | — | still listed on `/tags/` with count `0`, not linked |
| 1–2 | `noindex, follow` | **no** | **no** | listed on `/tags/`, linked from that tag's posts |
| ≥ 3 | `index, follow` | **yes** | self | everywhere |

`follow` is the point: a thin tag page should hand crawler authority to the posts it links to, not swallow it. Budget rule **B11** (§10.7) fails the build if a `< 3` tag is in the sitemap or carries a canonical, and **B12** fails it if a `≥ 3` tag is missing from either. The rule is checked, not trusted.

### 5.5 Adding a tag later

Cheap and encouraged. Add a key to `tags.json`, use it in a post, done. The only cost is a new `/tags/<tag>/index.html` file, a new sitemap entry once it crosses 3 posts, and a new `<link rel="alternate">` tag feed URL. Nothing else changes.

---

## 6. Dependencies

**Rule (hard rule 4):** nothing outside this list enters `package.json` without a row here and the owner's approval. This section is the gate.

### 6.1 Build dependencies

Everything needed by `npm run build`, therefore present in CI and on Cloudflare Pages.

| Package | Version | Why exactly this one |
|---|---|---|
| `@11ty/eleventy` | `^3.1.6` | The site generator. 3.1.6 (2026-06-02) is the latest stable; v4 is only `4.0.0-alpha.10` and is **not** a dependency we take on a content site. v3 supports both ESM and CJS, so `"type": "module"` and `eleventy.config.js` both work. <br>src: https://www.11ty.dev/docs/ |
| `@11ty/eleventy-plugin-rss` | `^3.1.0` | Generates `/feed.xml` from our collection. 3.1.0 (2026-10-01) is **not deprecated**. <br>src: https://www.11ty.dev/docs/plugins/rss/ |
| `@11ty/eleventy-plugin-syntaxhighlight` | `^5.0.2` | Build-time syntax highlighting. **Default highlighter is PrismJS**; the plugin's own docs state "No browser/client JavaScript here", which is exactly our hard rule 1. <br>src: https://www.11ty.dev/docs/plugins/syntaxhighlight/ |
| `markdown-it` | `^14.2.0` | Eleventy v3 loads markdown-it `^14.2.0` with **zero plugins enabled**. We declare it explicitly so `setLibrary("md", …)` and `import` resolve against a version we control, rather than one that arrives by transitive hoist. <br>src: https://www.11ty.dev/docs/languages/ |
| `markdown-it-anchor` | `^10.0.0` | Heading `id`s and clickable anchors. Required for deep links, which is how a reader sends a colleague to one command in a long post. |
| `markdown-it-attrs` | `^5.0.1` | `{.callout}` / `{: .lang-bash}` — lets `markdown-it-container` classes and per-block classes be written without inventing a fence dialect. |
| `markdown-it-footnote` | `^4.0.0` | Backs the `## References` section of the post archetype in `docs/WRITING.md`. |
| `markdown-it-container` | `^4.0.0` | `::: warning` / `::: danger` callout blocks. Safety warnings are mandatory in several archetypes and must be visually distinct. |
| `html-minifier-terser` | `^7.2.0` | HTML minification. Eleventy v3 has **no native minifier**, so this is registered as `addTransform("htmlmin", …)`. **Unmaintained since 2023-04-11 — see §8.1.** |
| `lightningcss` | `^1.33.0` | CSS bundling, minification and browser targeting. 1.33.0 confirmed. We use the **napi `bundle()` API from a Node script**, not the CLI — see §6.3. |
| `pagefind` | `^1.5.2` | Static full-text search, `pagefind --site _site` → `_site/pagefind/`. Indexed over article bodies only. |

### 6.2 Dev / QA dependencies

| Package | Version | Why exactly this one |
|---|---|---|
| `sharp` | latest at install, pin the result | The image pipeline: strip EXIF, resize, emit responsive WebP variants. `npm run img:optimize`. |
| `wrangler` | latest at install, pin the result | R2 upload only (`npm run img:upload`). We never run it on Pages. CLI: `wrangler r2 object put <bucket>/<key> --file=… --cache-control=…`. |
| `html-validate` | latest at install, pin the result | Static HTML conformance. Catches the structural half of accessibility (missing alt, bad heading order, invalid nesting) with **no browser and no network**, so it runs in seconds on every commit. Chosen over the W3C Nu validator, which needs a network round-trip and is rate-limited. |
| `pa11y-ci` | latest at install, pin the result | Automated accessibility via axe-core. **Chosen over `@axe-core/cli`** because pa11y-ci bundles its own Puppeteer, so there is no chromedriver/version-matching dance in CI. Emits Lighthouse-aligned accessibility scores. |
| `@lhci/cli` | latest at install, pin the result | The authoritative Lighthouse gate. It is the only thing that can honestly certify "Performance ≥ 98" — everything else is a proxy. |
| `linkinator` | latest at install, pin the result | Link checking (internal + external + fragments), npm-native and cross-platform. **Chosen over `lychee`** because lychee needs a non-npm binary, and this project forbids non-npm tooling (hard rule: cross-platform Node only). See §6.4 for the hybrid. |

**Version policy for the six unpinned QA tools.** I am not asserting their current major versions from memory. Resolve them with `npm view <pkg> version` **on 2026-10-04**, record the resolved range in `package.json`, and add the resolved version to this table in the same commit. The persona rule is that the docs win over memory — and an unverified version number is memory. The build dependencies above carry verified versions and are not subject to this.

### 6.3 Rejected: `lightningcss-cli`

Rejected deliberately. The CLI adds a native binary download per platform and would have to be shelled out to, which breaks the "cross-platform Node `.mjs` only" rule. The `lightningcss` napi package already exposes `bundle()`/`transform()` to `scripts/build-css.mjs`, which is pure Node, cross-platform, and lets us compute the content hash on the exact bytes we are about to write. **We use the library, not the CLI.** Confirmed CLI flags (`--minify`, `--bundle`, `--targets`, `--sourcemap`, `-o`) are therefore irrelevant to us, as is the absent hash flag (§1.3).

### 6.4 Rejected alternatives

The gate. Each line is a decision, so a future agent does not re-litigate it.

| Rejected | Because |
|---|---|
| **Shiki** | The brief's intuition is right to check and **Shiki is not available here**: `@11ty/eleventy-plugin-syntaxhighlight` 5.0.2 is PrismJS-only and **Shiki has zero references in the Eleventy v3.1.6 source**. Using it would mean dropping the plugin and writing a custom highlighter via `addMarkdownHighlighter()`, replacing ~200 lines of maintained behaviour with code we own forever. Its genuine advantage — TextMate grammars and a wider language set — is not needed for PowerShell/bash/cmd posts. |
| **`@11ty/eleventy-plugin-sitemap`** | 30 lines of Nunjucks gives us exact control over exclusion rules, which the plugin does not expose. We need "omit this tag page because it has 2 posts" to be a first-class rule (§5.4), not a workaround. |
| **`@11ty/eleventy-plugin-navigation`** | Our navigation is a flat 5-item list in `nav.js`. The plugin adds a dependency and a collection convention to solve a problem a 5-line loop solves. |
| **`@11ty/eleventy-plugin-img`** | We need `sharp` under our own script anyway for the R2 workflow and `src/_data/images.json`. Wrapping it in a plugin would hide the variant list we have to publish to `_site`-consuming docs. |
| **`purgecss` / `@fullhuman/postcss-purgecss`** | Our CSS is hand-written and budgeted at ≤ 15 KB gzip. PurgeCSS adds a stage that can silently delete a class only used by a dynamically built string, and its failure mode is a visually broken page that no test in the stack would catch. The budget is met by writing less. |
| **`terser`** | There is no JS bundle to minify. The two client scripts are < 1 KB each by hand-written discipline; adding a minifier for them is pure risk. |
| **`@fullhuman/postcss-*` / any PostCSS chain** | lightningcss does targeting, minification and nesting natively. A PostCSS layer would be a second transformation engine to keep in sync. |
| **`lychee`** | Excellent, fast, but a non-npm binary. Violates the cross-platform-Node rule and would need a second install path for the owner's Windows machine. `linkinator` is npm-native. **If link-checking latency ever becomes a real complaint (see §6.2 hybrid below), adding lychee to CI only is the approved upgrade path.** |
| **`broken-link-checker`** | Unmaintained. Same class of risk as `html-minifier-terser` (§8.1) but with no offsetting benefit. |
| **`@axe-core/cli` + `chrome-driver`** | Two independently versioned moving parts that must agree about a Chrome build. pa11y-ci bundles one Puppeteer that already agrees with itself. |
| **`jest` / `vitest` / `mocha`** | Node 22 ships a capable built-in test runner. Our scripts need a handful of unit tests (the hash scheme, the contrast maths, the date-stripping filter), not a framework. `node --test` it is — **zero dependencies**. |
| **Any UI framework** (React, Vue, Svelte, Alpine) | Hard rule: vanilla only, zero client JS by default. Not a preference; not revisitable without a CLAUDE.md change. |
| **Tailwind / Bootstrap / jQuery** | Same. Tailwind additionally requires a build-time class scanner and a generated stylesheet — the exact "JS/CSS by another engine" surface we are avoiding. |
| **A hosted search service** (Algolia, Google Programmable Search) | Breaks the $0 rule and the third-party-request rule (§10.8). Pagefind is free, static, and ships its index as files. |
| **A contact form service** (Formspree, Netlify Forms, a Worker) | Each needs JS, spam handling, and/or an email provider. `/contact/` is `mailto:` only. |

**Hybrid link-checking note.** `linkinator` is good at external links and adequate at fragments but slow on large sites. `scripts/check-links.mjs` therefore does **internal links + fragments + orphan detection in custom Node** (fast, deterministic, runs on every push), and `linkinator` runs **weekly** in `weekly-audit.yml` for external links only. Both use npm-native tooling; the hybrid costs one extra workflow, not a new platform.

---

## 7. Task graph

**Model allocation (decided by the owner, 2026-10-04).** `site-architect`, `eleventy-engineer`, `seo-specialist` and `qa-auditor` run on the **strong** model. `design-engineer` and `content-strategist` run on the **free** model. `devops-engineer` is not in the decision and keeps the roster default from `CLAUDE.md` (sonnet) — confirm with the owner at GATE 1 and record it in `PROGRESS.md`.

**Parallel rule used in this table.** `Par` = can start the moment its depends-on column is empty, concurrently with everything else marked Par. `Seq` = strictly serial within its owner (one agent, one pair of hands) even when its dependencies are met. `Gate` = needs human action; no agent can proceed past it.

---

### Phase 1 — Foundations (no publishable content; every contract frozen here)

The phase has a **hard serial spine of three tasks** — P1.1 → P1.2 → the freeze — because four agents code against the collection names, the `site.js` shape and the `tags.json` schema. Everything else fans out from the freeze.

| # | Task | Owner | Model | Depends on | Par? |
|---|---|---|---|---|---|
| P1.1 | `package.json` (scripts per §1.2, deps per §6), `.node-version`, `.gitignore` merge, `engines: ">=22"` | eleventy-engineer | strong | — | Seq |
| P1.2 | `eleventy.config.js` skeleton: `dir` config, input `src` / output `_site`, data `src/_data`, includes `_includes`, **collection names per §2.2**, `stripDatePrefix` filter, `addPassthroughCopy` for `.cache/css` and `src/assets` | eleventy-engineer | strong | P1.1 | Seq |
| P1.3 | **CONTRACT FREEZE** — `collections.posts`, `postsByTag`, `tags`, `postsAll`; `site.js` key names; `tags.json` schema; `cssManifest` global; indexability macro interface. Announced in `docs/PROGRESS.md`. No code changes to these names after this point without a `main` decision. | site-architect | strong | P1.2 | Seq |
| P1.4 | `src/_data/site.js` (Q1, Q3 defaults), `nav.js`, `difficulty.js`, `authors.json`, `redirects.json` | eleventy-engineer | strong | P1.3 | Par |
| P1.5 | `src/_data/tag-registry.json` skeleton with the 20 keys, descriptions drafted | content-strategist | free | P1.3 | Par |
| P1.6 | **Nunjucks `{% import %}` + async macro spike** (2-hour timebox) for `partials/indexing.njk`. Record PASS/FAIL in `PROGRESS.md`; on FAIL, raise the filter fallback to `main` (§2.3) | eleventy-engineer | strong | P1.2 | Par |
| P1.7 | `src/assets/css/tokens.json` (full token set, blue/teal default Q2, `contrastPairs` array), `main.css` skeleton, `vendor/prism-itworktv.css` mapping every Prism token to a `--code-*` var | design-engineer | free | P1.3 | Par |
| P1.8 | Layouts `base.njk`, `page.njk`, `post.njk`; partials `header/footer/theme-init/theme-toggle/copy-code/post-card/post-meta/pagination/tag-chip/author/icons` | design-engineer | free | P1.3, P1.7 | Par |
| P1.9 | `head.njk`, `jsonld.njk` (via `JSON.stringify` filter — never hand-written JSON), `indexing.njk` macro, `robots.txt.njk` | seo-specialist | strong | P1.3 | Par |
| P1.10 | `sitemap.njk`, `feed.xml.njk` (RSS plugin, **named imports** — §8.3), `feed.json.njk`, `pages/index.njk` | seo-specialist | strong | P1.9 | Par |
| P1.11 | `scripts/`: `clean.mjs`, `build-css.mjs` (hash scheme §1.3), `build-headers.mjs`, `validate-content.mjs` (schema §4 + tag check + unknown-key check) | eleventy-engineer | strong | P1.2 | Par |
| P1.12 | `scripts/check-budgets.mjs` (rules B1–B12, §10.7), `scripts/check-contrast.mjs`, `scripts/check-links.mjs` | eleventy-engineer | strong | P1.11 | Par |
| P1.13 | `node --test` unit tests for the hash scheme, `stripDatePrefix`, and the contrast maths. **Zero extra dependencies** (§6.4) | eleventy-engineer | strong | P1.12 | Par |
| P1.14 | `src/_headers` (policy + `__SCRIPT_HASH__` token), `src/_redirects` (empty + comment header), `.env.example` | devops-engineer | default | P1.9 | Par |
| P1.15 | `.github/workflows/ci.yml` (Node 22 matrix, `npm ci`, `npm run check`, `npm run build`, unit tests, upload `_site`), `dependabot.yml`, `labeler.yml` | devops-engineer | default | P1.1 | Par |
| P1.16 | `scripts/`: `new-post.mjs`, `queue.mjs`; `src/posts/posts.json` with the date-stripping permalink | eleventy-engineer | strong | P1.3 | Par |
| P1.17 | `docs/WRITING.md` — post archetype TL;DR → Problem → Steps → Verify → Troubleshooting → Rollback/Risks → References, pre-publish checklist | content-strategist | free | P1.3 | Par |
| P1.18 | `docs/SEO.md` — technical decisions + launch checklist | seo-specialist | strong | P1.9 | Par |
| P1.19 | `docs/SETUP.md` (Cloudflare go-live incl. the DNS move, Q5 default), `docs/IMAGES.md` (`r2:` syntax, storage maths) | devops-engineer | default | P1.14 | Par |
| P1.20 | **GATE 1** — owner approves the plan, the 6 defaults, and the dependency list | owner | — | P1.4…P1.19 | Gate |

**Phase 1 parallelism, explicitly.** After P1.1 → P1.2 → P1.3 (eleventy-engineer, strong, serial), **six agents work simultaneously**: eleventy-engineer (P1.4, P1.6, P1.11, P1.12, P1.13, P1.16 — the widest critical path), design-engineer (P1.7 → P1.8), seo-specialist (P1.9 → P1.10, P1.18), content-strategist (P1.5, P1.17), devops-engineer (P1.14/P1.15 → P1.19), and site-architect in review-only mode. **The three longest poles are all owned by design-engineer and content-strategist on the free model** — if Phase 1 slips, those are the tasks to watch, because P1.8 gates every rendered page.

---

### Phase 2 — Content and features (fan-out on the frozen contract)

| # | Task | Owner | Model | Depends on | Par? |
|---|---|---|---|---|---|
| P2.1 | Full `tags.json`: 20 slugs, display names, 1–2 sentence descriptions | content-strategist | free | P1.5 | Par |
| P2.2 | **≥ 9 seed posts** in `src/posts/seed/`, arranged so **≥ 3 tags have ≥ 3 posts** (§5.3 coverage check). Every post passes §4 schema and the golden rule | content-strategist | free | P2.1, P1.17 | Par |
| P2.3 | `/about/`, `/contact/`, `/privacy/` (Q1, Q3, Q6 defaults) | content-strategist | free | P1.17 | Par |
| P2.4 | Pagination: `pages/posts.njk` → `/posts/` + `/posts/page/N/`; `pages/tags-page.njk` → `/tags/<tag>/` + `/tags/<tag>/page/N/`; per-tag `feed.xml` from one template | eleventy-engineer | strong | P1.2, P2.1 | Par |
| P2.5 | `pages/tags.njk` → `/tags/` index with counts; wire `collections.tags` | eleventy-engineer | strong | P2.4 | Par |
| P2.6 | `pages/search.njk` + Pagefind wiring. **First task to verify the §8.9 CLI flags** — do this first, it de-risks everything downstream | eleventy-engineer | strong | P2.4 | Par |
| P2.7 | Pagefind selector scoping: index article body only; exclude `header/footer/nav/aside` and `/search/` itself; force `<meta name="robots" content="noindex,follow">` via `data-pagefind-meta` or the config flag | seo-specialist | strong | P2.6 | Par |
| P2.8 | `pages/404.njk` — useful, on-brand, links to `/search/` and `/posts/`; no canonical; never in nav | design-engineer | free | P1.8 | Par |
| P2.9 | `copy-code.js` wiring: emit the script **only** on pages containing a code block; add a "Copied" state that is announced for screen readers | design-engineer | free | P1.8, P2.2 | Par |
| P2.10 | `r2:` markdown-it image renderer → `<figure>` with `srcset`, explicit `width`/`height`, `loading="lazy"`; cover images get `fetchpriority="high"` and **no** lazy loading; write `src/_data/images.json` | eleventy-engineer | strong | P1.2 | Par |
| P2.11 | `scripts/img-optimize.mjs` (sharp: strip metadata, responsive WebP variants) + `scripts/img-upload.mjs` (wrangler, `--cache-control`) | devops-engineer | default | P2.10 | Par |
| P2.12 | OG images, `og-default.jpg`, favicon set, monogram SVG (Q1) | design-engineer | free | P1.7 | Par |
| P2.13 | Head/JSON-LD polish: OG + Twitter cards, **`BreadcrumbList` emitted on posts and tag pages (owner brief §6.4 requires it — the "omitted" wording in the first draft was wrong, corrected here 2026-10-04)**, no HowTo/FAQPage/SearchAction (retired/restricted by Google), `BlogPosting` (not bare `Article`) + `CollectionPage` on tag pages | seo-specialist | strong | P1.10, P2.2 | Par |
| P2.14 | LHCI config + `lighthouse.yml` workflow; `pa11y-ci` config; `html-validate` config; weekly-audit workflow | devops-engineer | default | P1.15 | Par |
| P2.15 | Full local audit against §9 Phase 2 criteria; file the defect list | qa-auditor | strong | P2.2…P2.14 | Seq |
| P2.16 | Re-verify contrast in both themes after all tokens land; fix until ≥ 4.5:1 everywhere | design-engineer | free | P2.12, P2.15 | Seq |

---

### Phase 3 — Go-live (mostly human-gated; agents prepare and verify)

| # | Task | Owner | Model | Depends on | Par? |
|---|---|---|---|---|---|
| P3.1 | Create the Cloudflare Pages project, connect the GitHub repo, set build `npm run build`, output `_site`, `NODE_VERSION=22`; create a Deploy Hook and store it as a secret | devops-engineer | default | P2.15 | Gate |
| P3.2 | **Move `itworktv.com` onto Cloudflare nameservers** (Q5 default: not yet done). Registrar → set NS; wait for propagation; verify. **The apex custom domain cannot be attached until this completes** — a subdomain would work without it, the apex will not | devops-engineer | default | P3.1 | Gate |
| P3.3 | Attach `itworktv.com` apex, then `www` as a **separate custom domain** (so it resolves before the redirect), then verify 522 is gone | devops-engineer | default | P3.2 | Gate |
| P3.4 | **Zone-level Redirect Rule `www.itworktv.com/*` → `itworktv.com/$1`, 301.** `_redirects` cannot do this (§8.7) | devops-engineer | default | P3.3 | Gate |
| P3.5 | R2: one-time "purchase R2" subscription checkout (free-with-usage) → **this is the gate that makes token generation possible at all** → create bucket → create API token, permission exactly `Object Read & Write`, **S3-compatible API only, not the REST API** → store `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` as CI secrets | devops-engineer | default | P3.1 | Gate |
| P3.6 | R2 custom domain `img.itworktv.com` (no paid plan needed). **Never CNAME to `r2.dev`** — dev-only and rate-limited | devops-engineer | default | P3.5 | Gate |
| P3.7 | Enable Cloudflare Web Analytics for the Pages project (Metrics auto-injection). **Do not set `Cache-Control: public, no-transform` on `/`** — it blocks auto-injection (§8.9) | devops-engineer | default | P3.1 | Gate |
| P3.8 | Preproduction audit on the `*.pages.dev` preview: `X-Robots-Tag: noindex` must be live; CSP must not break the theme toggle, the copy button or Pagefind; measure the real CSP with the beacon present | qa-auditor | strong | P3.1, P2.16 | Seq |
| P3.9 | Google Search Console: property, `sitemap.xml` submission, `URL Inspection` on `/` and 3 posts | seo-specialist | strong | P3.3 | Par |
| P3.10 | Confirm `_site/_headers` on the deployed site matches the built one; confirm the `__SCRIPT_HASH__` was substituted and is a valid `sha256-<base64>` | qa-auditor | strong | P3.8 | Seq |
| P3.11 | **GATE 2** — owner approves launch | owner | — | P3.4…P3.10 | Gate |

---

### Phase 4 — First 30 days of publishing (steady state)

| # | Task | Owner | Model | Depends on | Par? |
|---|---|---|---|---|---|
| P4.1 | One post per day via `npm run new` → write → `npm run check` → push | content-strategist | free | P3.11 | Seq |
| P4.2 | Watch for tags crossing the 3-post threshold and confirm B11/B12 pass on each build | eleventy-engineer | strong | P4.1 | Par |
| P4.3 | Weekly Lighthouse + a11y + link sweep; file defects | qa-auditor | strong | P4.1 | Par |
| P4.4 | Weekly Search Console review: queries, CTR, index coverage, CWV | seo-specialist | strong | P3.9 | Par |
| P4.5 | R2 usage and upload failures; watch the 10 GB-month free tier | devops-engineer | default | P3.6 | Par |
| P4.6 | Refresh the highest-traffic posts when a tool version changes; set `updated`, never move a URL | content-strategist | free | P4.4 | Seq |

---

### Phase 5 — Iterate and harden (continuous, quarterly cadence)

| # | Task | Owner | Model | Depends on | Par? |
|---|---|---|---|---|---|
| P5.1 | Quarterly dependency review: check whether `html-minifier-terser` has a successor worth migrating to (§8.1) | eleventy-engineer | strong | — | Par |
| P5.2 | Quarterly accessibility + contrast re-audit after any token change | qa-auditor | strong | P5.1 | Par |
| P5.3 | Prune or merge tags that stayed under 3 posts; add a 301 rather than a delete | seo-specialist | strong | P5.2 | Par |
| P5.4 | Re-check every number in §10 against live vendor docs — limits drift, and this plan is a snapshot from 2026-10-04 | site-architect | strong | P5.1 | Par |
| P5.5 | Review Pages build usage against the 500/month free cap; raise `postsPerPage` or batch deploys if it approaches | devops-engineer | default | P4.5 | Par |
| P5.6 | Full `PROGRESS.md` decision-table update; refresh the six defaults in §0 | main | — | P5.1…P5.5 | Seq |

### 7.1 Critical path to launch

`P1.1 → P1.2 → P1.3 → P1.8 (design-engineer, free model) → P2.2 (content-strategist, free model) → P2.15 → P3.1 → P3.2 → P3.3`

Everything else can absorb slack. **If Phase 1 runs late, the two free-model poles (P1.8 layouts, P2.2 seed content) are the ones to staff up, not the strong-model work.**

---

## 8. Risks

Likelihood and impact are the architect's judgement, not measured data. **Every row has an owner and a trigger** — a risk with no trigger is a worry, not a risk.

| # | Risk | L | I | Mitigation | Trigger → response | Owner |
|---|---|---|---|---|---|---|
| **R1** | **`html-minifier-terser` 7.2.0 is effectively unmaintained** — last published 2023-04-11. Upstream `kangax/html-minifier` still takes commits but has had no npm release since. It is the only HTML minifier in the approved list, and Eleventy v3 has **no native HTML minification**, so there is no drop-in replacement. Risk is a security advisory or a Node-22 incompatibility arriving with no fix. | Med | **High** — it is on the critical path of every build | 1. **Minification is not load-bearing for any budget.** HTML size is already bounded by short pages; the win is bytes on the wire, not a gate. If it breaks, deleting the transform (§1.3a) leaves a fully working site. 2. Pin exactly `7.2.0`, no `^`, so a bad auto-publish cannot land. 3. `npm audit` runs in CI and fails on any advisory touching this package. 4. Pre-write the fallback: replace the transform with a 40-line conservative regex minifier (`scripts/minify-html.mjs`) that only collapses inter-tag whitespace — boring, reviewable, and adequate. 5. P5.1 re-checks quarterly. | `npm audit` flags it, or a build fails on Node 22 | eleventy-engineer |
| **R2** | **No hash/fingerprint flag in `lightningcss`** — the napi surface is only `filename`, `minify`, `source_map`, `input_source_map`, `css_modules`. Content-hash filenames must be hand-rolled (§1.3), so the fingerprint is code we own. A bug here means either an unhashed filename (breaking `immutable` caching and `_headers`) or a hash mismatch between the emitted file and the manifest. | Med | Med | 1. The algorithm is written out step-by-step in §1.3, not left to the implementer. 2. Unit-tested under `node --test` (P1.13): the same CSS yields the same hash; one changed byte yields a different hash; the emitted filename equals `manifest.css`. 3. Budget rule **B2** (§10.7) fails the build unless `_site/assets/` contains **exactly one** `main.<hash8>.css` and its name matches `cssManifest.css`. 4. `_headers` uses a `/assets/*` glob, so a hash change never requires touching the header file. | B2 fails in CI | eleventy-engineer |
| **R3** | **RSS plugin v3 named-export trap.** `@11ty/eleventy-plugin-rss` 3.1.0 is **ESM-only** and its helpers are **named exports** — `feedPlugin`, `dateToRfc3339`, `dateToRfc822`, `getNewestCollectionItemDate`, `absoluteUrl`, `convertHtmlToAbsoluteUrls`. They are **not** properties of the default export. Code written from v1/v2 memory (`const { feedPlugin } = plugin` or `plugin.dateToRfc822`) fails at build time with a confusing `undefined is not a function`. | **High** | Low-Med — loud, not silent | 1. **The correct import form is written into the task description for P1.10 verbatim**: `import { feedPlugin, absoluteUrl, dateToRfc822 } from "@11ty/eleventy-plugin-rss";`. 2. The default export is still used for `eleventyConfig.addPlugin(feedPlugin)` — both facts are recorded side by side so the two are not confused. 3. A wrong import fails the build on the first run, not in production. | First build of `feed.xml.njk` | seo-specialist |
| **R4** | **Node divergence: Node 22 in CI/Pages vs Node 24 locally.** The local machine is v24.19.0; `.nvmrc` and Pages `NODE_VERSION` pin **22** (Pages v2 build image defaults to 22.16.0 — assumption, pinned explicitly anyway). A script that works locally on 24 can fail on 22, or vice versa. Eleventy v3 requires **Node ≥ 18**, and every package in §6 is Node 22 compatible, so the floor is safe — but the *difference* is where bugs hide (new globals, changed `fetch`, stricter deprecations). | Med | Med | 1. CI matrix runs **Node 22 only**, matching production. Local dev must use `.nvmrc`; `.editorconfig` and the README say so. 2. CI runs `npm ci && npm run check && npm run build` on **every** push, so a 24-only construct fails in CI long before it fails on Pages. 3. No Node-24-only APIs; every script uses `node:`-prefixed built-ins available in 22. 4. If a contributor cannot run 22, CI is the gate. | A green local build goes red in CI | devops-engineer |
| **R5** | **Cloudflare Pages 20,000-file cap vs our 15k-warn / 19k-fail budget.** Pages Free allows 20,000 files per site. A budget that warns at 15,000 leaves only 5,000 files of headroom before the platform itself refuses the upload. | **Low** | High — a refused deploy takes the site down | 1. **The design already defeats this.** Zero images pass through `_site` (§1.4): every image is an absolute `https://img.itworktv.com/…` URL. A realistic year-one `_site` is ~1 CSS + 2 JS + ~12 static pages + ~365 posts + ~80 tag pages + ~50 Pagefind files ≈ **~510 files**, three orders of magnitude inside the cap. 2. Rule **B4** (§10.7) counts deployed files, warns at 15,000, fails at 19,000 — the fail line is deliberately below the platform's 20,000 so we find out first. 3. Pagefind's index grows with posts, so the growth rate is known and linear. 4. The one genuine threat is someone committing image assets into `src/assets/img/` and pointing at them relatively; B4 plus the `r2:` convention catch it. | B4 warn appears | devops-engineer |
| **R6** | **R2 requires a one-time "purchase" before an API token can be generated.** R2 custom domains need no paid plan, but Cloudflare requires completing the free-with-usage subscription checkout before the token UI will issue a token. Get this wrong and `npm run img:upload` fails with an opaque 401 and no obvious next step. | **High** — a known, certain procedural trap | Med | 1. Documented as an explicit, ordered step in P3.5 and in `docs/SETUP.md`: *checkout → create bucket → create token → set CI secrets*. 2. Token permission is the exact string **`Object Read & Write`**, and it must be created against the **S3-compatible API, not the Cloudflare REST API** — the wrong API surface produces a token that silently fails. 3. Credentials come from **env only** (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`); `.env` is gitignored; `.env.example` holds `REPLACE_ME` only (hard rule 2). 4. No CORS configuration needed — plain `<img>` loads are not CORS-enforced; skip the step unless JS ever reads image bytes. 5. **Never CNAME to `r2.dev`** — dev-only, rate-limited, and explicitly not for production. | First `img:upload` run | devops-engineer |
| **R7** | **www → apex needs a zone-level redirect rule, not `_redirects`.** Domain-level redirects are explicitly **not supported** in Pages `_redirects`. If we assume a `_redirects` entry handles it, the site serves duplicate content on two hosts and the canonical (§3.1) becomes a tie-break Google must guess. | Med | **High** — duplicate content hurts the #1 goal (organic traffic) | 1. Documented as P3.4 and hard-coded into the canonical policy: **one canonical host, `itworktv.com`.** 2. `www.itworktv.com` is attached as a **separate Pages custom domain first**, so it resolves (no 522), and *then* the zone Redirect Rule 301s it. Doing it in the other order produces a confusing loop or an error page. 3. **There is no documented auto-www-redirect for Pages custom domains** — this must be configured by hand, so it is a named task with an owner, not a footnote. 4. `qa-auditor` verifies at P3.8 that `https://www.itworktv.com/` returns a **301 to the apex** and that the apex is served with HTTP 200. 5. `_redirects` keeps its single documented job: content moves (P4.6, P5.3). | www resolves and serves 200 | devops-engineer |
| **R8** | **Apex custom domain requires the zone on Cloudflare nameservers** (Q5 default: not yet done). Subdomains like `img.itworktv.com` do not, but the apex does — and registering the CNAME through the dashboard is required first, or the domain returns **HTTP 522**. | **High** — a certain procedural step | Med | 1. Ordered in `docs/SETUP.md`: move NS → wait for propagation → verify → attach apex. 2. Attach via the dashboard "Add a custom domain" flow, **not** by pre-creating a CNAME, to avoid the 522. 3. `img.itworktv.com` is a subdomain and is **not** blocked by the nameserver requirement, so images can ship before the apex move completes. 4. If Q5 turns out to be "already on Cloudflare NS", P3.2/3.3 collapse to a verification step — **the code is identical either way**, which is why this is a default and not an assumption. | Registrar still on non-Cloudflare NS | devops-engineer |
| **R9** | **Cloudflare's beacon auto-injection changes the CSP shape.** Enabling Pages Metrics auto-injects a `type="module"` beacon from `static.cloudflareinsights.com` — and auto-injection is **blocked by `Cache-Control: public, no-transform`**, which is the header many people reach for out of habit. The CSP also has two different correct shapes depending on injection mode: `connect-src 'self'` when Cloudflare injects (it posts to your own `/cdn-cgi/rum`) vs `cloudflareinsights.com` when we embed by hand. | **High** — a concrete CSP-vs-injection conflict | Med — breaks analytics silently, or breaks the site if CSP is too tight | 1. **Decision: prefer Pages Metrics auto-injection over hand-writing the script**, because then `connect-src` only needs `'self'`. 2. The token is a **literal** in `data-cf-beacon='{"token":"…"}'` — there is **no env var**; it is committed in `head.njk` and is not a secret in any meaningful sense. 3. **The beacon is `type="module"`, not `async`.** Modules are deferred by default, so the non-blocking intent of the JS budget still holds; do not "fix" it to `async`. 4. `_headers` must allow `https://static.cloudflareinsights.com` in `script-src` and `https://cloudflareinsights.com` in `connect-src`, or CSP silently blocks the beacon. 5. **`no-transform` stays off `/`** — recorded as an explicit rule with that reason in `src/_headers`. 6. qa-auditor verifies at P3.8 by reading a real response with the CSP applied. | Beacon absent in the Network panel, or a CSP violation on every page | devops-engineer |
| **R10** | **Pagefind's `--output-path` and `--glob` semantics are unverified.** Verified: `pagefind` **1.5.2**, `npx pagefind --site <dir>` emits `<dir>/pagefind/`. **Not verified:** `--output-path` and `--glob`. If we exclude `/search/` from the index with the wrong flag we either index our own search page (a feedback loop that poisons results) or emit the index somewhere the templates do not expect. | Med | Low-Med | 1. **Marked TO-VERIFY with the source URL** (below). 2. Task P2.6 is assigned to verify the flags **first**, before any other Pagefind work, precisely so this is settled early. 3. Default plan that needs **no** flag: scope the index with `data-pagefind-body` on the article element in `post.njk` and `data-pagefind-ignore` on header/footer/nav — markup we control. 4. Belt and braces: a unit assertion that `_site/pagefind/pagefind.js` exists and that `/search/` is not present in the shard list. **src to check: https://pagefind.app/docs/reference-cli-options/** | P2.6 spike | eleventy-engineer |
| **R11** | **Nunjucks `{% import %}` + async macro may not work in Eleventy v3**, which would break the single-source indexability rule (§2.3). | Med | Low | 1. Timeboxed 2-hour spike (P1.6) with a documented fallback: duplicate the 12-line predicate into a filter. 2. **The real protection is mechanical, not structural**: budget rules B11/B12 fail the build if head robots and sitemap inclusion disagree. Drift cannot ship. | P1.6 reports FAIL | eleventy-engineer |
| **R12** | **`style-src` CSP may block Pagefind UI**, which injects a `<style>` element at runtime. `style-src 'self'` would break `/search/` in a way that only appears on one page. | Med | Low | 1. Plan for `style-src 'self' 'unsafe-inline'` and document the trade-off honestly: CSS injection requires a pre-existing HTML injection, so it is a materially smaller risk than `script-src 'unsafe-inline'`. 2. Verify manually at P3.8 by loading `/search/` with the deployed CSP and confirming the UI renders. 3. If a stricter `style-src` is achievable later (e.g. via a Pagefind config that inlines a hashed stylesheet), tighten it then. | `/search/` renders unstyled or blank under the deployed CSP | qa-auditor |
| **R13** | **Client JS budget creep.** "Zero JS by default" decays one tiny script at a time — a scroll listener, a reading-time estimator, an image lightbox. Each is defensible; collectively they cost LCP, TBT and Lighthouse performance. | **High** | Med — degrades the #1/#2 goals gradually and invisibly | 1. The allow-list (§10.8) is **mechanical**: B3 fails the build on **any** `.js` file in `_site` that is not on the list. No judgement call for a future agent. 2. Adding an entry requires a §6.4 row and owner approval. 3. The theme-init inline script is hash-pinned in the CSP, so it cannot grow unnoticed without a visible diff in `_headers`. | B3 fails | eleventy-engineer |
| **R14** | **Live plaintext API token in `.claude/settings.json`.** The file is gitignored (D3) and stays on disk because deleting it breaks the running session, but **the token on disk is exposed and should be rotated by the owner.** | — | **High** | 1. **Owner action required, out of an agent's hands.** Rotate the token. 2. Verify it was never committed: `git log --all -- .claude/settings.json` must return nothing. 3. `.gitignore` keeps `.claude/settings.json`, `.env`, `images-out/`, `.cache/`, `_site/` ignored. 4. Pre-commit hook or CI step that fails if any tracked file matches a secret pattern. | **Immediately** | owner |
| **R15** | **Seed launch with all tag pages `noindex`.** If the 9 seed posts do not produce 3 tags with ≥ 3 posts, every `/tags/<tag>/` ships `noindex,follow` and the taxonomy is invisible to search on day one — and the site looks like it has no topic structure. | Med | Med | 1. **Made an acceptance criterion** (§9 Phase 2): ≥ 3 tags with ≥ 3 posts before GATE 2. 2. `npm run queue` shows the tag distribution of the seed set. 3. Adding tags after launch is cheap (§5.5) — the launch-blocking part is doing it deliberately, not accidentally. | B12 warns at GATE 2 | content-strategist |
| **R16** | **Slow external-link checks.** `linkinator` on external URLs is the slowest thing in CI and can flake on a rate-limited third party. | Med | Low | 1. Split as designed: internal links + fragments + orphan detection in custom Node on **every** push; external links only **weekly** (§6.4). 2. A flaky external link is a warning, not a deploy failure. | CI exceeds 10 min | devops-engineer |
| **R17** | **Unverified QA-tool versions.** §6.2 pins six QA tools by "latest at install" rather than a number. | High | Low | 1. The task requires resolving and recording the actual range on 2026-10-04 in `package.json` **and** in §6.2 in the same commit. 2. Dependabot keeps them current afterwards. 3. The build dependencies in §6.1 carry verified versions and are not affected. | P1.1 completes without recorded versions | eleventy-engineer |
| **R18** | **Unmaintained-dependency drift generally** — not just the minifier. A dependency could be abandoned, or could ship a major with breaking changes, on a site whose brief is "low maintenance for years". | Med | Med | 1. `dependabot.yml` on weekly npm + GitHub Actions. 2. **No `npm audit fix --force`** (hard rule 4) — ever. 3. Eleventy is deliberately held at **v3**, not v4 (`4.0.0-alpha.10`); a content site takes the stable line. 4. P5.1 reviews the whole list quarterly. | Dependabot PR for a major | eleventy-engineer |
| **R19** | **Content quality drift under a one-post-per-day cadence.** The fastest path to a dead site is publishing a post whose commands were never run. | **High** | **High** — this is the product | 1. `tested_on` is **required** (§4) — a post that cannot name its test environment does not build. 2. The archetype in `docs/WRITING.md` puts Verify and Troubleshooting/Rollback before References. 3. `qa-auditor` spot-checks a random post weekly. 4. The golden rule is the first line of `docs/WRITING.md`, not buried. | A post ships with untested commands | content-strategist |

### 8.1 To-verify items (open questions with a source, not a guess)

| Item | Status | Source URL |
|---|---|---|
| Pagefind `--output-path` / `--glob` semantics | **UNVERIFIED** — see R10 | https://pagefind.app/docs/reference-cli-options/ |
| Pagefind selector-scoping flags (`data-pagefind-body`, `data-pagefind-ignore`, `force_meta`) | **UNVERIFIED** | https://pagefind.app/docs/filtering/ |
| Pages v2 build image default Node version (assumed 22.16.0) | **ASSUMPTION** — pinned explicitly via `NODE_VERSION=22` regardless | https://developers.cloudflare.com/pages/platform/limits/ |
| Current majors of the six QA tools | **UNVERIFIED** — resolved and recorded at P1.1 | https://www.npmjs.com/ |
| Pagefind UI's runtime `<style>` injection (R12) | **UNVERIFIED** — manual test at P3.8 | https://pagefind.app/ |
| Exact Deploy Hook URL path shape | **NOT PUBLISHED** — read from the dashboard, treat as a secret | https://developers.cloudflare.com/pages/configuration/deploy-hooks/ |

### 8.2 Facts deliberately not stated

- **Cloudflare Pages bandwidth and request caps.** These are **no longer published**. No number for them appears anywhere in this plan or in any other doc. https://developers.cloudflare.com/pages/platform/limits/
- **"Eleventy v4 is faster."** v4 is `4.0.0-alpha.10`. We ship v3 and say why.
- **Any Lighthouse score "guaranteed" by this plan.** §10 states the gate; §9 states how it is measured. Neither claims a result before the measurement exists.

---

## 9. Acceptance criteria per phase

Every line is written so **`qa-auditor` can check it mechanically** — a command, a file, or a byte count. If a criterion needs a human opinion, it belongs in a GATE, not here.

Notation: **✔** = a script or command proves it · **👁** = qa-auditor inspects and records the result.

---

### Phase 0 — Plan (current phase)

| # | Criterion | How |
|---|---|---|
| A0.1 | `docs/PLAN.md` and `docs/ARCHITECTURE.md` exist and cover all ten required sections | ✔ file presence + heading grep |
| A0.2 | Every quantitative claim carries a source URL or the word **ASSUMPTION** / **UNVERIFIED** | ✔ grep for numbers lacking a URL is manual, but §8.1 lists every unverified item in one table |
| A0.3 | The six branding defaults are marked inline | ✔ `grep -c "DEFAULT — awaiting owner confirmation" docs/PLAN.md` = 6+ |
| A0.4 | The dependency list has a rejected-alternatives section covering Tailwind, React, Shiki, Terser, PurgeCSS | ✔ section present |
| A0.5 | No site code has been written | ✔ `git status` shows only `.gitignore`, `.nvmrc`, `.editorconfig`, `CLAUDE.md`, `docs/`, `.claude/agents/` |
| A0.6 | **GATE 1** — owner approves the plan, the 6 defaults, and the dependency list | 👁 owner |

---

### Phase 1 — Foundations

| # | Criterion | How |
|---|---|---|
| A1.1 | `npm ci` succeeds on Node 22 | ✔ CI matrix, exit 0 |
| A1.2 | `npm run check` passes on a clean checkout | ✔ exit 0 |
| A1.3 | `npm run build` produces `_site/` with no errors and no warnings | ✔ exit 0, and the log contains no `warn` |
| A1.4 | `_site/_headers` contains **no** literal `__SCRIPT_HASH__` | ✔ `grep -c "__SCRIPT_HASH__" _site/_headers` = 0 |
| A1.5 | The CSP hash in `_site/_headers` equals the SHA-256 of the exact `theme-init.njk` script bytes | ✔ recompute independently and compare |
| A1.6 | Exactly one stylesheet exists, named `main.<8 hex>.css`, and `manifest.css` matches it | ✔ budget rule **B2** |
| A1.7 | `eleventy.config.js` exports collections named exactly `posts`, `postsAll`, `tags`, `postsByTag`, `pagesAll`, `newestPost` | ✔ unit test asserts each collection key exists |
| A1.8 | `src/posts/2026/10/2026-10-04-example.md` renders to `/posts/example/` — **the date is gone from the URL** | ✔ assert `_site/posts/example/index.html` exists and `_site/posts/2026/` does not |
| A1.9 | `validate-content.mjs` rejects: a missing `title`; a `date` not matching its filename; a tag absent from `tags.json`; a 4th tag; **any unknown front-matter key** | ✔ four fixtures, four non-zero exits |
| A1.10 | Every colour pair in `tokens.json.contrastPairs` meets ≥ 4.5:1 in **both** light and dark | ✔ `npm run check:contrast` exit 0 |
| A1.11 | Prism output is coloured by CSS vars — set `data-theme="dark"` in devtools and every `.token.*` colour changes | 👁 + ✔ `grep -c "var(--code-" _site/_includes`-derived CSS is non-zero and zero hex literals appear in `prism-itworktv.css` |
| A1.12 | `_site/*.js` contains **only** the two allow-listed files (pagefind excluded) | ✔ budget rule **B3** |
| A1.13 | `npm run new -- "Test Title" --tags windows,networking` scaffolds a valid post and `npm run queue` lists it | ✔ round-trip test |
| A1.14 | The Nunjucks `{% import %}` spike result is recorded in `PROGRESS.md` as PASS or FAIL | ✔ text present |
| A1.15 | CI fails if any workflow references a Node version other than 22 | ✔ grep `.github/workflows/*.yml` for `node-version` |
| A1.16 | Every file changed is inside its owner's subtree (§2) | ✔ `.github/labeler.yml` path→owner mapping resolves for all 7 agents |
| A1.17 | The six QA-tool versions in §6.2 are now concrete | ✔ no "latest at install" text remains in §6.2 |

---

### Phase 2 — Content and features

| # | Criterion | How |
|---|---|---|
| A2.1 | **≥ 9 seed posts** exist in `src/posts/seed/` and all pass the validator | ✔ count + `npm run check` |
| A2.2 | **≥ 3 tags have ≥ 3 posts** at launch | ✔ budget rule **B11** passes (no `< 3` tag is canonical or in the sitemap) |
| A2.3 | Every post carries `tested_on` naming at least one environment | ✔ validator requires it |
| A2.4 | Every rendered page has **exactly one** `<h1>` | ✔ `html-validate` config asserts one `h1` per document |
| A2.5 | Every indexable page has exactly one absolute, self-referencing canonical; every non-indexable page has **none** | ✔ budget rules **B6/B7** |
| A2.6 | `/posts/page/2/` has canonical = itself (**not** page 1) and `rel=prev`/`rel=next` | ✔ assert the literal string |
| A2.7 | No date appears anywhere in any rendered URL | ✔ grep all `<link rel=canonical>`, `href`, and `src` in `_site/**/*.html` for `\d{4}/\d{2}/\d{2}` |
| A2.8 | `feed.xml` parses as valid RSS 2.0, `feed.json` as valid JSON Feed 1.1, each with 20 items, newest first | ✔ parse both in a unit test |
| A2.9 | `sitemap.xml` parses, contains only indexable pages, has no self-reference, and every `<loc>` returns HTTP 200 | ✔ fetch every `<loc>` against the preview |
| A2.10 | `robots.txt` contains `Sitemap: https://itworktv.com/sitemap.xml` | ✔ exact string match |
| A2.11 | `/search/` returns 200, has `noindex,follow`, and is **absent** from the sitemap | ✔ fetch + parse |
| A2.12 | Pagefind: `_site/pagefind/pagefind.js` exists; `/search/` is **not** in the index; header/footer text is **not** searchable | ✔ P2.6 spike result + manual query for a footer-only phrase |
| A2.13 | `copy-code.js` is present **only** on pages containing a code block | ✔ assert it is absent from `/about/` and present on `/posts/<slug>/` |
| A2.14 | The inline theme-init script is **byte-identical** on every rendered page | ✔ hash the extracted script from 10 pages, all equal |
| A2.15 | Every `<img>` has non-empty `alt`, explicit `width` and `height`, and `loading="lazy"` unless it is the cover image | ✔ `html-validate` + a custom assertion |
| A2.16 | No image is served from the site's own origin; every image is `img.itworktv.com` | ✔ B8 |
| A2.17 | The only absolute external hosts in any HTML are `img.itworktv.com`, `static.cloudflareinsights.com` and `itworktv.com` | ✔ B9 |
| A2.18 | Lighthouse **mobile** on `/`, one post, one tag page: Performance **≥ 98**, Accessibility / Best Practices / SEO = **100** | ✔ LHCI, 3 runs, median |
| A2.19 | LCP < 1.5 s, CLS = 0, TBT ≈ 0 | ✔ LHCI assertion thresholds |
| A2.20 | `gzip` size of `main.<hash>.css` ≤ 15,360 bytes | ✔ B1 |
| A2.21 | pa11y-ci reports **0** serious or critical accessibility violations on `/`, a post, and a tag page | ✔ exit 0 |
| A2.22 | Contrast ≥ 4.5:1 in both themes across all `contrastPairs` | ✔ `npm run check:contrast` |
| A2.23 | **Zero** internal broken links and zero broken fragments | ✔ `check-links.mjs` exit 0 |
| A2.24 | No orphan pages: every indexable page in `_site` is reachable by an internal link | ✔ `check-links.mjs --orphans` exit 0 |
| A2.25 | `npm run build` **fails** when a budget rule is violated | ✔ deliberately break a rule, assert a non-zero exit, revert |

---

### Phase 3 — Go-live

| # | Criterion | How |
|---|---|---|
| A3.1 | `https://itworktv.com/` returns 200 over HTTPS with a valid certificate | ✔ `curl -sI` |
| A3.2 | `https://www.itworktv.com/` returns **301** to the apex, preserving path and query | ✔ `curl -sI -o /dev/null -w '%{http_code} %{redirect_url}'` |
| A3.3 | Every canonical and every sitemap `<loc>` uses the **apex**, never `www` | ✔ B6 |
| A3.4 | `https://*.pages.dev` and `https://*.pages.dev/*` return `X-Robots-Tag: noindex` | ✔ host-scoped `_headers` rules verified on a real response |
| A3.5 | `/feed.xml`, `/feed.json`, `/sitemap.xml`, `/robots.txt`, `/search/`, `/assets/*`, `/pagefind/*` each return `X-Robots-Tag: noindex` | ✔ header check on each |
| A3.6 | The deployed CSP does not break the theme toggle, the copy button, or Pagefind, with **zero** violations in the console | 👁 + ✔ no `Content-Security-Policy` violation on any page |
| A3.7 | The Web Analytics beacon is present **and** posting to `/cdn-cgi/rum` | 👁 Network panel on the deployed site |
| A3.8 | `/` does **not** send `Cache-Control: public, no-transform` | ✔ header absent on `/` |
| A3.9 | `/assets/*` sends `Cache-Control: public, max-age=31536000, immutable` | ✔ header check |
| A3.10 | An unknown path returns **HTTP 404** and serves the 404 page | ✔ `curl -sI https://itworktv.com/this-does-not-exist` |
| A3.11 | `https://img.itworktv.com/…` returns 200 with a long `Cache-Control`; **no** request ever hits `r2.dev` | ✔ header + grep the whole `_site` for `r2.dev` = 0 |
| A3.12 | Every `r2:` image in `images.json` resolves over HTTP at its public URL | ✔ HEAD every entry |
| A3.13 | No secret is tracked: `git log --all -- .claude/settings.json .env` is empty; no `REPLACE_ME` placeholder survives in `_site` | ✔ git + grep |
| A3.14 | A production build on the deployed preview reproduces the §10 budgets | ✔ LHCI against the preview |
| A3.15 | Search Console: property verified, `sitemap.xml` submitted, `/` and 3 posts URL-inspected | 👁 |
| A3.16 | **GATE 2** — owner approves launch | 👁 owner |

---

### Phase 4 — First 30 days

| # | Criterion | How |
|---|---|---|
| A4.1 | ≥ 25 posts published, **one per day, no gaps** (public holidays excepted and recorded) | ✔ `npm run queue` history + sitemap count |
| A4.2 | Every published post has a non-empty `tested_on` and a `Verify` section | ✔ validator + spot-check |
| A4.3 | Zero skipped CI builds and zero reverted deployments | ✔ GitHub Actions history |
| A4.4 | Every tag page that crossed 3 posts is now in the sitemap with a self-canonical | ✔ B11/B12 |
| A4.5 | Lighthouse budgets still hold weekly | ✔ LHCI weekly |
| A4.6 | Zero serious accessibility violations across a random sample of 5 posts | ✔ pa11y-ci |
| A4.7 | R2 usage is comfortably inside 10 GB-month | ✔ dashboard |
| A4.8 | No post URL has changed since publication | ✔ sitemap diff against the launch snapshot |

---

### Phase 5 — Iterate and harden

| # | Criterion | How |
|---|---|---|
| A5.1 | Every number in §10 re-verified against the vendor doc cited beside it, or moved to §8.1 as unverified | ✔ dated re-check recorded in `PROGRESS.md` |
| A5.2 | R1 (minifier) re-reviewed; a successor exists or the fallback is documented as current | ✔ written finding |
| A5.3 | Every tag that stayed under 3 posts for a full quarter is merged or 301'd — none is left as a permanent `noindex` orphan | ✔ sitemap + tag report |
| A5.4 | Contrast re-verified after every token change | ✔ `npm run check:contrast` |
| A5.5 | Pages build usage is below 500/month with headroom | ✔ dashboard |
| A5.6 | No dependency in §6 is unmaintained **without** a written mitigation row in §8 | ✔ manual audit against npm publish dates |
| A5.7 | The six §0 defaults are re-confirmed or marked resolved | ✔ `PROGRESS.md` |

---

### 9.1 GATES summary

| Gate | When | Decided by | Blocks |
|---|---|---|---|
| **GATE 1** | End of Phase 0 | owner | All code. Approves the plan, the 6 branding defaults, the dependency list. |
| **GATE 2** | End of Phase 3 | owner | Public launch. |
| **Daily** | Every publish | `npm run check` | A bad post never reaches the deploy. |
| **Quarterly** | Phase 5 | qa-auditor + owner | Dependency upgrades, tag pruning, §10 re-verification. |

---

## 10. Budgets — the single source of truth

> **This section is canonical.** `CLAUDE.md`, `docs/SEO.md`, `docs/SETUP.md`, `docs/IMAGES.md`, `.github/workflows/*` and every task description **link here and restate nothing**. If a number appears in two places with two values, this one is right and the other is a bug.
> Budget version **1.0.0** · verified **2026-10-04** · owner `site-architect`. Re-verify quarterly (A5.1).

### 10.1 Performance — Lighthouse, mobile emulation, median of 3 runs

Measured on `/`, one representative post, and one tag page.

| Metric | Budget | Enforced by |
|---|---|---|
| Performance | **≥ 98** | LHCI |
| Accessibility | **100** | LHCI + pa11y-ci |
| Best Practices | **100** | LHCI |
| SEO | **100** | LHCI |
| **LCP** | **< 1.5 s** | LHCI assertion |
| **CLS** | **0** | LHCI assertion (exact zero, not "≤ 0.1") |
| **TBT** | **≈ 0 ms** | LHCI assertion |

**CLS = 0 is achievable because there are no images above the fold without dimensions and no client JS that moves anything.** Every `<img>` carries explicit `width` and `height` (§9 A2.15). The theme-init script sets `data-theme` on `<html>` **before first paint**, so theme selection costs zero layout shift — that is the entire reason it is inline in `<head>`.

### 10.2 Asset sizes

| Asset | Budget | Enforcement |
|---|---|---|
| CSS | **≤ 15 KB gzipped** (15,360 bytes) | **B1** |
| CSS files per page | **exactly 1**, named `main.<8 hex>.css` | **B2** |
| Any single HTML page | ≤ 100 KB gzipped (ASSUMPTION — a working ceiling, not a published limit) | warn |
| Any single deployed file | **< 25 MiB** — the hard Pages per-file limit | **B4** |
| Deployed file count | **warn ≥ 15,000**, **fail ≥ 19,000** | **B4** |

**Realistic year-one file count: ~510.** 1 CSS + 2 JS + ~12 static pages + ~365 posts + ~80 tag pages + ~50 Pagefind files. Three orders of magnitude inside the 20,000-file Pages cap, because **zero images pass through `_site`** (§1.4).

### 10.3 Accessibility and contrast

| Metric | Budget |
|---|---|
| Contrast, **light theme** | **≥ 4.5:1** for every pair in `tokens.json.contrastPairs` |
| Contrast, **dark theme** | **≥ 4.5:1** for every pair in `tokens.json.contrastPairs` |
| Large text (≥ 24px, or ≥ 18.66px bold) and UI borders | ≥ 3:1 |
| Target standard | **WCAG 2.2 AA** |
| Serious/critical violations (pa11y-ci) | **0** |
| HTML conformance (`html-validate`) | 0 errors |

Contrast is checked by `scripts/check-contrast.mjs` reading **the raw hex values in `tokens.json`** — the same file the CSS is generated from — so the number being checked and the number being shipped are the same number by construction. **Checked, not eyeballed.**

### 10.4 SEO

| Rule | Budget |
|---|---|
| Indexable route shapes | exactly the 12 listed in §3 |
| Pages with a canonical that is not self-referencing | **0** |
| Dates in URLs | **0, ever** |
| Duplicate `<h1>` per page | **0** |
| Sitemap entries that are non-indexable | **0** |
| Tag pages with ≥3 posts missing from the sitemap | **0** |
| Structured data types emitted | `WebSite`, `Organization`, `WebPage`, `Article`, `BlogPosting` only. **Never HowTo, FAQPage or SearchAction** (CLAUDE.md). JSON-LD always via `JSON.stringify` in a filter, never hand-written in a template. |

### 10.5 Security headers (`src/_headers`)

| Header | Value on HTML | Rationale |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'sha256-__SCRIPT_HASH__' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://img.itworktv.com; font-src 'self'; connect-src 'self' https://cloudflareinsights.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'` | `__SCRIPT_HASH__` is substituted at build stage 5. `style-src 'unsafe-inline'` is required because **Pagefind UI injects a `<style>` element at runtime** (R12) — the risk is limited to CSS injection, which needs a pre-existing HTML injection. Tighten if Pagefind ever supports it. `connect-src` covers **both** injection modes (R9) so the shape does not change if we switch to manual embedding. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | |
| `X-Content-Type-Options` | `nosniff` | |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=(), interest-cohort=()` | Nothing here needs a device sensor. |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Only meaningful once the apex is on Cloudflare NS (R8). |

**Not set on `/`: `Cache-Control: public, no-transform`.** It would block Cloudflare's Web Analytics auto-injection (R9). Recording the reason next to the omission is the point — otherwise someone adds it back as a "performance best practice".

### 10.6 Cloudflare Pages free-tier ceilings (verified 2026-10-04)

| Limit | Free | Source |
|---|---|---|
| Builds / month | **500** | https://developers.cloudflare.com/pages/platform/limits/ |
| Build timeout | **20 min** | same |
| Files per site | **20,000** | same |
| Max file size | **25 MiB** | same |
| `_headers` rules | ≤ **100**, **2,000 chars per line** | same |
| `_redirects` | ≤ **2,000 static** + **100 dynamic** = 2,100 | same |
| Bandwidth / requests | **NOT PUBLISHED — no number is quoted anywhere in this project** | same |

R2 free tier, exactly: **10 GB-month storage, 1M Class A, 10M Class B, free egress, Standard only.** Custom domains need **no paid plan**, but the one-time "purchase R2" subscription checkout is required before a token can be created (R6). `r2.dev` is **dev-only and must never be CNAME'd**. https://developers.cloudflare.com/r2/pricing/

### 10.7 The client-JS allow-list and the mechanical budget rules

**The complete allow-list. Any `.js` file in `_site` that is not on this list fails the build (B3). There is no judgement call, no "it's only 200 bytes", and no grandfathering.**

| # | Allowed file | Where it loads | Size limit | Notes |
|---|---|---|---|---|
| 1 | inline `<script>` in `<head>` (`theme-init.njk`) | **every page** | ≤ 400 B | Byte-identical everywhere so one CSP hash covers the site (§1.3). Not a file, so B3 does not see it — A2.14 checks it. |
| 2 | `/assets/js/theme-toggle.js` | every page | **< 1 KB** | `defer`. |
| 3 | `/assets/js/copy-code.js` | **only** pages containing a code block | **< 1 KB** | `defer`. |
| 4 | `/pagefind/*.js` | **only** `/search/` | excluded from our budget | Pagefind's own runtime. Excluded by path prefix. |
| 5 | Cloudflare Web Analytics beacon | every page, edge-injected | n/a | Cloudflare's bytes, not ours. `type="module"`, **not** `async` (R9). |

Adding an entry requires a §6.4 row and the owner's approval (hard rule 1). **There is no 6th entry without asking.**

**The budget rules, implemented in `scripts/check-budgets.mjs`:**

| Rule | Check | Result |
|---|---|---|
| **B1** | `gzip(main.<hash>.css)` ≤ 15,360 bytes | fail |
| **B2** | exactly one file matching `_site/assets/main.<8 hex>.css`, and its name equals `cssManifest.css` | fail |
| **B3** | every `.js` under `_site` except `/pagefind/**` is on the allow-list above | fail |
| **B4** | deployed file count: warn ≥ 15,000, **fail ≥ 19,000**; any file ≥ 25 MiB fails | warn / fail |
| **B5** | no file > 1 MiB outside `/pagefind/` | warn |
| **B6** | every indexable page has exactly one canonical, absolute, `https://itworktv.com`, self-referencing; no `www` | fail |
| **B7** | every non-indexable page has **zero** canonicals; every indexable page has exactly one `<h1>` and a non-empty `<title>` and a meta description | fail |
| **B8** | no `<img>` sourced from the site's own origin; no `r2.dev` anywhere in `_site` | fail |
| **B9** | the only absolute external hosts in any HTML are `img.itworktv.com`, `static.cloudflareinsights.com`, `itworktv.com` | fail |
| **B10** | `_site/_headers` exists, contains no `__SCRIPT_HASH__`, and its `script-src` sha256 matches the real SHA-256 of the inline script bytes | fail |
| **B11** | for every `/tags/<tag>/` with **< 3** posts: `noindex,follow` present and **not** in `sitemap.xml` and **no** canonical | fail |
| **B12** | for every `/tags/<tag>/` with **≥ 3** posts: canonical present **and** present in `sitemap.xml` | fail |
| **B13** | no URL anywhere in `_site` contains `\d{4}/\d{2}/\d{2}` | fail |

**Why B10 exists.** The CSP hash is the one place where a silent mismatch degrades gracefully in the *wrong* direction — a stale hash just makes every page throw a CSP violation while still rendering. Making it a build failure means the mismatch is impossible to deploy.

### 10.8 Third-party requests — the complete list

| Allowed origin | What for | Why |
|---|---|---|
| `https://img.itworktv.com` | images | R2 behind our own subdomain |
| `https://static.cloudflareinsights.com` | analytics beacon | Cloudflare, free |
| `https://itworktv.com` | the site itself | apex only; `www` always 301s here |

Anything else requires a §6.4 row and owner approval. **No fonts from a third party** (system font stack — one fewer origin, one fewer request, better LCP), **no CDN-hosted libraries**, **no embedded video players**, **no social widgets**, **no consent banner** (no cookies are set; Web Analytics is cookieless and aggregation-only).

### 10.9 Change control

Changing any number in §10 requires: an entry in `PROGRESS.md` Decisions, a `main` decision, and — if it loosens a gate — the owner's explicit approval. **Silently widening a budget is the failure mode this section exists to prevent.**

---

*End of PLAN.md v1.0.0. Narrative companion: [`ARCHITECTURE.md`](./ARCHITECTURE.md). Session state: [`PROGRESS.md`](./PROGRESS.md).*