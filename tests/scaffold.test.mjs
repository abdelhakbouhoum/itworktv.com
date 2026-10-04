/**
 * tests/scaffold.test.mjs — `npm run new` scaffolding (P1.16).
 *
 * The core guarantee: scaffoldPost() output, round-tripped through
 * parseFrontMatter(), passes validatePostData() with zero errors — the
 * scaffold is valid by construction under the owner spec (2026-10-04).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scaffoldPost, nextFreeDate, addDays, utcToday, SCAFFOLD_DESCRIPTION } from "../scripts/new-post.mjs";
import { parseFrontMatter } from "../scripts/lib/frontmatter.mjs";
import { validatePostData } from "../scripts/validate-content.mjs";

const registry = {
  windows: { name: "Windows", description: "Windows tips" },
  networking: { name: "Networking", description: "Network tips" },
  powershell: { name: "PowerShell", description: "PowerShell tips" },
};

/** Round-trip: scaffold -> parser -> validator. */
function roundTrip({ title, tags, dateISO }, registryOverride) {
  const { filename, fileSlug, content } = scaffoldPost({ title, tags, dateISO });
  const parsed = parseFrontMatter(content, { filename });
  assert.equal(parsed.error, null, `front matter should parse: ${parsed.error}`);
  const errors = validatePostData(parsed.data, {
    filename,
    registry: registryOverride ?? registry,
    images: undefined,
  });
  assert.deepEqual(errors, [], `scaffold must validate: ${errors.join("; ")}`);
  return { filename, fileSlug, data: parsed.data, body: parsed.body };
}

test("the scaffold description placeholder is inside the 120–160 budget", () => {
  assert.ok(SCAFFOLD_DESCRIPTION.length >= 120 && SCAFFOLD_DESCRIPTION.length <= 160, `got ${SCAFFOLD_DESCRIPTION.length}`);
  assert.ok(SCAFFOLD_DESCRIPTION.endsWith("."));
});

test("addDays rolls over months, years and leap days (UTC)", () => {
  assert.equal(addDays("2026-10-04", 1), "2026-10-05");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2024-02-29", 1), "2024-03-01");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-10-04", -1), "2026-10-03");
});

test("utcToday is a YYYY-MM-DD string", () => {
  assert.match(utcToday(), /^\d{4}-\d{2}-\d{2}$/);
});

test("nextFreeDate: no posts -> today", () => {
  assert.equal(nextFreeDate([], "2026-10-04"), "2026-10-04");
});

test("nextFreeDate: gap never schedules in the past", () => {
  // Last post a month ago -> clamp to today, not 2026-09-05+1.
  assert.equal(nextFreeDate(["2026-09-04"], "2026-10-04"), "2026-10-04");
  assert.equal(nextFreeDate(["2025-01-01", "2026-08-02"], "2026-10-04"), "2026-10-04");
});

test("nextFreeDate: last post yesterday -> today", () => {
  assert.equal(nextFreeDate(["2026-10-03"], "2026-10-04"), "2026-10-04");
});

test("nextFreeDate: last post today -> tomorrow", () => {
  assert.equal(nextFreeDate(["2026-10-04"], "2026-10-04"), "2026-10-05");
  assert.equal(nextFreeDate(["2026-09-30", "2026-10-04"], "2026-10-04"), "2026-10-05");
});

test("nextFreeDate: last post in the future -> day after it (order-indep.)", () => {
  assert.equal(nextFreeDate(["2026-10-12", "2026-10-09"], "2026-10-04"), "2026-10-13");
});

test("scaffoldPost: filename shape and slug", () => {
  const { filename, fileSlug } = roundTrip(
    { title: "Find the process using a port on Windows", tags: ["windows", "networking"], dateISO: "2026-10-04" },
    registry
  );
  assert.equal(filename, "2026-10-04-find-the-process-using-a-port-on-windows.md");
  assert.equal(fileSlug, "2026-10-04-find-the-process-using-a-port-on-windows");
});

test("scaffoldPost: front matter round-trips and validates", () => {
  const { data } = roundTrip({ title: "Restart the Windows Update service safely", tags: ["windows"], dateISO: "2026-11-01" });
  assert.equal(data.title, "Restart the Windows Update service safely");
  assert.equal(data.description, SCAFFOLD_DESCRIPTION);
  assert.equal(data.date, "2026-11-01");
  assert.equal(data.updated, null);
  assert.deepEqual(data.tags, ["windows"]);
  assert.equal(data.difficulty, "intermediate");
  assert.deepEqual(data.tested_on, ["REPLACE_ME: e.g. Windows 11 23H2"]);
  assert.equal(data.image, null);
  assert.equal(data.imageAlt, null);
  assert.equal(data.draft, true);
});

test("scaffoldPost: titles with symbols slugify cleanly and still validate", () => {
  const { filename, data } = roundTrip({ title: "C# and PowerShell 7.4!", tags: ["powershell"], dateISO: "2026-10-04" });
  assert.equal(filename, "2026-10-04-c-and-powershell-7-4.md");
  assert.equal(data.title, "C# and PowerShell 7.4!");
  assert.deepEqual(data.tags, ["powershell"]);
});

test("scaffoldPost: five tags stay inside the owner limit", () => {
  const bigRegistry = { a: {}, b: {}, c: {}, d: {}, e: {} };
  const { data } = roundTrip({ title: "A five-tag post for testing limits", tags: ["a", "b", "c", "d", "e"], dateISO: "2026-10-04" }, bigRegistry);
  assert.deepEqual(data.tags, ["a", "b", "c", "d", "e"]);
});

test("scaffoldPost: body follows the WRITING.md archetype with no H1", () => {
  const { body } = roundTrip({ title: "Check disk usage on Windows", tags: ["windows"], dateISO: "2026-10-04" });
  for (const h of [
    "## TL;DR",
    "## Problem",
    "## Steps",
    "## Verify",
    "## Troubleshooting",
    "## Rollback / Risks",
    "## References",
  ]) {
    assert.ok(body.includes(h), `body must contain ${h}`);
  }
  // No H1 anywhere in the body — the layout renders data.title as the single <h1>.
  assert.ok(!/^# [^#]/m.test(body));
  assert.ok(!/^\s*#[^#]/m.test(body.split("---").pop()));
});

test("scaffoldPost: unregistered tags fail validation (registry gate)", () => {
  const { content, filename } = scaffoldPost({ title: "Use a made-up tag", tags: ["mainframe"], dateISO: "2026-10-04" });
  const parsed = parseFrontMatter(content, { filename });
  const errors = validatePostData(parsed.data, { filename, registry, images: undefined });
  assert.ok(errors.some((e) => /tag "mainframe" is not in the registry/.test(e)));
});
