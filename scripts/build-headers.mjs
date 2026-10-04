#!/usr/bin/env node
/**
 * scripts/build-headers.mjs — stage 5 of the build pipeline (PLAN §1.2).
 *
 * The CSP allows the inline theme-init script (exception (a) of hard rule 1)
 * via a SHA-256 source hash. The hash must be computed over the EXACT BYTES
 * that land inside `<script>` on every page — and those bytes are exactly
 * the bytes of `src/_includes/partials/theme-init.njk` (the partial is
 * inlined verbatim, see global data `themeInit` in eleventy.config.js).
 *
 *   1. SHA-256 of the raw bytes of theme-init.njk  ->  sha256-<base64>
 *   2. substitute the literal `__SCRIPT_HASH__` in src/_headers
 *   3. write the result to _site/_headers (Cloudflare Pages reads it)
 *
 * Budget rule B10 fails the build if the shipped hash does not match the
 * real script bytes, so a stale hash is a deploy-blocker, not a silent
 * CSP-violation storm (PLAN §10.7 "Why B10 exists").
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.join(fileURLToPath(new URL("../", import.meta.url)));
const themeInitPath = path.join(repoRoot, "src", "_includes", "partials", "theme-init.njk");
const srcHeadersPath = path.join(repoRoot, "src", "_headers");
const outHeadersPath = path.join(repoRoot, "_site", "_headers");

function main() {
  for (const [p, owner] of [
    [themeInitPath, "design-engineer (P1.8)"],
    [srcHeadersPath, "devops-engineer (P1.14)"],
  ]) {
    if (!existsSync(p)) {
      console.error(`[headers] missing ${path.relative(repoRoot, p)} — owned by ${owner}. Nothing to build.`);
      process.exit(1);
    }
  }

  // Raw bytes: no re-encoding, no trimming — the hash must cover exactly
  // what the templates print.
  const themeInitBytes = readFileSync(themeInitPath);
  const hash = `sha256-${createHash("sha256").update(themeInitBytes).digest("base64")}`;

  const srcHeaders = readFileSync(srcHeadersPath, "utf8");
  let out;
  if (srcHeaders.includes("__SCRIPT_HASH__")) {
    out = srcHeaders.replaceAll("__SCRIPT_HASH__", hash);
  } else {
    console.warn("[headers] WARNING: src/_headers does not contain __SCRIPT_HASH__ — copying verbatim. B10 will still verify the CSP hash.");
    out = srcHeaders;
  }

  mkdirSync(path.dirname(outHeadersPath), { recursive: true });
  writeFileSync(outHeadersPath, out, "utf8");

  console.log(`[headers] _site/_headers written — CSP script hash ${hash}`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()
) {
  main();
}
