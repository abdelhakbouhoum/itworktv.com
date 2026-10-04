/**
 * tests/hash.test.mjs — the CSS fingerprint scheme (PLAN §1.3, risk R2).
 *
 * Unit-tested per R2 mitigation 2: same CSS -> same hash; one changed byte
 * -> different hash; emitted filename equals manifest.css shape.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cssFingerprint,
  buildCssSource,
  flattenTokenBlock,
  splitLeadingHead,
  CSS_TARGETS,
} from "../scripts/build-css.mjs";

test("cssFingerprint is deterministic", () => {
  assert.deepEqual(cssFingerprint(":root{--x:0}"), cssFingerprint(":root{--x:0}"));
});

test("hash is exactly 8 lowercase hex characters", () => {
  assert.match(cssFingerprint(":root{--x:0}").hash, /^[0-9a-f]{8}$/);
});

test("hash changes when the content changes (one byte)", () => {
  assert.notEqual(cssFingerprint(":root{--x:0}").hash, cssFingerprint(":root{--x:1}").hash);
});

test("filename is main.<hash8>.css and manifest.css is /assets/main.<hash8>.css", () => {
  const { name, hash } = cssFingerprint("body{margin:0}");
  assert.equal(name, `main.${hash}.css`);
  assert.equal(`/assets/${name}`, `/assets/main.${hash}.css`);
});

test("CSS_TARGETS is the frozen boring-wide-evergreen baseline", () => {
  assert.deepEqual(CSS_TARGETS, { chrome: 111 << 16, firefox: 111 << 16, safari: 16 << 16 });
});

test("buildCssSource: :root from light, dark attr selector, dark media block, then main.css", () => {
  const out = buildCssSource(".x{color:var(--text)}\n", {
    light: { bg: "#fff", surface: "#f4f4f4" },
    dark: { bg: "#000", surface: "#111" },
  });
  assert.ok(out.startsWith(":root{--bg:#fff;--surface:#f4f4f4;}\n"));
  assert.ok(out.includes("html[data-theme=\"dark\"]{--bg:#000;--surface:#111;}"));
  assert.ok(out.includes("@media (prefers-color-scheme: dark){:root:not([data-theme]){--bg:#000;--surface:#111;}}"));
  assert.ok(out.endsWith(".x{color:var(--text)}\n"));
});

test("flattenTokenBlock emits --name:value pairs in key order", () => {
  assert.equal(flattenTokenBlock({ bg: "#fff", "text-muted": "#555" }), "--bg:#fff;--text-muted:#555;");
});

test("splitLeadingHead extracts leading comments and @imports, keeps rules", () => {
  const css =
    "/* banner */\n@import \"./vendor/prism.css\";\n/* more */\n@import \"./b.css\";\n:root{--x:0}\n@media screen{.y{color:red}}";
  const { head, rest } = splitLeadingHead(css);
  assert.equal(head, "/* banner */\n@import \"./vendor/prism.css\";\n/* more */\n@import \"./b.css\";\n");
  assert.equal(rest, ":root{--x:0}\n@media screen{.y{color:red}}");
  // head + rest must reassemble the source exactly
  assert.equal(head + rest, css);
});

test("splitLeadingHead is a no-op when the stylesheet starts with a rule", () => {
  const { head, rest } = splitLeadingHead(".a{color:red}");
  assert.equal(head, "");
  assert.equal(rest, ".a{color:red}");
});

test("buildCssSource keeps @imports ahead of the injected token blocks", () => {
  const css = "/* banner */\n@import \"./vendor/prism.css\";\n.x{color:var(--bg)}";
  const out = buildCssSource(css, { light: { bg: "#fff" }, dark: { bg: "#000" } });
  const importIdx = out.indexOf("@import");
  const rootIdx = out.indexOf(":root{");
  assert.ok(importIdx !== -1 && rootIdx !== -1, "both import and :root present");
  assert.ok(importIdx < rootIdx, "@import must precede the injected :root rule");
  assert.ok(out.includes(".x{color:var(--bg)}"), "main.css body preserved");
});

test("buildCssSource rejects malformed token shapes", () => {
  assert.throws(() => buildCssSource("{}", { light: { bg: "#fff" } }), /tokens\.dark/);
  assert.throws(() => buildCssSource("{}", {}), /tokens\.light/);
});
