/**
 * tests/validate.test.mjs — front-matter schema (P1.11/P1.13).
 *
 * Limits encode the OWNER SPEC of 2026-10-04, which supersedes PLAN §4 where
 * the two diverged: title <= 65, description 120–160 inclusive, tags 1–5,
 * date/updated "YYYY-MM-DD" date-only (no time-of-day), tested_on optional.
 * The required violation probes from the spec correction are here too:
 * 70-char title FAILS, 170-char description FAILS, 6 tags FAIL, missing
 * tested_on PASSES.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePostData, isUtcDate, LIMITS, KNOWN_KEYS } from "../scripts/validate-content.mjs";

const registry = {
  windows: { name: "Windows", description: "Windows tips" },
  networking: { name: "Networking", description: "Network tips" },
  powershell: { name: "PowerShell", description: "PowerShell tips" },
};

const ctx = (filename = "2026-10-04-example.md") => ({ filename, registry, images: undefined });

const fillDesc = (len) => "F".repeat(len - "ends with a period.".length) + "ends with a period.";

/** A post that satisfies every rule of the owner spec. */
const base = () => ({
  title: "Find the process using a port on Windows",
  description: fillDesc(140),
  date: "2026-10-04",
  updated: null,
  tags: ["windows", "networking"],
  difficulty: "intermediate",
  image: null,
  imageAlt: null,
  draft: true,
});

const errorsFor = (fm, ctxOverrides) => validatePostData(fm, { ...ctx(), ...ctxOverrides });

test("a spec-compliant post validates with zero errors", () => {
  assert.deepEqual(errorsFor(base()), []);
});

test("missing tested_on PASSES (owner spec: optional)", () => {
  const fm = base();
  delete fm.tested_on;
  assert.deepEqual(errorsFor(fm), []);
});

test("tested_on when present must be 1–5 strings of <= 40 chars", () => {
  assert.deepEqual(errorsFor({ ...base(), tested_on: ["Windows 11 23H2"] }), []);
  const five = ["a", "b", "c", "d", "e"];
  assert.deepEqual(errorsFor({ ...base(), tested_on: five }), []);
  assert.ok(
    errorsFor({ ...base(), tested_on: ["a", "b", "c", "d", "e", "f"] }).some((e) =>
      /"tested_on" has 6 entries/.test(e)
    )
  );
  assert.ok(
    errorsFor({ ...base(), tested_on: ["x".repeat(41)] }).some((e) =>
      /"tested_on" entry is 41 chars \(max 40\)/.test(e)
    )
  );
  assert.ok(
    errorsFor({ ...base(), tested_on: [] }).some((e) => /"tested_on" has 0 entries/.test(e))
  );
  assert.ok(
    errorsFor({ ...base(), tested_on: "Windows 11" }).some((e) => /"tested_on" must be an array/.test(e))
  );
});

test("title: 65 passes, 66 and 70 fail", () => {
  assert.deepEqual(errorsFor({ ...base(), title: "t".repeat(65) }), []);
  assert.ok(
    errorsFor({ ...base(), title: "t".repeat(66) }).some((e) =>
      /"title" is 66 chars \(must be <= 65\)/.test(e)
    )
  );
  // required probe: a 70-char title must FAIL
  assert.ok(
    errorsFor({ ...base(), title: "t".repeat(70) }).some((e) =>
      /"title" is 70 chars \(must be <= 65\)/.test(e)
    )
  );
});

test("title: trailing period, double quote and ALL CAPS are rejected", () => {
  assert.ok(errorsFor({ ...base(), title: "My great tip." }).some((e) => /must not end with a period/.test(e)));
  assert.ok(errorsFor({ ...base(), title: 'Uses "netstat" a lot' }).some((e) => /must not contain double quotes/.test(e)));
  assert.ok(errorsFor({ ...base(), title: "KILL THAT PROCESS NOW" }).some((e) => /ALL CAPS/.test(e)));
});

