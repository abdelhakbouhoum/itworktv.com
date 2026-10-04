#!/usr/bin/env node
/**
 * scripts/new-post.mjs — `npm run new -- "Post title" --tags a,b` (P1.16).
 *
 * Scaffolds `src/posts/YYYY/YYYY-MM-DD-<slug>.md` with front matter that
 * already passes scripts/validate-content.mjs, and assigns the NEXT FREE
 * publish date: one day after the most recent post date, clamped to today
 * (UTC) — a gap never schedules a post in the past.
 *
 * Rules enforced up-front (so the scaffold is valid by construction):
 *   - title <= 65 chars, no trailing period, not ALL CAPS, no `"`
 *   - 1–5 tags, every one a key in src/_data/tags.json
 *   - slug (filename minus date prefix) unique across all posts — URLs are
 *     immutable (hard rule 5), so a collision is a hard stop
 *
 * Cross-platform: node:fs + node:path only.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { slugify, postFileSlug, stripDatePrefix } from "./lib/slug.mjs";
import { loadPosts, readTagRegistry, isUtcDate } from "./validate-content.mjs";
import { parseFrontMatter } from "./lib/frontmatter.mjs";

const repoRoot = path.join(fileURLToPath(new URL("../", import.meta.url)));

/** 154-char placeholder: inside the 120–160 description budget, ends with a period. */
export const SCAFFOLD_DESCRIPTION =
  "REPLACE_ME: a 120-160 character meta description that stands alone as a Google snippet, ends with a period, and names the reader's problem, not the brand.";

const SCAFFOLD_TESTED_ON = "REPLACE_ME: e.g. Windows 11 23H2"; // 32 chars, <= 40

export function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(dateISO, n) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The next free publish date (owner spec): one day after the last scheduled
 * post, clamped to today UTC. No posts yet -> today.
 */
export function nextFreeDate(allDates, today = utcToday()) {
  if (allDates.length === 0) return today;
  const last = allDates.sort()[allDates.length - 1];
  return addDays(last, 1) > today ? addDays(last, 1) : today;
}

/**
 * Build the scaffold document (pure — unit-tested in tests/scaffold.test.mjs).
 *
 * @param {{ title: string, tags: string[], dateISO: string }} opts
 * @returns {{ filename: string, fileSlug: string, content: string }}
 */
export function scaffoldPost({ title, tags, dateISO }) {
  const slug = slugify(title);
  const filename = `${postFileSlug(dateISO, slug)}.md`;
  const yamlTitle = JSON.stringify(title); // double-quoted YAML, escapes handled
  const frontMatter = [
    "---",
    `title: ${yamlTitle}`,
    `description: ${JSON.stringify(SCAFFOLD_DESCRIPTION)}`,
    `date: "${dateISO}"`,
    "updated: null",
    `tags: [${tags.join(", ")}]`,
    "difficulty: intermediate",
    `tested_on: [${JSON.stringify(SCAFFOLD_TESTED_ON)}]`,
    "image: null",
    "imageAlt: null",
    "draft: true",
    "---",
    "",
  ].join("\n");

  // docs/WRITING.md archetype: TL;DR -> Problem -> Steps -> Verify ->
  // Troubleshooting -> Rollback/Risks -> References. No H1 in the body: the
  // layout renders data.title as the single <h1> (A2.4: exactly one h1/page).
  const body = [
    "## TL;DR",
    "",
    "REPLACE_ME: the answer in one or two sentences.",
    "",
    "## Problem",
    "",
    "REPLACE_ME: the exact situation the reader is in, in their words.",
    "",
    "## Steps",
    "",
    "REPLACE_ME: numbered steps with tested commands in fenced code blocks.",
    "",
    "## Verify",
    "",
    "REPLACE_ME: how the reader confirms it worked (the golden rule is tested here).",
    "",
    "## Troubleshooting",
    "",
    "REPLACE_ME: what to try when it does not work.",
    "",
    "## Rollback / Risks",
    "",
    "REPLACE_ME: how to undo it, and what could go wrong.",
    "",
    "## References",
    "",
    "REPLACE_ME: authoritative sources.",
    "",
  ].join("\n");

  return { filename, fileSlug: postFileSlug(dateISO, slug), content: `${frontMatter}\n${body}` };
}

