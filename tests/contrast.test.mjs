/**
 * tests/contrast.test.mjs — WCAG contrast maths (P1.12, PLAN §10.3).
 *
 * Known-ratio vectors pin the luminance formula: black/white must be
 * exactly 21:1, and the classic "#767676 on white" boundary grey must land
 * just above 4.5:1 while one step darker fails.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  checkTokens,
  WCAG_AA_NORMAL,
} from "../scripts/check-contrast.mjs";

test("WCAG_AA_NORMAL is 4.5", () => {
  assert.equal(WCAG_AA_NORMAL, 4.5);
});

test("hexToRgb parses #RRGGBB and #RGB, rejects garbage", () => {
  assert.deepEqual(hexToRgb("#123456"), [0x12, 0x34, 0x56]);
  assert.deepEqual(hexToRgb("#fff"), [255, 255, 255]);
  assert.deepEqual(hexToRgb("ABCDEF"), [0xab, 0xcd, 0xef]);
  assert.throws(() => hexToRgb("#12345"), /malformed hex/);
  assert.throws(() => hexToRgb("nope"), /malformed hex/);
  assert.throws(() => hexToRgb(undefined), /malformed hex/);
});

test("relativeLuminance is 0 for black and 1 for white", () => {
  assert.ok(Math.abs(relativeLuminance([0, 0, 0]) - 0) < 1e-12);
  assert.ok(Math.abs(relativeLuminance([255, 255, 255]) - 1) < 1e-9);
});

test("black on white is exactly 21:1", () => {
  const r = contrastRatio("#000000", "#FFFFFF");
  assert.ok(Math.abs(r - 21) < 1e-9, `got ${r}`);
});

test("contrast ratio is symmetric", () => {
  assert.equal(contrastRatio("#111111", "#eeeeee"), contrastRatio("#eeeeee", "#111111"));
});

test("#767676 on white is the AA boundary grey (>= 4.5, < 4.6)", () => {
  const r = contrastRatio("#767676", "#FFFFFF");
  assert.ok(r >= 4.5 && r < 4.6, `got ${r}`);
});

test("one step darker, #777777 on white, FAILS 4.5:1", () => {
  const r = contrastRatio("#777777", "#FFFFFF");
  assert.ok(r < 4.5, `got ${r}`);
});

test("checkTokens passes every pair in both themes when ratios hold", () => {
  const tokens = {
    light: { text: "#111111", bg: "#FFFFFF" },
    dark: { text: "#EEEEEE", bg: "#000000" },
    contrastPairs: [
      ["text", "bg"],
    ],
  };
  const { results, errors } = checkTokens(tokens);
  assert.deepEqual(errors, []);
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.ok));
});

test("checkTokens reports a failing pair with the ratio in the message", () => {
  const tokens = {
    light: { text: "#777777", bg: "#FFFFFF" },
    dark: { text: "#EEEEEE", bg: "#000000" },
    contrastPairs: [
      ["text", "bg"],
    ],
  };
  const { results, errors } = checkTokens(tokens);
  assert.equal(results[0].ok, false);
  assert.equal(results[1].ok, true);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"light" theme: text on bg = 4\.4[0-9]:1/);
});

test("checkTokens flags a pair referencing a missing token", () => {
  const { errors } = checkTokens({
    light: { text: "#111" },
    dark: { text: "#111" },
    contrastPairs: [
      ["text", "bg"],
    ],
  });
  assert.match(errors.join(" "), /missing from "light"/);
  assert.match(errors.join(" "), /missing from "dark"/);
});

test("checkTokens rejects an empty contrastPairs array", () => {
  const { errors } = checkTokens({ light: {}, dark: {}, contrastPairs: [] });
  assert.match(errors.join(" "), /non-empty "contrastPairs"/);
});

test("checkTokens rejects a missing theme object", () => {
  const { errors } = checkTokens({ contrastPairs: [["a", "b"]] });
  assert.match(errors.join(" "), /missing the "light" theme object/);
  assert.match(errors.join(" "), /missing the "dark" theme object/);
});

test("checkTokens honours a custom threshold", () => {
  // 4.48:1 — passes AA at 4.5 but must fail a stricter 4.6 gate.
  const tokens = {
    light: { text: "#777777", bg: "#FFFFFF" },
    dark: { text: "#FFFFFF", bg: "#000000" },
    contrastPairs: [
      ["text", "bg"],
    ],
  };
  assert.equal(checkTokens(tokens, { threshold: 4.5 }).results[0].ok, false);
  assert.equal(checkTokens(tokens, { threshold: 4.4 }).results[0].ok, true);
});
