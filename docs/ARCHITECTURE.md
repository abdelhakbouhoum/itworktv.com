# ARCHITECTURE — IT Work TV

> **This is the narrative, not the spec.** Structure, numbers, tables and gates live in [`PLAN.md`](./PLAN.md) — this document explains *why the system is shaped this way* and links there for anything exact. Where the two disagree, `PLAN.md` is canonical.
> Version **1.0.0** · 2026-10-04 · owner `site-architect`.

---

## The one-sentence version

A Markdown file on disk becomes a minified, content-hashed, zero-JavaScript HTML page on Cloudflare's edge through one deterministic pipeline that the author's `git push` starts and nothing else has to babysit.

---

## 1. What problem this shape solves

The site has an unusually specific brief: a reader arrives from Google with **one problem**, wants the answer **in under sixty seconds**, the author publishes **once a day**, and the running cost must be **$0 forever**.

Those four constraints eliminate most of the normal design space before any tooling is chosen:

- **"Under 60 seconds"** kills everything slow. That is why there is no client JavaScript by default, no web font, no third-party embed, and no image above the fold without explicit dimensions. It is also why the whole reading experience must survive with the network half broken.
- **"Once a day, for years"** kills anything that needs babysitting. A CMS would put the author in an editor instead of in a Markdown file, and would create an authentication surface to secure. A plain file in Git already has history, review, and a rollback story for free.
- **"$0 forever"** is the hard filter. Every rejected dependency in [`PLAN.md` §6.4](./PLAN.md) was rejected at least partly on this axis, and it is why Cloudflare Pages + R2 + Web Analytics were chosen over the usual alternatives — not because they are the most capable, but because they have a free tier that does not expire and a traffic cap nobody has hit.
- **"Low maintenance"** is why the stack is pinned to *stable* lines. Eleventy **v3** is used, not v4, even though v4 is moving — a content site should ride the stable line, not fund someone's alpha.

What is left is deliberately austere: Markdown in, HTML out, one stylesheet, at most two tiny scripts, and a hosting layer that does the rest.

---

## 2. The shape of a request

A reader loads `https://itworktv.com/posts/find-the-process-using-a-port/`.

1. **Cloudflare's edge** answers from cache if it can. HTML is cached; `/assets/*` is `immutable` because the filename contains a content hash (§6).
2. The response carries a **`Content-Security-Policy`** whose `script-src` allows exactly three things: `'self'`, one SHA-256 of our inline theme script, and `static.cloudflareinsights.com`. There is no `'unsafe-inline'` for scripts. The policy was hashed into `_headers` at build time, which is why the inline script must be byte-identical on every page — a per-page script would need a per-page policy, and a static header file has exactly one.
3. The browser parses **one** HTML document and **one** stylesheet. `<link rel="preconnect">` to `img.itworktv.com` is in the head, so the first image starts fetching in parallel with the CSS.
4. The inline script in `<head>` sets `data-theme` on `<html>` **before first paint**. This is the only reason there is no theme flash, and it is why CLS is exactly 0 rather than nearly 0.
5. Content images come from R2 with long-lived cache headers and are never downloaded by the site build.
6. Cloudflare appends the Web Analytics beacon at the edge. It is a `type="module"`, so it is deferred by construction and cannot block rendering.

If JavaScript is disabled, or never arrives, **nothing on a post page changes**. There is no content behind a script.

---

## 3. The build, as data flowing

The full command table is in [`PLAN.md` §1.2](./PLAN.md). What matters is the *order*, and one order in it is not the obvious one.

```
validate → CSS (lightningcss + hand-rolled hash) → Eleventy render (+ HTML minify) → Pagefind → CSP hash → budget gate → deploy
```

**CSS is built before Eleventy renders, and this is the load-bearing decision of the whole build.** The stylesheet's filename contains a content hash, and the HTML template has to print that filename into a `<link>` tag. Render the HTML first and the hash does not exist yet — you would be reduced to either an unhashed filename (killing `immutable` caching) or a second HTML pass to patch the reference in. Building CSS first means the filename is known before a single page is rendered, and Eleventy reads it from a small JSON manifest through a single global data function. One file produces the hash, one manifest carries it, one template prints it. `_headers` never needs to know the name at all, because it matches `/assets/*` with a glob.

**Minification is a transform, not a step.** Eleventy v3 has no native HTML minifier, so `html-minifier-terser` is registered via `addTransform("htmlmin", …)`, gated on the output path ending in `.html`, registered last so it runs after everything else, and skipped during `--serve`. Putting it in the chain as a separate process would mean rewriting every file on disk after Eleventy had finished thinking it was done.

**The CSP hash closes the loop.** Because `theme-init.njk` is a single file with no templating in it, its bytes are constant, so their SHA-256 is constant, so one `sha256-…` value in a static `_headers` covers the entire site. The build computes it from the actual file rather than from a copy of it, and budget rule B10 fails the build if the value in the emitted header does not match the bytes that shipped. The most common way to break a CSP is a well-meaning one-character edit to an inline script; here that edit fails the build instead.