function parseArgs(argv) {
  let title = null;
  let tags = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tags") {
      const v = argv[++i];
      if (!v) fail("usage: npm run new -- \"Post title\" --tags tag1,tag2\n      --tags value is missing");
      tags = v
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s !== "");
    } else if (a.startsWith("--")) {
      fail(`unknown flag "${a}"\n      usage: npm run new -- "Post title" --tags tag1,tag2`);
    } else if (title === null) {
      title = a;
    } else {
      fail(`unexpected argument "${a}"\n      usage: npm run new -- "Post title" --tags tag1,tag2`);
    }
  }
  return { title, tags };
}

function fail(msg) {
  console.error(`[new] ${msg}`);
  process.exit(1);
}

function main() {
  const { title, tags } = parseArgs(process.argv.slice(2));

  if (!title || title.trim() === "") fail('missing title\n      usage: npm run new -- "Post title" --tags tag1,tag2');
  if (title.length > 65) fail(`title is ${title.length} chars (must be <= 65)`);
  if (title.endsWith(".")) fail('title must not end with a period');
  if (title.includes('"')) fail("title must not contain double quotes");
  const letters = title.replace(/[^A-Za-z]/g, "");
  if (letters.length > 0 && !/[a-z]/.test(letters)) fail("title is ALL CAPS");
  if (tags.length < 1 || tags.length > 5) fail(`need 1–5 tags (got ${tags.length}) via --tags a,b`);
  if (new Set(tags).size !== tags.length) fail(`duplicate tag in --tags (${[...new Set(tags)].join(", ")})`);

  const slug = slugify(title);
  if (slug === "") fail(`title "${title}" produces no usable slug`);

  const reg = readTagRegistry();
  if (!reg.ok) {
    fail(
      `${reg.error}\n      Add the tags to the registry first, then re-run: npm run new -- "${title}" --tags ${tags.join(",")}`
    );
  }
  for (const tag of tags) {
    if (!Object.prototype.hasOwnProperty.call(reg.registry, tag)) {
      fail(`tag "${tag}" is not in the registry src/_data/tags.json — add it there first`);
    }
  }

  // Existing posts: their dates + their slugs (URLs are immutable).
  const posts = loadPosts();
  const dates = [];
  const existingSlugs = new Set();
  for (const post of posts) {
    const parsed = parseFrontMatter(readFileSync(post.abs, "utf8"), { filename: post.rel });
    const fmDate = parsed.data && typeof parsed.data.date === "string" && isUtcDate(parsed.data.date) ? parsed.data.date : null;
    const fileDate = /^(\d{4}-\d{2}-\d{2})-/.exec(post.basename)?.[1] ?? null;
    if (fmDate) dates.push(fmDate);
    else if (fileDate) dates.push(fileDate);
    existingSlugs.add(stripDatePrefix(post.basename.replace(/\.md$/, "")));
  }
  const dateISO = nextFreeDate(dates);

  if (existingSlugs.has(slug)) {
    fail(
      `slug "${slug}" is already used (URLs never change, hard rule 5).\n      Pick a different title, or edit the existing post in place — never rename a published URL.`
    );
  }

  const scaffold = scaffoldPost({ title, tags, dateISO });
  const relDir = `src/posts/${dateISO.slice(0, 4)}`;
  const relPath = `${relDir}/${scaffold.filename}`;
  const absPath = path.join(repoRoot, relPath);

  if (existsSync(absPath)) fail(`target already exists: ${relPath}`);

  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, scaffold.content, "utf8");

  console.log(`[new] created ${relPath}`);
  console.log(`[new] scheduled ${dateISO} (next free publish date) · tags: ${tags.join(", ")}`);
  console.log(`[next] write the post (archetype: docs/WRITING.md), then run:  npm run check`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()
) {
  main();
}
