# PROGRESS — IT Work TV

> Resume instruction for a fresh session: read this file first, then `docs/PLAN.md`, then `CLAUDE.md`.
> Last updated: 2026-10-05 (UTC)

## Current phase

**Phase 1 — Foundation. Build green. `qa-auditor` full pass running.**
Next gate: audit clean → commit Phase 1 → **Phase 2 (core site)**.

## Done

- Repo initialised (`git init`) at `d:\DEV\itworktv.com`. Three commits: Phase 0 plan (`4d12aa8`), Phase 1 foundation (`ae3820f`), integration fixes (`e98d88d`).
- `.gitignore` created. `.claude/settings.json` is **ignored** because it contains a live plaintext API token (see Risks).
- `.nvmrc` (Node 22), `.editorconfig` created.
- Agent roster created: `.claude/agents/` — `site-architect`, `eleventy-engineer`, `design-engineer`, `seo-specialist`, `content-strategist`, `devops-engineer`, `qa-auditor`.
- `CLAUDE.md` created (stack, commands, hard rules, budgets, agent roster, how to add a post).
- **Cloudflare platform facts verified** (see below).
- **`docs/PLAN.md` written (~101 KB, §0–§10 incl. task graph, 19 risks, acceptance criteria, 13 budget rules).**
- **`docs/ARCHITECTURE.md` written (~17 KB).**
- **Phase 1 delivered by five agents** — design (tokens, CSS 4.2 KB gz, layouts, partials), SEO (head, JSON-LD, indexing, robots, sitemap, feeds), content (`tag-registry.json` 26 slugs, `WRITING.md` 220 lines), devops (`_headers` 12 rules, `_redirects`, CI, Dependabot, SETUP/IMAGES docs), eleventy (config, scripts, data, 60 unit tests).
- **The integrated build is green end to end** — all seven stages (`clean → validate → css → elephant → pagefind → headers → check:budgets`) and **13/13 budget rules pass**. `npm test` 60/60. `npm run check` 14/14 contrast pairs in both themes.
- **Corrections the architect made to the brief, accepted:**
  - **Build order is wrong in the brief.** "Eleventy → CSS" cannot work: the hashed CSS filename must exist *before* templates render its `<link>`. Correct order is `clean → validate → css → elephant → pagefind → headers → check:budgets`.
  - HTML minification is an Eleventy `addTransform`, not a separate post-process script (v3 has no native minifier).
  - `devops-engineer` model was left unstated by the coordinator — **now resolved to `sonnet`** per decision D5.

## Key architecture decisions (frozen — expensive to reverse)

| Decision | Where |
|---|---|
| CSS hash is hand-rolled: `scripts/build-css.mjs` minifies with lightningcss, SHA-256s the output, writes `.cache/css/main.<hash8>.css` + `.cache/css-manifest.json`. lightningcss has no fingerprint flag. | PLAN §1.3 |
| CSS manifest lives in `.cache/` (gitignored), **not** `src/_data/` — it is generated output, and `src/_data/` is committed source. | PLAN §1.3 |
| Collection names frozen (`posts`, `postsAll`, `tags`, `postsByTag`, `pagesAll`, `newestPost`) — four agents code against them. | PLAN §2.2 |
| One shared `is_indexable()` predicate drives both `head.njk` robots meta and `sitemap.njk` inclusion; a CI budget rule asserts they agree, so drift fails CI instead of shipping. | PLAN §2.3 |
| Indexability: `/404.html`, `/assets/**`, `/search/**`, feeds, sitemap, robots are never indexable; tag pages with < 3 posts get `noindex, follow` and leave the sitemap. | PLAN §2.3 |

## Verified Cloudflare facts (2026-10-04, sources in brackets)

Confirmed correct in the brief: 500 builds/mo Free, 20-min build timeout, 20,000 files/site, 25 MiB/file, `_headers` ≤ 100 rules (2,000 chars/line), `_redirects` ≤ 2,000 static + 100 dynamic = 2,100. R2 free tier exactly 10 GB-month / 1M Class A / 10M Class B / free egress. Apex custom domain requires the zone on Cloudflare nameservers [pages/custom-domains]. r2.dev is dev-only, rate-limited, and must not be CNAME'd [r2/public-buckets].

