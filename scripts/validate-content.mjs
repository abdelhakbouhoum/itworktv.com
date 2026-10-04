#!/usr/bin/env node
/**
 * scripts/validate-content.mjs — stage 1 of the build pipeline (PLAN §1.2, §4).
 *
 * The content gate: a post that fails does not build; it does not warn
 * (PLAN §4). Enforced mechanically, for EVERY post file under src/posts/
 * (published, scheduled and drafts alike — a draft is still content on a
 * public repo).
 *
 * Limits (OWNER SPEC, 2026-10-04 — supersedes PLAN §4 where the two diverged;
 * recorded per PLAN §10.9 change control):
 *
 *   - title:        string, <= 65 chars, no trailing ".", not ALL CAPS, no `"`
 *   - description:  string, 120–160 chars inclusive, ends with a period
 *   - date:         "YYYY-MM-DD" (UTC, date-only — no time-of-day anywhere in
 *                   the schema); must EQUAL the YYYY-MM-DD in the filename
 *   - updated:      "YYYY-MM-DD" or null; must be >= date
 *   - tags:         1–5 entries, no duplicates, every entry a key in
 *                   src/_data/tags.json (the first tag is the primary topic)
 *   - difficulty:   beginner | intermediate | advanced
 *   - tested_on:    OPTIONAL; when present: 1–5 strings, each <= 40 chars
 *   - image:        null or "r2:<…>", and if set the key must exist in the
 *                   generated src/_data/images.json
 *   - imageAlt:     required iff image is set; 10–125 chars; must not begin
 *                   "image of" / "picture of" / "screenshot of" / "graph of"
 *   - draft:        boolean
 *   - slug (filename minus date prefix) unique across all posts
 *
 * §4.1 unknown-key rule still applies: any front-matter key outside the
 * schema is a hard error.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseFrontMatter } from "./lib/frontmatter.mjs";
import { stripDatePrefix } from "./lib/slug.mjs";

const repoRoot = path.join(fileURLToPath(new URL("../", import.meta.url)));

// ---- limits (owner spec, 2026-10-04) -----------------------------------------

export const LIMITS = {
  title: { min: 1, max: 65 }, // <= 65 per owner spec; min 1 is a sanity floor (an empty title is not a title)
  description: { min: 120, max: 160 },
  tags: { min: 1, max: 5 },
  testedOn: { min: 1, max: 5, entryMax: 40 }, // optional field
  imageAlt: { min: 10, max: 125 },
};

/** The only legal front-matter keys (PLAN §4.1: anything else is a hard error). */
export const KNOWN_KEYS = new Set([
  "title",
  "description",
  "date",
  "updated",
  "tags",
  "difficulty",
  "tested_on",
  "image",
  "imageAlt",
  "draft",
]);

const DIFFICULTIES = new Set(["beginner", "intermediate", "advanced"]);
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/; // owner spec: no time-of-day anywhere in the schema
const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const ALT_BAD_PREFIXES = ["image of", "picture of", "screenshot of", "graph of"];

// ---- loading ----------------------------------------------------------------

/**
 * Every post file under src/posts/ (recursively, including seed/).
 * @returns {{ rel: string, abs: string, basename: string }[]}
 */
export function loadPosts(root = repoRoot) {
  const postsDir = path.join(root, "src", "posts");
  if (!existsSync(postsDir)) return [];
  const out = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
      } else if (entry.name.endsWith(".md")) {
        out.push({
          rel: rel ? `${rel}/${entry.name}` : entry.name,
          abs: path.join(dir, entry.name),
          basename: entry.name,
        });
      }
    }
  };
  walk(postsDir, "posts");
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * Read the tag registry (src/_data/tags.json).
 * @returns {{ ok: true, registry: Record<string, {name: string, description: string}> } | { ok: false, error: string }}
 */
export function readTagRegistry(root = repoRoot) {
  const p = path.join(root, "src", "_data", "tags.json");
  if (!existsSync(p)) {
    return { ok: false, error: `src/_data/tags.json not found (owned by content-strategist, PLAN P1.5/P2.1)` };
  }
  try {
    return { ok: true, registry: JSON.parse(readFileSync(p, "utf8")) };
  } catch (err) {
    return { ok: false, error: `src/_data/tags.json is not valid JSON: ${err.message}` };
  }
}

/**
 * Read the generated image manifest (src/_data/images.json, GITIGNORED —
 * written by scripts/img-optimize.mjs in P2.11).
 * @returns {Record<string, unknown> | undefined}  undefined when the file does not exist
 */
export function readImageManifest(root = repoRoot) {
  const p = path.join(root, "src", "_data", "images.json");
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return undefined;
  }
}

