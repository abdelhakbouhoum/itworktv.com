#!/usr/bin/env node
/**
 * scripts/build-css.mjs — stage 2 of the build pipeline (PLAN §1.3, EXACT).
 *
 * lightningcss has no fingerprint flag (verified, PLAN §6.3 / R2), so the
 * content hash is computed here on the exact bytes about to be written:
 *
 *   1. read  src/assets/css/main.css          (UTF-8 string)
 *   2. read  src/assets/css/tokens.json
 *   3. css   = main.css leading head (comments + @import statements)
 *             + ':root{' + light tokens + '}\n'
 *             + 'html[data-theme="dark"]{' + dark tokens + '}\n'
 *             + '@media (prefers-color-scheme: dark){:root:not([data-theme]){dark tokens}}\n'
 *             + main.css body
 *              (the head stays first because the CSS spec forbids rules
 *               before an @import; the token blocks inject no new imports)
 *   4. out   = lightningcss.bundleAsync({ filename, minify: true, targets,
 *               resolver }) — entry content is our in-memory combined source
 *               (the `read` resolver returns it), every @import is resolved
 *               against main.css's directory and inlined. (API note: the
 *               synchronous bundle()/transform() cannot take entry content,
 *               verified against the installed 1.33.0 typings; only
 *               bundleAsync ships a `resolver`. The inlining is REQUIRED:
 *               the budget is one fingerprinted CSS file, so main.css may
 *               use @import but the shipped file must not.)
 *   5. code  = out.code (UTF-8 string)
 *   6. hash  = sha256(code).hex.slice(0, 8)
 *   7. name  = main.<hash>.css
 *   8. rm    every *.css in .cache/css/       (kills stale hashes)
 *   9. write .cache/css/<name>
 *  10. write .cache/css-manifest.json =
 *        { "css": "/assets/<name>", "hash", "bytes": code.length,
 *          "gzipBytes": gzipSync(code).length }
 *
 * The manifest is global data for Eleventy (templates print
 * `{{ cssManifest.css }}`) and is measured by budget rule B1. The manifest
 * lives in `.cache/` (gitignored generated output), NEVER in `src/_data/`.
 *
 * Tokens: `tokens.json` is the single source of truth for colour (PLAN §2).
 * This script iterates the token map generically — no token name is
 * hard-coded — so design-engineer can extend the set without touching this
 * script. Contract shape (frozen 2026-10-04):
 *   { "light": {…}, "dark": {…}, "contrastPairs": [["text","bg"], …] }
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { bundleAsync } from "lightningcss";

const repoRoot = path.join(fileURLToPath(new URL("../", import.meta.url)));

/**
 * Browser targets (PLAN §1.3 — ASSUMPTION, "boring, wide, evergreen").
 * Values are `(major << 16)` as the lightningcss/browserslist ABI expects.
 * One constant: lowering it costs CSS bytes, raising it risks shipping
 * syntax the LCP target browser cannot parse. Do not change casually —
 * re-measure the 15 KB gzip budget if you do.
 */
export const CSS_TARGETS = { chrome: 111 << 16, firefox: 111 << 16, safari: 16 << 16 };

/**
 * `--name:value;` pairs for every token in the theme map, in key order.
 * @param {Record<string, string>} themeTokens
 * @returns {string}
 */
export function flattenTokenBlock(themeTokens) {
  return Object.entries(themeTokens)
    .map(([name, value]) => `--${name}:${value};`)
    .join("");
}

/**
 * Split a stylesheet into its leading head — comments and @import
 * statements, which the CSS spec requires to precede every rule — and the
 * rest. Used so the injected token blocks do not land in front of main.css
 * @imports in the combined source.
 * @param {string} css
 * @returns {{ head: string, rest: string }}
 */
export function splitLeadingHead(css) {
  const m = css.match(/^(?:\s*\/\*[\s\S]*?\*\/\s*|\s*@\s*import\s+[^;]+;\s*)+/);
  const head = m ? m[0] : "";
  return { head, rest: head ? css.slice(head.length) : css };
}

/**
 * Assemble the final CSS source: main.css leading head + theme token blocks
 * + main.css body (PLAN §1.3 step 3, extended with the two dark-theme
 * blocks from the P1.11 contract).
 * @param {string} css  contents of main.css
 * @param {{ light: Record<string,string>, dark: Record<string,string> }} tokens
 * @returns {string}
 */
