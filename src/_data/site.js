/**
 * src/_data/site.js — global site constants (PLAN §2, §3.1, §0 Q1/Q3/Q4).
 *
 * Single source of truth for the canonical host: `site.url`. No template
 * hardcodes the domain (§3.1 rule 4). Every canonical, feed and sitemap URL
 * derives from this one object.
 *
 * Note (PROGRESS D6/D9): Web Analytics is auto-injected by Cloudflare Pages
 * Metrics, so there is deliberately NO analytics token in this repo — nothing
 * to REPLACE_ME.
 */

const site = {
  // ---- Brand (Q1: author placeholder stands, no photo — monogram SVG instead)
  title: "IT Work TV",
  name: "IT Work TV",
  brand: "IT Work TV",
  tagline: "Sharing daily tips & tricks",
  description:
    "One practical, tested IT tip per day for sysadmins, helpdesk, DevOps and IT pros. The answer in under 60 seconds.",

  // ---- Canonical host. Apex only — www always 301s here (§3.1, §8.7).
  url: "https://itworktv.com",

  // ---- Author byline (Q1). Object shape on purpose: head.njk and the author
  // partial read `site.author.name` / `site.author.bio` (seo-specialist P2.2,
  // 2026-10-04 routing). Monogram + full registry live in authors.json.
  author: {
    name: "IT Work TV Team",
    bio: "Working IT professionals who run every command before it goes live. One tested tip a day, no filler.",
  },

  // ---- Contact (Q3 default; mailto only, no form — PLAN §3).
  email: "contact@itworktv.com",

  // ---- Feeds / sitemap (absolute URLs, consumed by head.njk, robots.txt).
  rssUrl: "https://itworktv.com/feed.xml",
  jsonFeedUrl: "https://itworktv.com/feed.json",
  sitemapUrl: "https://itworktv.com/sitemap.xml",

  // ---- Pagination (posts per listing page: /posts/ and /tags/<tag>/).
  postsPerPage: 10,

  // ---- Public repo (Q4 confirmed 2026-10-04).
  repository: "https://github.com/itworktv/itworktv",

  // ---- PWA manifest (data-driven <link> in head.njk — never hardcode in a
  // template). Shipped via the selective src/assets passthrough allow-list.
  webmanifest: "/manifest.webmanifest",
};

export default site;