// ---- per-post validation ----------------------------------------------------

/** "YYYY-MM-DD" — valid calendar date, no time-of-day (owner spec). */
export function isUtcDate(value) {
  if (typeof value !== "string" || !DATE_ONLY_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const pad = (n) => String(n).padStart(2, "0");
  const round = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return round === value;
}

/**
 * Validate one parsed front-matter object against the owner spec (2026-10-04)
 * and PLAN §4.1 (unknown keys).
 * Pure (no fs) so it is unit-testable.
 *
 * @param {Record<string, unknown>} fm
 * @param {{ filename: string, registry?: Record<string, unknown> | null, images?: Record<string, unknown> | null }} ctx
 *   - `filename`: e.g. "2026-10-04-example.md" (used for the date check)
 *   - `registry`: tag registry object (required to validate tags)
 *   - `images`: image manifest object, or `undefined` when the file is absent
 * @returns {string[]}  error messages, empty when the post is valid
 */
export function validatePostData(fm, ctx) {
  const errors = [];
  const err = (msg) => errors.push(msg);

  // §4.1 unknown-key rule — the cheapest defence against silent SEO bugs.
  for (const key of Object.keys(fm)) {
    if (!KNOWN_KEYS.has(key)) {
      err(`unknown front-matter key "${key}" (allowed: ${[...KNOWN_KEYS].join(", ")})`);
    }
  }

  // title
  const title = fm.title;
  if (title === undefined || title === null) {
    err('missing required field "title"');
  } else if (typeof title !== "string") {
    err('"title" must be a string');
  } else {
    if (title.length > LIMITS.title.max) {
      err(`"title" is ${title.length} chars (must be <= ${LIMITS.title.max})`);
    }
    if (title.trim() === "") err('"title" must not be empty');
    if (title.endsWith(".")) err('"title" must not end with a period');
    if (title.includes('"')) err('"title" must not contain double quotes');
    const letters = title.replace(/[^A-Za-z]/g, "");
    if (letters.length > 0 && !/[a-z]/.test(letters)) err('"title" is ALL CAPS');
  }

  // description
  const description = fm.description;
  if (description === undefined || description === null) {
    err('missing required field "description"');
  } else if (typeof description !== "string") {
    err('"description" must be a string');
  } else {
    if (description.length < LIMITS.description.min || description.length > LIMITS.description.max) {
      err(
        `"description" is ${description.length} chars (must be ${LIMITS.description.min}–${LIMITS.description.max} inclusive)`
      );
    }
    if (!description.endsWith(".")) err('"description" must end with a period');
  }

  // date (+ filename match)
  const date = fm.date;
  if (typeof date !== "string" || !isUtcDate(date)) {
    err('"date" must be a "YYYY-MM-DD" UTC date (no time-of-day) and a valid calendar date');
  } else {
    const m = FILENAME_RE.exec(ctx.filename);
    if (!m) {
      err(`filename "${ctx.filename}" does not match the "YYYY-MM-DD-<slug>.md" convention (PLAN §3, §4)`);
    } else if (m[1] !== date) {
      err(`"date" (${date}) does not match the date prefix in the filename (${m[1]})`);
    }
  }

  // updated
  if (fm.updated !== undefined && fm.updated !== null) {
    if (typeof fm.updated !== "string" || !isUtcDate(fm.updated)) {
      err('"updated" must be null or a "YYYY-MM-DD" UTC date (no time-of-day)');
    } else if (typeof date === "string" && isUtcDate(date) && fm.updated < date) {
      err('"updated" must be >= "date"');
    }
  }

  // tags
  const tags = fm.tags;
  if (tags === undefined || tags === null) {
    err('missing required field "tags"');
  } else if (!Array.isArray(tags)) {
    err('"tags" must be an array');
  } else {
    if (tags.length < LIMITS.tags.min || tags.length > LIMITS.tags.max) {
      err(`"tags" has ${tags.length} entries (must be ${LIMITS.tags.min}–${LIMITS.tags.max})`);
    }
    const seen = new Set();
    for (const tag of tags) {
      if (typeof tag !== "string") {
        err('"tags" entries must be strings');
        continue;
      }
      if (seen.has(tag)) err(`duplicate tag "${tag}"`);
      seen.add(tag);
      if (ctx.registry && !Object.prototype.hasOwnProperty.call(ctx.registry, tag)) {
        err(`tag "${tag}" is not in the registry src/_data/tags.json`);
      }
    }
  }

  // difficulty
  if (fm.difficulty === undefined || fm.difficulty === null) {
    err('missing required field "difficulty"');
  } else if (typeof fm.difficulty !== "string" || !DIFFICULTIES.has(fm.difficulty)) {
    err('"difficulty" must be one of: beginner, intermediate, advanced');
  }

  // tested_on — optional (owner spec); golden-rule prompt lives in the scaffold.
  const testedOn = fm.tested_on;
  if (testedOn !== undefined && testedOn !== null) {
    if (!Array.isArray(testedOn)) {
      err('"tested_on" must be an array');
    } else {
      if (testedOn.length < LIMITS.testedOn.min || testedOn.length > LIMITS.testedOn.max) {
        err(`"tested_on" has ${testedOn.length} entries (must be ${LIMITS.testedOn.min}–${LIMITS.testedOn.max} when present)`);
      }
      for (const entry of testedOn) {
        if (typeof entry !== "string") {
          err('"tested_on" entries must be strings');
        } else if (entry.length > LIMITS.testedOn.entryMax) {
          err(`"tested_on" entry is ${entry.length} chars (max ${LIMITS.testedOn.entryMax})`);
        }
      }
    }
  }

  // image / imageAlt
  const image = fm.image;
  const imageAlt = fm.imageAlt;
  if (image === undefined) {
    if (imageAlt !== undefined && imageAlt !== null) err('"imageAlt" is set but "image" is not');
  } else if (image !== null) {
    if (typeof image !== "string" || !image.startsWith("r2:")) {
      err('"image" must be null or a string of the form "r2:<YYYY>/<MM>/<slug>/<file>"');
    } else {
      if (ctx.images === undefined) {
        err(`image "${image}" cannot be verified — src/_data/images.json is missing (run npm run img:optimize)`);
      } else if (!Object.prototype.hasOwnProperty.call(ctx.images, image)) {
        err(`image "${image}" is not in src/_data/images.json`);
      }
      if (typeof imageAlt !== "string") {
        err('"image" is set, so "imageAlt" is required (string)');
      } else {
        if (imageAlt.length < LIMITS.imageAlt.min || imageAlt.length > LIMITS.imageAlt.max) {
          err(`"imageAlt" is ${imageAlt.length} chars (must be ${LIMITS.imageAlt.min}–${LIMITS.imageAlt.max})`);
        }
        const low = imageAlt.toLowerCase();
        for (const bad of ALT_BAD_PREFIXES) {
          if (low.startsWith(bad)) {
            err(`"imageAlt" must not begin "${bad}" — describe the information, not the image's existence`);
          }
        }
      }
    }
  } else if (imageAlt !== undefined && imageAlt !== null) {
    err('"imageAlt" is set but "image" is null');
  }

  // draft
  if (fm.draft !== undefined && typeof fm.draft !== "boolean") {
    err('"draft" must be a boolean');
  }

  return errors;
}

// ---- runner -----------------------------------------------------------------

function main() {
  const posts = loadPosts();

  if (posts.length === 0) {
    console.log("[validate] No posts found under src/posts/ — nothing to validate.");
    const reg = readTagRegistry();
    if (!reg.ok) {
      console.warn(`[validate] Note: ${reg.error}. Passes for now because there are no posts to check.`);
    }
    process.exit(0);
  }

  const reg = readTagRegistry();
  if (!reg.ok) {
    console.error(`[validate] ERROR: ${reg.error} — cannot verify any tag; build must not continue.`);
    process.exit(1);
  }
  const images = readImageManifest();

  let failures = 0;
  const bySlug = new Map();

  for (const post of posts) {
    const parsed = parseFrontMatter(readFileSync(post.abs, "utf8"), { filename: post.rel });
    const errors = [];
    if (parsed.error) {
      errors.push(parsed.error);
    } else {
      errors.push(...validatePostData(parsed.data, { filename: post.basename, registry: reg.registry, images }));
    }

    if (parsed.data) {
      const slug = stripDatePrefix(post.basename.replace(/\.md$/, ""));
      bySlug.set(slug, [...(bySlug.get(slug) ?? []), post.rel]);
    }

    if (errors.length > 0) {
      failures += 1;
      console.error(`FAIL  ${post.rel}`);
      for (const e of errors) console.error(`      ${e}`);
    } else {
      console.log(`PASS  ${post.rel}`);
    }
  }

  for (const [slug, files] of bySlug) {
    if (files.length > 1) {
      failures += 1;
      console.error(`FAIL  slug "${slug}" used by multiple posts: ${files.join(", ")}`);
    }
  }

  if (failures > 0) {
    console.error(`[validate] ${failures} post(s) failed the front-matter schema — fix before building.`);
    process.exit(1);
  }
  console.log(`[validate] ${posts.length} post(s) OK.`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()
) {
  main();
}