export function buildCssSource(css, tokens) {
  if (!tokens || typeof tokens !== "object") throw new Error("tokens must be an object");
  if (!tokens.light || typeof tokens.light !== "object") throw new Error('tokens.light must be an object');
  if (!tokens.dark || typeof tokens.dark !== "object") throw new Error('tokens.dark must be an object');
  const light = `:root{${flattenTokenBlock(tokens.light)}}\n`;
  const darkAttr = `html[data-theme="dark"]{${flattenTokenBlock(tokens.dark)}}\n`;
  const darkMedia = `@media (prefers-color-scheme: dark){:root:not([data-theme]){${flattenTokenBlock(tokens.dark)}}}\n`;
  const { head, rest } = splitLeadingHead(css);
  return `${head}${light}${darkAttr}${darkMedia}${rest}`;
}

/**
 * 8-hex-char content fingerprint (PLAN §1.3 steps 6–7).
 * 8 hex chars = 32 bits: negligible collision odds at a handful of builds
 * per day, and the only cost would be one extra byte in a filename.
 * @param {string} code  minified CSS text
 * @returns {{ name: string, hash: string }}
 */
export function cssFingerprint(code) {
  const hash = createHash("sha256").update(code, "utf8").digest("hex").slice(0, 8);
  return { name: `main.${hash}.css`, hash };
}

async function main() {
  const mainCssPath = path.join(repoRoot, "src", "assets", "css", "main.css");
  const tokensPath = path.join(repoRoot, "src", "assets", "css", "tokens.json");
  const cacheDir = path.join(repoRoot, ".cache");
  const cacheCssDir = path.join(cacheDir, "css");

  for (const p of [mainCssPath, tokensPath]) {
    if (!existsSync(p)) {
      console.error(`[css] missing ${path.relative(repoRoot, p)} — owned by design-engineer (PLAN P1.7). Nothing to build.`);
      process.exit(1);
    }
  }

  const css = readFileSync(mainCssPath, "utf8");
  let tokens;
  try {
    tokens = JSON.parse(readFileSync(tokensPath, "utf8"));
  } catch (err) {
    console.error(`[css] ${path.relative(repoRoot, tokensPath)} is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  let source;
  try {
    source = buildCssSource(css, tokens);
  } catch (err) {
    console.error(`[css] ${err.message}`);
    process.exit(1);
  }

  let out;
  try {
    // The entry ("main.css") is served from memory via the resolver — the
    // combined token+CSS source — so no temp file is written into the
    // design-engineer's directory. @import specifiers resolve relative to
    // the directory of the file that declares them.
    out = await bundleAsync({
      filename: mainCssPath,
      minify: true,
      targets: CSS_TARGETS,
      resolver: {
        resolve: (specifier, originatingFile) =>
          path.resolve(path.dirname(originatingFile), specifier),
        read: (file) => (file === mainCssPath ? source : readFileSync(file, "utf8")),
      },
    });
  } catch (err) {
    console.error(`[css] lightningcss.bundle failed: ${err.message}`);
    process.exit(1);
  }
  for (const warning of out.warnings) {
    console.warn(`[css] warning: ${warning.message}`);
  }

  const code = out.code.toString("utf8");
  const { name, hash } = cssFingerprint(code);

  mkdirSync(cacheCssDir, { recursive: true });
  // Step 8: kill stale hashes before writing the new one.
  for (const entry of readdirSync(cacheCssDir)) {
    if (entry.endsWith(".css")) unlinkSync(path.join(cacheCssDir, entry));
  }

  writeFileSync(path.join(cacheCssDir, name), code, "utf8");

  const manifest = {
    css: `/assets/${name}`,
    hash,
    bytes: code.length,
    gzipBytes: gzipSync(code).length,
  };
  writeFileSync(
    path.join(cacheDir, "css-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  console.log(
    `[css] wrote .cache/css/${name} — ${manifest.bytes} bytes raw, ${manifest.gzipBytes} bytes gzipped ` +
      `(budget B1: 15,360)`
  );
}

// Run main only when executed directly (unit tests import the exports).
// Case-insensitive compare: Windows drive letters are case-insensitive.
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()
) {
  main().catch((err) => {
    console.error(`[css] ${err.message}`);
    process.exit(1);
  });
}
