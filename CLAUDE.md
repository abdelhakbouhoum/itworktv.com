# CLAUDE.md — IT Work TV

A fast, clean blog publishing **one practical IT tip per day** for sysadmins, helpdesk, DevOps and IT pros.
Reader arrives from Google with one specific problem and wants the answer **in under 60 seconds**.

- Site: https://itworktv.com
- Goals, in priority order: **(1) organic search traffic, (2) speed and readability, (3) near-zero running cost, (4) low maintenance for years.**
- **Total running cost must be $0.** No paid service or plan.

## Stack

| Layer | Choice |
|---|---|
| Node | **22 LTS** (`.nvmrc`); local dev may be newer — CI and Pages pin 22 |
| Build | **Eleventy v3** (ESM, `eleventy.config.js`) |
| Templates | **Nunjucks** |
| Content | **Markdown** via `markdown-it` (anchors, attrs, footnote, container/callout) |
| CSS/JS | **Vanilla only.** No React/Vue/Svelte/Tailwind/Bootstrap/jQuery |
| CSS pipeline | `lightningcss` → one minified, fingerprinted file |
| HTML | `html-minifier-terser` |
| Search | `pagefind`, indexed over article bodies only |
| Images | `sharp` (dev) → Cloudflare **R2** behind `https://img.itworktv.com` |
| Hosting | **Cloudflare Pages** (Git integration, build `npm run build`, output `_site`) |
| Analytics | **Cloudflare Web Analytics** |
| Repo / CI | **GitHub** Actions + Dependabot |

## Commands

| Command | Purpose |
|---|---|
| `npm ci` | clean install (CI and first clone) |
| `npm run dev` | Eleventy dev server with live reload |
| `npm run build` | production build: CSS → HTML minify → Pagefind → budget check |
| `npm run check` | front-matter validation, budgets and image checks, no deploy |
| `npm run new -- "Post title" --tags windows,powershell` | scaffold a post, auto-assign the next free publish date |
| `npm run queue` | list upcoming scheduled posts and gaps in the daily schedule |
| `npm run img:optimize` | sharp: strip metadata, responsive WebP variants → `images-out/` + `src/_data/images.json` |
| `npm run img:upload` | upload to R2 (credentials from **env only**, never committed) |

> These are the agreed contract; `package.json` is created in Phase 1. All scripts are **cross-platform Node `.mjs`** — the owner may be on Windows/PowerShell, so never use bash-only tooling (`sed`, `awk`, `cp`, `rm`, `date -d`).

## How to add a post

1. `npm run new -- "Find the process using a port on Windows" --tags windows,networking`
2. Write the post following the archetype in `docs/WRITING.md`:
   **TL;DR → Problem → Steps/Commands → Verify → Troubleshooting → Rollback/Risks → References**
3. Drop any screenshots in `images-src/YYYY/MM/<slug>/`, then `npm run img:optimize` and `npm run img:upload`.
4. `npm run check` must pass. **A future `date` schedules the post**; `draft: true` keeps it out of production.
5. Commit and push. The site deploys.

**Golden rule: only publish commands you have actually tested.**

## Hard rules

1. **No client JavaScript without the owner's explicit approval.** Pages ship **zero JS** by default. The only exceptions:
   - (a) the inline theme-init script in `<head>` (prevents theme flash),
   - (b) the theme-toggle handler (**< 1 KB**),
   - (c) the Cloudflare Web Analytics beacon (production only, async),
   - (d) progressive enhancements loaded only where needed: the copy-code button on pages containing code (**< 1 KB**) and Pagefind **only** on `/search/`.
   Anything else — no matter how small — requires asking the owner first.
2. **No secrets in the repo.** Use `REPLACE_ME` placeholders and document where each value goes. `.env`, `.claude/settings.json` and similar are gitignored.
3. **Never `git push`, never create remote resources, never handle real secrets** without the owner's approval. Commit locally only.
4. **Never add a dependency silently.** No `npm audit fix --force`. Anything outside the approved list needs justification in `docs/PLAN.md` and the owner's approval.
5. **URLs never change once published.** No dates in URLs. A rename becomes a 301 in `src/_redirects`.
6. **Dates are UTC.**
7. **Budgets are hard gates**, enforced by `npm run check` and CI (see below).

