/**
 * tests/slug.test.mjs — the date-stripping permalink helper (PLAN §3, §4)
 * and the title->slug mapper used by `npm run new`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripDatePrefix, slugify, postFileSlug, DATE_PREFIX_RE } from "../scripts/lib/slug.mjs";

test("stripDatePrefix removes the YYYY-MM-DD- prefix", () => {
  assert.equal(stripDatePrefix("2026-10-04-example"), "example");
  assert.equal(stripDatePrefix("2026-10-04-find-the-process-using-a-port"), "find-the-process-using-a-port");
});

test("stripDatePrefix is a no-op without a date prefix", () => {
  assert.equal(stripDatePrefix("example"), "example");
  assert.equal(stripDatePrefix(""), "");
});

test("DATE_PREFIX_RE does not match a mid-string date", () => {
  assert.doesNotMatch("2026-10-04extra", DATE_PREFIX_RE);
  assert.doesNotMatch("xx2026-10-04-x", DATE_PREFIX_RE);
});

test("slugify lowercases and hyphenates", () => {
  assert.equal(slugify("Find the process using a port on Windows"), "find-the-process-using-a-port-on-windows");
  assert.equal(slugify("C# and PowerShell 7.4!"), "c-and-powershell-7-4");
  assert.equal(slugify("  Multiple   spaces  "), "multiple-spaces");
});

test("slugify trims edge hyphens and collapses repeats", () => {
  assert.equal(slugify("  --a--b--  "), "a-b");
  assert.equal(slugify("!!!"), "");
});

test("postFileSlug joins date and slug", () => {
  assert.equal(postFileSlug("2026-10-04", "example"), "2026-10-04-example");
});
