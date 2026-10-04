/**
 * src/_data/nav.js — the ordered primary navigation (PLAN §6.4: a flat
 * 5-item list; deliberately NOT the @11ty/eleventy-plugin-navigation).
 *
 * Consumed by partials/header.njk and partials/footer.njk (design-engineer).
 */

const nav = [
  { url: "/posts/", label: "Posts" },
  { url: "/tags/", label: "Tags" },
  { url: "/about/", label: "About" },
  { url: "/contact/", label: "Contact" },
  { url: "/search/", label: "Search" },
];

export default nav;