## Budgets

| Budget | Limit |
|---|---|
| Lighthouse mobile (home / post / tag) | Performance **≥ 98**, Accessibility / Best Practices / SEO = **100** |
| LCP | **< 1.5 s** |
| CLS | **0** |
| TBT | **≈ 0** |
| CSS | **≤ 15 KB gzipped**, one fingerprinted file, `Cache-Control: immutable` on `/assets/*` |
| HTML | minified |
| Third-party requests | **only** `img.itworktv.com` and Cloudflare Web Analytics |
| Deployed file count | warn at **15,000**, fail at **19,000** |
| Cloudflare Pages free | 500 builds/month, 20-min timeout, 20,000 files, 25 MiB/file, `_headers` ≤ 100 rules, `_redirects` ≤ 2,100 rules |

**Contrast ≥ 4.5:1 in both light and dark themes**, verified by an automated script over the design tokens. Target **WCAG 2.2 AA**.

## Agent roster

Feature code is written by sub-agents, never by the orchestrator. Each owns its paths exclusively and must route cross-boundary changes back through the orchestrator.

| Agent | Model | Owns |
|---|---|---|
| `site-architect` | opus | `docs/PLAN.md`, `docs/ARCHITECTURE.md` |
| `eleventy-engineer` | opus | `eleventy.config.js`, `package.json`, `src/_data/`, `scripts/`, all Eleventy internals |
| `seo-specialist` | opus | `head.njk`, `jsonld.njk`, sitemap, robots, feed metadata, `docs/SEO.md` |
| `qa-auditor` | opus | nothing — read-only, reports only |
| `design-engineer` | sonnet | `src/assets/css/`, `src/assets/js/`, `src/_includes/layouts/`, visual partials, logo and icons |
| `content-strategist` | sonnet | `src/posts/seed/`, `src/pages/*.md`, tag descriptions, `docs/WRITING.md` |
| `devops-engineer` | sonnet | `.github/`, `src/_headers`, `src/_redirects`, `docs/SETUP.md`, `docs/IMAGES.md`, image scripts |

> Model routing was set by the owner on 2026-10-04: the precision-sensitive roles (architecture, Eleventy pipeline, SEO, audit) run on the strong model; design and content stay on the cheap one. Note that `ANTHROPIC_DEFAULT_SONNET_MODEL` is mapped to a free third-party model in `settings.json`, so "sonnet" here is not a frontier model.

## Docs

| Doc | What it holds |
|---|---|
| `docs/PLAN.md` | architecture, folder tree, URL map, front-matter schema, tag registry, dependency list, task graph, risks, acceptance criteria |
| `docs/ARCHITECTURE.md` | how the system fits together |
| `docs/PROGRESS.md` | done / next / decisions / open questions — **read this first in a new session** |
| `docs/WRITING.md` | post archetype, pre-publish checklist, SEO content conventions |
| `docs/SEO.md` | technical SEO decisions and the launch checklist |
| `docs/SETUP.md` | click-by-click go-live checklist for the owner |
| `docs/IMAGES.md` | image workflow, `r2:` syntax, storage math |

## Conventions

- Front matter lives in `src/posts/YYYY/YYYY-MM-DD-slug.md`; **the slug comes from the filename**.
- `tags: [a, b, c]` — **the first tag is the primary topic**. Every tag must exist in the registry `src/_data/tags.json`.
- Image syntax: `![Alt text](r2:2026/10/slug/shot.webp "Optional caption")` → rewritten at build time to a `<figure>` with `srcset`, explicit `width`/`height`, lazy loading (cover images get `fetchpriority="high"` instead).
- JSON-LD is generated with `JSON.stringify` in a filter — **never hand-written JSON in a template**.
- Never emit HowTo, FAQPage or SearchAction structured data.
- Tag pages with fewer than 3 posts get `noindex,follow` and stay out of the sitemap.
- Syntax highlighting happens **at build time** — zero client JS.