**Corrections to the brief — these win:**
1. **Web Analytics beacon is `type="module"`, NOT `async`.** `https://static.cloudflareinsights.com/beacon.min.js` with `data-cf-beacon='{"token":"…"}'`. Modules are deferred by default, so the "non-blocking" intent of the budget rule still holds. There is **no env var** for the token — it is a literal in the attribute. Recommended path: enable Metrics on the Pages project and let Cloudflare auto-inject, rather than hand-writing the script [web-analytics/faq].
2. **CSP `connect-src` depends on injection mode**: `'self'` when Cloudflare auto-injects (posts to your own `/cdn-cgi/rum`); `cloudflareinsights.com` when embedding manually. Also, auto-injection is **blocked by `Cache-Control: public, no-transform`** — keep that off `/`.
3. **Host-based `_headers` rules ARE supported** — the brief assumed they were not. Cloudflare documents exactly our use case: `https://:project.pages.dev/*` and `https://:version.:project.pages.dev/*` with `X-Robots-Tag: noindex`. No workaround needed. Matching rules merge. To remove a header, prefix `! `.
4. **`www` → apex cannot be done in `_redirects`** — domain-level redirects are explicitly unsupported there. Must be a Cloudflare zone-level Redirect Rule (or Bulk Redirects). No documented auto-www-redirect for Pages custom domains.
5. **Pages bandwidth/requests caps are no longer published.** Do not quote a number anywhere in the docs.
6. R2 **custom domains need no paid plan**, but you must "purchase R2" (a free-with-usage subscription checkout) before an API token can be generated. Permission name is exactly `Object Read & Write`, and it is **S3-API only, not the Cloudflare REST API**. Env: `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`. CLI: `wrangler r2 object put <bucket>/<key> --file=… --cache-control=…`.
7. **No CORS needed** for plain `<img>` loads from R2 — CORS is only enforced for `fetch`/XHR/canvas. Skip the CORS step unless JS ever reads image bytes.
8. Deploy Hooks accept a plain unauthenticated `curl -X POST <url>`; treat the URL as a secret. Exact literal path shape is not published — read it from the dashboard.

## Verified Eleventy/toolchain facts (2026-10-04)

- Eleventy **3.1.6** is current stable (2026-06-02); v4 exists only as `4.0.0-alpha.10`.
- v3 supports **both** ESM and CJS. `"type": "module"` + `eleventy.config.js` works as the brief requires. Async config callbacks and top-level `export const config = {}` supported. Dev server default port **8080**.
- **`@11ty/eleventy-plugin-rss` v3.1.0 changed its API**: ESM, and helpers are **named exports only** (`feedPlugin`, `absoluteUrl`, `convertHtmlToAbsoluteUrls`, `dateToRfc822`, …) — not properties of the default export. Trap for eleventy-engineer.
- **`@11ty/eleventy-plugin-syntaxhighlight` 5.0.2**, default highlighter **PrismJS**, build-time, zero client JS (docs are explicit). **Shiki is unsupported** by the plugin — Prism it is; theme colours are bound via a Prism theme CSS tied to our theme variables.
- **Eleventy v3 enables ZERO markdown-it plugins.** markdown-it ^14.2.0 ships bare. `markdown-it-anchor` 10.0.0, `markdown-it-attrs` 5.0.1, `markdown-it-footnote` 4.0.0, `markdown-it-container` 4.0.0 must be wired manually via `setLibrary("md", …)`.
- **`html-minifier-terser` 7.2.0 last published 2023-04-11 — effectively unmaintained.** Eleventy v3 has no native HTML minifier; we wire `addTransform("htmlmin", …)`. Accepted for now, flagged as a risk (project targets low maintenance for years + Dependabot).
- **`lightningcss` 1.33.0 has NO fingerprint/hash option** (napi surface: `filename`, `minify`, `source_map`, `input_source_map`, `css_modules`). The "single fingerprinted file" requirement means **we compute the content hash ourselves** in `scripts/` and rewrite the reference. Design decision to lock in PLAN.md.
- `pagefind` **1.5.2** — `npx pagefind --site <dir>`. `--output-path` / `--glob` **not verified**; to-check at https://pagefind.app/docs/reference-cli-options/
- Node >=18 required by Eleventy; the whole stack is Node 22 compatible.

## Tooling note

Custom agent types in `.claude/agents/` are **only registered at session start**. They could not be used as `subagent_type` in this session, so delegates are spawned as `general-purpose` with the persona from their agent file inlined in the prompt. **A session restart registers the roster for real** — recommend restarting after GATE 1 approval.

## Phase 1 status (live)