test("description: 120 and 160 pass; 119, 161 and 170 fail", () => {
  assert.deepEqual(errorsFor({ ...base(), description: fillDesc(120) }), []);
  assert.deepEqual(errorsFor({ ...base(), description: fillDesc(160) }), []);
  assert.ok(
    errorsFor({ ...base(), description: fillDesc(119) }).some((e) =>
      /"description" is 119 chars \(must be 120–160 inclusive\)/.test(e)
    )
  );
  assert.ok(
    errorsFor({ ...base(), description: fillDesc(161) }).some((e) =>
      /"description" is 161 chars \(must be 120–160 inclusive\)/.test(e)
    )
  );
  // required probe: a 170-char description must FAIL
  assert.ok(
    errorsFor({ ...base(), description: fillDesc(170) }).some((e) =>
      /"description" is 170 chars \(must be 120–160 inclusive\)/.test(e)
    )
  );
  assert.ok(
    errorsFor({ ...base(), description: fillDesc(140).slice(0, -1) }).some((e) =>
      /"description" must end with a period/.test(e)
    )
  );
});

test("date must be YYYY-MM-DD date-only and match the filename", () => {
  // required probe: full ISO timestamps are not in the schema
  assert.ok(
    errorsFor({ ...base(), date: "2026-10-04T06:00:00Z" }).some((e) =>
      /"date" must be a "YYYY-MM-DD" UTC date \(no time-of-day\)/.test(e)
    )
  );
  assert.ok(
    errorsFor(base(), ctx("2026-10-05-example.md")).some((e) =>
      /"date" \(2026-10-04\) does not match the date prefix in the filename \(2026-10-05\)/.test(e)
    )
  );
  assert.ok(errorsFor({ ...base(), date: "2026-02-30" }).some((e) => /no time-of-day/.test(e)));
  assert.ok(errorsFor({ ...base(), date: "26-10-04" }).some((e) => /no time-of-day/.test(e)));
});

test("isUtcDate accepts real dates, rejects impossible ones", () => {
  assert.equal(isUtcDate("2026-10-04"), true);
  assert.equal(isUtcDate("2024-02-29"), true); // leap year
  assert.equal(isUtcDate("2026-02-30"), false);
  assert.equal(isUtcDate("2023-02-29"), false);
  assert.equal(isUtcDate("2026-13-01"), false);
  assert.equal(isUtcDate("2026-10-04T00:00:00Z"), false);
  assert.equal(isUtcDate("2026-1-4"), false);
  assert.equal(isUtcDate(null), false);
});

test("updated may be null, equal to date, or later — never earlier or timestamped", () => {
  assert.deepEqual(errorsFor({ ...base(), updated: null }), []);
  assert.deepEqual(errorsFor({ ...base(), updated: "2026-10-04" }), []);
  assert.deepEqual(errorsFor({ ...base(), updated: "2026-10-05" }), []);
  assert.ok(errorsFor({ ...base(), updated: "2026-10-03" }).some((e) => /"updated" must be >= "date"/.test(e)));
  assert.ok(
    errorsFor({ ...base(), updated: "2026-10-05T08:30:00Z" }).some((e) =>
      /"updated" must be null or a "YYYY-MM-DD" UTC date/.test(e)
    )
  );
});

test("tags: 1 and 5 pass; 0 and 6 fail; dupes and unknown tags fail", () => {
  assert.deepEqual(errorsFor({ ...base(), tags: ["windows"] }), []);
  assert.deepEqual(errorsFor({ ...base(), tags: ["windows", "networking", "powershell"] }), []);
  // 5 tags — only three exist in this fixture registry, so pass through registry-free ctx
  assert.deepEqual(
    validatePostData({ ...base(), tags: ["a", "b", "c", "d", "e"] }, { ...ctx(), registry: null }),
    []
  );
  assert.ok(errorsFor({ ...base(), tags: [] }).some((e) => /"tags" has 0 entries \(must be 1–5\)/.test(e)));
  // required probe: six tags must FAIL
  assert.ok(
    errorsFor({ ...base(), tags: ["a", "b", "c", "d", "e", "f"] }, { ...ctx(), registry: null }).some((e) =>
      /"tags" has 6 entries \(must be 1–5\)/.test(e)
    )
  );
  assert.ok(errorsFor({ ...base(), tags: ["windows", "windows"] }).some((e) => /duplicate tag "windows"/.test(e)));
  assert.ok(
    errorsFor({ ...base(), tags: ["windows", "mainframe"] }).some((e) =>
      /tag "mainframe" is not in the registry/.test(e)
    )
  );
  assert.ok(errorsFor({ ...base(), tags: "windows" }).some((e) => /"tags" must be an array/.test(e)));
});

