/**
 * src/_data/difficulty.js — the reader-self-selection scale (PLAN §4).
 *
 * `difficulty` is a required front-matter field with exactly these three
 * values. Shown as a chip on every post (partials/post-meta.njk) and used as
 * a facet on tag pages. `icon` is the key into the inline SVG sprite
 * (partials/icons.njk, design-engineer).
 */

const difficulty = {
  beginner: { label: "Beginner", order: 1, icon: "beginner" },
  intermediate: { label: "Intermediate", order: 2, icon: "intermediate" },
  advanced: { label: "Advanced", order: 3, icon: "advanced" },
};

export default difficulty;