| Agent | Status | Notes |
|---|---|---|
| `eleventy-engineer` | running | config, scripts, tests; receiving owner-spec limit correction + 2 design-engineer routing fixes (build-css `filename`, selective `addPassthroughCopy` excluding `theme-init.js`) |
| `design-engineer` | **done** | CSS 4,049 B gzipped (budget 15,360), theme-init 144 B, toggle 624 B, copy-code 1,006 B — all < 1 KB; all contrast pairs pass; templates verified through Eleventy's own loader path. **P2 contract:** imported-module macros don't see caller context; `post-card`/`post-meta`/`tag-chip` take the registry as explicit argument |
| `seo-specialist` | **done** | 211 assertions + 20-case macro suite through real nunjucks 3.2.4. Found+fixed a Nunjucks `set`-in-`for`-loop frame-scoping bug. Templates at `src/` root (feed/sitemap/robots) — `_includes/` files never render as pages. P2.13 in PLAN corrected: `BreadcrumbList` IS emitted on posts + tag pages (owner brief §6.4) |
| `content-strategist` | **done** | 26 tags, WRITING.md aligned to owner spec |
| `devops-engineer` | **done** | _headers (12 rules), _redirects, .env.example, ci.yml, dependabot, SETUP.md, IMAGES.md (storage math: ~148 yrs to 10 GB) |

## Next (Phase 1 — Foundation, in progress)

Running in parallel against the frozen PLAN §2.2 contract:

- `eleventy-engineer` — P1.1, P1.2, P1.4, P1.6 (import-macro spike), P1.11, P1.12, P1.13, P1.16 (config, data files, scripts, unit tests, new/queue)
- `design-engineer` — P1.7, P1.8 (tokens.json, main.css, Prism theme CSS, layouts, partials, theme-init/toggle/copy-code, wordmark SVG)
- `seo-specialist` — P1.9, P1.10, P1.18 (head.njk, jsonld.njk, indexing.njk, robots, sitemap, feeds, SEO.md)
- `content-strategist` — P1.5, P1.17 (tag-registry.json 26 slugs, WRITING.md)
- `devops-engineer` — P1.14, P1.15, P1.19 (_headers, _redirects, .env.example, ci.yml, dependabot, SETUP.md, IMAGES.md)

Then: `npm run build` must be green → commit Phase 1 → `qa-auditor` full pass → fix blockers → commit → **Phase 2**.

## Decisions (added at integration, 2026-10-04/05)

| # | Decision | Why |
|---|---|---|
| D14 | **The tag registry file is `src/_data/tag-registry.json`, never `tags.json`.** A global data file named `tags.json` binds Eleventy's reserved `tags` key, which `TemplateData.getCleanedTagsImmutable` requires to be a slug string/array. The registry is an object, so it aborts every build. The registry is read from disk by `eleventy.config.js` (`collections.tags`) and by `validate-content.mjs`, never through global data. | Found empirically: every build died with `String or Array expected for 'tags'`. Not documented anywhere in the Eleventy docs — recorded here so nobody renames it back. |
| D15 | **Nunjucks template references carry the `.njk` extension** (`{% extends "layouts/base.njk" %}`). Eleventy's Nunjucks `FileSystemLoader` sets no `defaultExtension`, so an extension-less name is a fatal *template not found*. The standard Eleventy idiom `{% extends "base.njk" %}` also fails here because `_includes` is the loader root — layouts are addressed from that root, not from their own folder. | Cost three build iterations to diagnose; the loader has exactly two search roots (`src/_includes/`, project root). |
| D16 | **`npm test` (60 unit tests) and `npm run check` (contrast) are separate gates from `npm run build`.** All three must be green before Phase 2 starts — the audit rules require it. | A green build does not prove the validator's limits or the token contrast; those scripts run outside the build chain. |

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Orchestrator delegates; no feature code written at the orchestrator level | keeps ownership boundaries crisp |
| D2 | Local toolchain is Node **v24.19.0**, but `.nvmrc` and Cloudflare `NODE_VERSION` pin **22** | brief mandates Node 22 LTS; local Node 24 is a superset. Verify no plugin breaks on 24 locally. |
| D3 | `.claude/settings.json` gitignored, file left on disk | it holds a live token and drives the current session; deleting it would break the session |
| D4 | Seed posts isolated in `src/posts/seed/` | deletable in one step |
| D5 | **Model routing**: `site-architect`, `eleventy-engineer`, `seo-specialist`, `qa-auditor` run on the strong model (`stealth/space-bunny-alpha`); `design-engineer` and `content-strategist` stay on `qwen/qwen3.8-27b:free` | owner decision, 2026-10-04. `.claude/agents/*.md` frontmatter updated to match. Split by precision-sensitivity, and should reduce the 402 failures seen from the free endpoint. |
| D6 | Web Analytics via **Pages Metrics auto-injection** rather than a hand-written `<script>` | fewer bytes under the client-JS budget, and Cloudflare owns the CSP shape (`connect-src 'self'`). Requires NOT setting `Cache-Control: public, no-transform` on `/`. |