**The budget gate runs last, on the artefact that ships.** Not on the source, and not on an approximation — on `_site/` after minification, after Pagefind, after headers. Every gate in [`PLAN.md` §10.7](./PLAN.md) measures the same bytes a reader will receive.

---

## 4. Why these particular libraries

Four decisions carry most of the weight. The rest of [`PLAN.md` §6](./PLAN.md) is one-line justifications.

**Build-time syntax highlighting.** `@11ty/eleventy-plugin-syntaxhighlight` uses Prism and produces zero client JavaScript — its own documentation says so plainly. The obvious alternative, Shiki, produces nicer output and is the more fashionable choice, but **it is not available here**: the plugin is Prism-only and Eleventy v3.1.6 contains no Shiki reference at all. Taking Shiki would mean abandoning the plugin and hand-writing a highlighter against `addMarkdownHighlighter()` — trading ~200 lines of maintained code for a feature (TextMate grammars) that a site of PowerShell and bash posts does not need. Colours then come from a hand-written Prism theme that maps every `.token.*` rule onto a `var(--code-*)` token, which is how code blocks follow the light/dark theme with no JavaScript involved.

**Four markdown-it plugins, added explicitly.** Eleventy v3 loads markdown-it 14.2 with **zero plugins enabled**. Anchors, attribute blocks, footnotes and callout containers are not optional conveniences here: anchors make one command in a long post linkable, callouts make a destructive command visually impossible to skim past, and footnotes back the References section of the writing archetype. Each is a small, stable, single-purpose package.

**Hand-rolled CSS fingerprinting.** `lightningcss` has no hash flag — its option surface is `filename`, `minify`, `source_map`, `input_source_map`, `css_modules`. Content-hash filenames are therefore our own eleven lines of code, which is a cost worth paying once: the alternative is either a whole extra build tool in the chain or serving a mutable filename behind a cache header that promises immutability. The scheme is specified step by step in [`PLAN.md` §1.3](./PLAN.md) and unit-tested, precisely because it is the one piece of custom logic in the build.

**Static search.** Pagefind builds a full-text index at build time and ships it as static files, loaded on `/search/` and nowhere else. It costs no service, no API key, no network call at query time, and no index on the site's origin beyond a directory of JSON shards. The indexed scope is deliberately narrow — article bodies only, with header, footer and navigation excluded — so a search for "port" finds the post about ports and not the word "Port" in a nav label.

---

## 5. How content becomes structured data

Markdown is only half the story; the other half is making sure a post is discoverable by someone who has never seen the site.

**The primary tag is a real decision, not decoration.** The first entry in a post's `tags` array drives which tag page the post leads with and which feed a subscriber following one topic is most likely to want. Capping tags at three is what keeps the taxonomy navigable; a site with twenty tags and one post each has a directory, not a taxonomy.

**Tag pages earn their indexability.** A tag with fewer than three posts is `noindex,follow` and stays out of the sitemap — but `follow` is the part that matters, because the thin page still passes authority to the posts it links to instead of trapping it. The rule is implemented once, in a Nunjucks macro that both the `<head>` and the sitemap import, and it is *also* checked mechanically: if the head and the sitemap ever disagree about a tag, the build fails. Where two implementations could drift, we chose the failure mode we can detect over the structure we cannot prove.

**Structured data is generated, never written.** JSON-LD comes out of a `JSON.stringify` filter so a missing field or a stray quote is a build error rather than a silent schema break. The type list is short on purpose: `WebSite`, `Organization`, `WebPage`, `Article`, `BlogPosting`. Notably absent are HowTo, FAQPage and SearchAction — a HowTo block on content that has not been reviewed for Google's structured-data policies is a rich-results risk with no upside.

**One canonical host, self-referencing, on every indexable page** — *including* paginated ones. Page 2 of `/posts/` canonicalises to itself, not to page 1. Collapsing pagination to page one hides real content from readers and does not reliably consolidate ranking; self-canonicalising is both more honest and less work.

---

## 6. Runtime assets: the whole story in five rows

There is no bundler in this project, and there is no minifier for the JavaScript, because there is almost no JavaScript.

The complete list is in [`PLAN.md` §10.7](./PLAN.md) and it is enforced, not aspired to: **any `.js` file in the output that is not on the allow-list fails the build.** This is the single most valuable budget rule here, because "zero client JavaScript by default" does not fail on its own — it decays, one defensible 200-byte script at a time, and by the time anyone measures Lighthouse the damage is done and everyone's memory of the exception is gone. A build that rejects the unlisted script makes the decision visible at the moment someone wants to make it.

The one genuinely subtle runtime dependency is the theme toggle. The reason the JS is under a kilobyte is that the theme logic is split deliberately: the part that must run before first paint lives inline in `<head>` as roughly fifteen lines of DOM work, and everything else — the button, its accessible state, the persistence — is a small deferred file. Splitting it that way is what buys both the flash-free load and the byte-identical-inline-script property the CSP hash depends on. **Those two requirements are the same requirement**, which is the kind of coupling worth naming explicitly so nobody later "tidies" one half and breaks the other.

---

## 7. Images, analytics and the edge

