#!/usr/bin/env node
/**
 * scripts/queue.mjs — `npm run queue` (P1.16).
 *
 * Lists upcoming scheduled posts (date >= today, UTC) and the gaps in the
 * daily publish schedule, plus the next free publish date and the tag
 * distribution of the scheduled set (R15 mitigation: "npm run queue shows
 * the tag distribution of the seed set").
 *
 * Read-only: never writes, never fails on an empty repo.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadPosts, readTagRegistry, isUtcDate } from "./validate-content.mjs";
import { parseFrontMatter } from "./lib/frontmatter.mjs";
import { nextFreeDate } from "./new-post.mjs";

function parseDate(s) {
  return new Date(`${s}T00:00:00Z`);
}

function main() {
  const today = new Date().toISOString().slice(0, 10);
  const posts = loadPosts();

  const entries = [];
  for (const post of posts) {
    const parsed = parseFrontMatter(readFileSync(post.abs, "utf8"), { filename: post.rel });
    const fmDate =
      parsed.data && typeof parsed.data.date === "string" && isUtcDate(parsed.data.date) ? parsed.data.date : null;
    const fileDate = /^(\d{4}-\d{2}-\d{2})-/.exec(post.basename)?.[1] ?? null;
    const date = fmDate ?? fileDate;
    if (!date) {
      console.error(`[queue] WARNING: no usable date in ${post.rel} — excluded`);
      continue;
    }
    entries.push({ date, slug: post.basename.replace(/\.md$/, ""), draft: !!(parsed.data?.draft), rel: post.rel });
  }

  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rel.localeCompare(b.rel)));

  const upcoming = entries.filter((e) => e.date >= today);

  console.log(`Publish schedule (today: ${today}, all times UTC)`);
  console.log("=".repeat(60));

  if (entries.length === 0) {
    console.log(`No posts yet. Next free publish date: ${nextFreeDate([])}`);
    return;
  }

  // --- upcoming
  console.log(`\nUpcoming (${upcoming.length}):`);
  if (upcoming.length === 0) {
    console.log("  (none)");
  }
  for (const e of upcoming) {
    const flag = e.date === today ? " today" : "";
    console.log(`  ${e.date}  ${e.slug}  ${e.draft ? "(draft)" : ""}${flag}`);
  }

  // --- gaps (consecutive unique scheduled dates > 1 day apart)
  const uniqueDates = [...new Set(entries.filter((e) => e.date >= today).map((e) => e.date))].sort();
  const gaps = [];
  let prev = today;
  for (const d of uniqueDates) {
    const days = (parseDate(d) - parseDate(prev)) / 86_400_000;
    if (days > 1) gaps.push(`${prev} -> ${d} (${days} day gap)`);
    prev = d;
  }
  console.log(`\nGaps in the daily schedule:`);
  if (gaps.length === 0) console.log("  none");
  for (const g of gaps) console.log(`  ${g}`);

  console.log(`\nNext free publish date: ${nextFreeDate(entries.map((e) => e.date))}`);

  // --- tag distribution of the scheduled set
  const reg = readTagRegistry();
  const counts = new Map();
  for (const post of posts) {
    const parsed = parseFrontMatter(readFileSync(post.abs, "utf8"), { filename: post.rel });
    // Drafts included on purpose: the seed set is draft-first and the
    // distribution must be visible before anything is published (R15).
    for (const tag of parsed.data?.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  console.log(`\nTag distribution (${counts.size} tags):`);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [tag, count] of sorted) {
    const name = reg.ok && reg.registry[tag]?.name ? ` (${reg.registry[tag].name})` : "";
    const three = count >= 3 ? "  [indexable: >=3 posts]" : "  [noindex until >=3 posts]";
    console.log(`  ${tag.padEnd(24)} ${String(count).padStart(3)}${name}${three}`);
  }
}

main();