## Open questions (resolved at GATE 1, 2026-10-04)

1. **Author** — placeholder "IT Work TV Team" stands; no photo. Tagline confirmed: **"Sharing daily tips & tricks"**.
2. **Brand colour — CONFIRMED from `itworktv_images/`**: cyan ≈ `#22D3EE` (dark theme), ≈ `#0E7490` (light theme, contrast-gated), deep-navy surface ≈ `#0A1220`. `design-engineer` finalises in `tokens.json`; the contrast script is the arbiter.
3. **Contact email** — default `contact@itworktv.com` in effect (owner supplied a personal Gmail for git only; the plan deliberately keeps it off the public site).
4. **GitHub — CONFIRMED**: user `itworktv`, public repo `itworktv`. Repo-local identity: `itworktv` / `itworkwebmaster@gmail.com`.
5. **Cloudflare nameservers** — assume not; documented in `docs/SETUP.md`.
6. **License** — all rights reserved; code snippets MIT.

## Decisions (added at GATE 1)

| # | Decision | Why |
|---|---|---|
| D7 | Brand reference assets committed to `itworktv_images/` (logo PNG, banner JPG, ~1.8 MB) | Single source of truth for the wordmark, favicon and palette; 1.8 MB in git is trivial, they are not deploy artefacts (only `_site/` ships) |
| D8 | Git identity set **repo-local** only (`git config user.name/user.email`, not `--global`) | nothing else in the user's machine is touched; identity belongs to this repo |
| D9 | Analytics confirmed as **Pages Metrics auto-injection** (D6 stands, owner confirmed) | fewer first-party bytes, Cloudflare owns the beacon's CSP shape |
| D10 | The contract from PLAN §2.2 is the **frozen contract for Phase 1** — no re-announcement task needed; agents code against it now | PLAN §2.2 already froze the names; a separate "freeze" task would add ceremony without information |
| D11 | **PLAN §4 corrected to the owner's hard spec** (found via content-strategist's cross-check): `title` ≤ 65 (was 15–70), `description` 120–160 (was 120–158), `tags` 1–5 (was 1–3), `date` = `YYYY-MM-DD` date-only (was full ISO 8601), `tested_on` optional (was required). The architect's numbers are demoted to soft editorial guidance in WRITING.md. **Owner brief wins over architect refinement.** | The brief is the contract; validator + docs + QA all had to agree on one set of numbers |
| D12 | **Tag registry expanded 20 → 26**: added `dns`, `azure`, `aws`, `databases`, `sql-server`, `postgresql` (named explicitly in the owner's brief; architect's refined list had dropped them). Thin tags are zero-cost (`noindex, follow`, out of sitemap). | Stated topics include cloud (Azure/AWS/GCP) and databases; the taxonomy must have a home for them |
| D13 | **Phase 1 deviations accepted (devops-engineer flags)**: (a) `style-src 'self' 'unsafe-inline'` in the CSP — Pagefind injects `<style>` at runtime; **QA must verify in Phase 2 that removing it does not break `/search/`; if it doesn't, drop `unsafe-inline`** (recorded as risk, not silently kept). (b) Six extra path `noindex` rules in `_headers` for feeds/sitemap/robots/search/pagefind — consistent with §2.3. (c) `ci.yml` targets branch `main`. (d) `labeler.yml` + `ISSUE_TEMPLATE` dropped (one-author site, no ceremony) — PLAN §2 tree updated. (e) PLAN §2 `images-src/` wording fixed: originals are **gitignored and local-only**, per the owner brief and `.gitignore`. | Deviations were flagged by the agent, reviewed by the orchestrator, and recorded here — nothing is silent |

## Risks / blockers

- **SECURITY — open.** `.claude/settings.json` contains `ANTHROPIC_AUTH_TOKEN` (an OpenRouter key, plaintext) and `ANTHROPIC_BASE_URL`. It is now gitignored, but **the token is exposed on disk and should be rotated by the owner.** It must never be committed.
- Node on this machine is 24, not 22; the plan targets 22 for CI/Pages. Local v24 ran the whole pipeline green — CI on 22 is unverified.
- D13(a) is still open: `style-src 'unsafe-inline'` in the CSP must be re-tested in Phase 2 once `/search/` exists. Pagefind injects `<style>` at runtime, so the escape hatch may be removable.
- **No posts exist yet.** Every collection (home, tags, archive, pagination, sitemap, feed, search index) is untested against real content. Phase 2 must seed posts before any of those paths can be verified.