test("unknown front-matter key is a hard error (§4.1)", () => {
  assert.ok(
    errorsFor({ ...base(), featured: true }).some((e) =>
      /unknown front-matter key "featured"/.test(e)
    )
  );
  // and the schema itself is exactly the ten keys
  assert.equal(KNOWN_KEYS.size, 10);
  assert.equal(KNOWN_KEYS.has("tested_on"), true);
  assert.equal(KNOWN_KEYS.has("test_env"), false);
});

test("difficulty must be one of the three levels", () => {
  assert.deepEqual(errorsFor({ ...base(), difficulty: "beginner" }), []);
  assert.deepEqual(errorsFor({ ...base(), difficulty: "advanced" }), []);
  assert.ok(errorsFor({ ...base(), difficulty: "expert" }).some((e) => /must be one of: beginner, intermediate, advanced/.test(e)));
});

test("draft must be a boolean", () => {
  assert.deepEqual(errorsFor({ ...base(), draft: false }), []);
  assert.ok(errorsFor({ ...base(), draft: "yes" }).some((e) => /"draft" must be a boolean/.test(e)));
});

test("image: null is fine; r2: keys must exist in the manifest", () => {
  const withImage = {
    ...base(),
    image: "r2:2026/10/example/shot.webp",
    imageAlt: "TCP port 443 owned by the httpd service, with the PID column highlighted.",
  };
  assert.ok(errorsFor(withImage).some((e) => /images\.json is missing/.test(e)));
  const manifest = { "r2:2026/10/example/shot.webp": { width: 1200, height: 640 } };
  assert.deepEqual(validatePostData(withImage, { ...ctx(), images: manifest }), []);
  assert.ok(
    validatePostData(withImage, { ...ctx(), images: {} }).some((e) =>
      /is not in src\/_data\/images\.json/.test(e)
    )
  );
  assert.ok(
    errorsFor({ ...base(), image: "/assets/img/shot.webp", imageAlt: "A perfectly fine alt text here." }).some((e) =>
      /must be null or a string of the form "r2:/.test(e)
    )
  );
});

test("imageAlt: required with an image, 10–125 chars, no 'screenshot of' prefix", () => {
  const image = "r2:2026/10/example/shot.webp";
  const manifest = { [image]: {} };
  const ctxWith = { ...ctx(), images: manifest };
  assert.ok(
    validatePostData({ ...base(), image }, ctxWith).some((e) => /"imageAlt" is required/.test(e))
  );
  assert.ok(
    validatePostData({ ...base(), image, imageAlt: "too short" }, ctxWith).some((e) =>
      /"imageAlt" is 9 chars \(must be 10–125\)/.test(e)
    )
  );
  assert.ok(
    validatePostData({ ...base(), image, imageAlt: "S".repeat(126) }, ctxWith).some((e) =>
      /"imageAlt" is 126 chars/.test(e)
    )
  );
  assert.ok(
    validatePostData({ ...base(), image, imageAlt: "Screenshot of the netstat output table" }, ctxWith).some((e) =>
      /must not begin "screenshot of"/.test(e)
    )
  );
  assert.ok(
    errorsFor({ ...base(), imageAlt: "Orphan alt text with no image." }).some((e) =>
      /"imageAlt" is set but "image" is null/.test(e)
    )
  );
});

test("LIMITS encodes the owner spec numbers", () => {
  assert.deepEqual(LIMITS.title, { min: 1, max: 65 });
  assert.deepEqual(LIMITS.description, { min: 120, max: 160 });
  assert.deepEqual(LIMITS.tags, { min: 1, max: 5 });
  assert.deepEqual(LIMITS.testedOn, { min: 1, max: 5, entryMax: 40 });
});