**Images never touch the site build.** A post writes `![Alt](r2:2026/10/<slug>/shot.webp)`, a markdown-it renderer expands it into a `<figure>` with a `srcset`, explicit `width`/`height` and lazy loading, and the bytes live in R2 behind `img.itworktv.com`. The consequences ripple further than storage costs: the deployed file count stays in the hundreds instead of the tens of thousands, the Pages per-file and total-file limits become irrelevant, and image work never blocks a deploy.

**Cloudflare Web Analytics is preferred over hand-embedding**, and the preference has a specific reason: when Cloudflare injects the beacon itself, the beacon posts to your own origin (`/cdn-cgi/rum`), so the CSP's `connect-src` only needs `'self'`. That is a smaller policy than one naming a third-party origin. The cost of the choice is that auto-injection is blocked by `Cache-Control: public, no-transform` — so that header stays off `/`, and the reason is written next to the omission so nobody helpfully adds it back.

**`www` is a zone-level problem, not a files-level one.** Domain-level redirects are explicitly not supported in Pages `_redirects`, so `www.itworktv.com` → `itworktv.com` is a Cloudflare zone Redirect Rule, configured by hand in Phase 3. This is why the canonical policy can be a single unconditional "apex, self": there is never a host choice to make, because one of the two hosts is always a 301.

---

## 8. How the system is meant to fail

Good architecture is mostly a story about bad days, so here are the ones this shape has already decided in advance.

**A dependency stops being maintained.** `html-minifier-terser` has had no npm release since 2023-04-11, and it is the only thing standing between us and unminified HTML. The design already knows this: HTML minification is **not load-bearing for any budget** — the pages are small regardless — so the failure response is to delete a transform, not to find a replacement. It is pinned to an exact version, audited in CI, has a 40-line conservative fallback written down in advance, and is reviewed quarterly. The site does not need a minifier; it needs a minifier *if one is convenient*.

**A content-hash bug ships a bad filename.** Budget rule B2 fails the build unless the output directory contains exactly one `main.<8 hex>.css` and its name matches the manifest. A fingerprint mismatch cannot reach production.

**A CSP goes stale.** A one-character edit to the inline script would, without B10, produce a header that no longer matches and a console full of violations on every page. B10 recomputes the hash from the actual bytes and fails the build on mismatch.

**Two owners disagree about a tag.** The head and the sitemap have separate implementations of "is this indexable" in the general case; here they share one macro, and where sharing is uncertain (Nunjucks `import` behaviour is timeboxed at P1.6) the fallback is a duplicated predicate — but in *both* cases B11 and B12 assert agreement and fail the build if they diverge. Where we cannot prove two things cannot disagree, we make disagreement expensive.

**The wrong JS ships.** B3. No amount of good intent survives contact with a deadline and a 200-byte snippet; a build-time allow-list does.

**Cloudflare changes something.** Every limit in [`PLAN.md` §10.6](./PLAN.md) is dated and sourced, and re-verification is a quarterly task with an owner. Pages bandwidth and request caps are **no longer published**, so no number for them is quoted anywhere — a plan that cites a limit which does not exist is worse than a plan that admits ignorance.

---

## 9. The trade-offs, stated plainly

| Chosen | Given up | Why the trade is worth it |
|---|---|---|
| Hand-written CSS and layout | Component frameworks, design-system reuse | $0, ~15 KB total, no runtime, no build-tool risk. The site has roughly ten distinct visual patterns. |
| One monolithic `main.css` | Code splitting, per-page CSS | The whole sheet is under the budget for every page. Splitting would add requests to save bytes nobody spends. |
| Pinned Eleventy v3 | v4 features, newer markdown behaviour | v4 is an alpha. A site that must run for years should ride stable. |
| `mailto:` contact page | A contact form | A form needs a JS handler, spam defence and a mail provider. Each breaks either the zero-JS rule or the $0 rule. `mailto:` needs neither. |
| Images on a separate subdomain | Same-origin image simplicity | Cache isolation, and the site origin stays small enough to serve without thinking about it. |
| A weekly manual publish ritual | CMS convenience | The ritual is one command and one push. A CMS would trade a security surface and an editor for it. |
| RSS 2.0 + JSON Feed, no per-tag Atom | Modern feed ecosystem | Both formats, ~30 newest entries, one plugin and one template. Feed diversity is not a ranking factor and readers do not block on it. |

---

## 10. Where to read next

| Question | Document |
|---|---|
| What are the exact numbers, gates, schemas, tags, dependencies, tasks? | [`PLAN.md`](./PLAN.md) |
| What is done, decided, and still open? | [`PROGRESS.md`](./PROGRESS.md) |
| How do I write a post? | [`WRITING.md`](./WRITING.md) |
| What are the technical SEO decisions? | [`SEO.md`](./SEO.md) |
| How do I take the site live? | [`SETUP.md`](./SETUP.md) |
| How do images work end to end? | [`IMAGES.md`](./IMAGES.md) |

---

*End of ARCHITECTURE.md v1.0.0. Spec companion: [`PLAN.md`](./PLAN.md).*