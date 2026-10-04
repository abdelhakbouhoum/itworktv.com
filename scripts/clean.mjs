#!/usr/bin/env node
/**
 * scripts/clean.mjs — stage 0 of the build pipeline (PLAN §1.2).
 *
 * Removes the deploy output `_site/` so every build starts from a clean
 * artefact (Eleventy re-cleans its own output, but stale Pagefind shards and
 * `_headers` from a previous build would otherwise survive a partial rebuild).
 *
 * Cross-platform: node:fs only, no shell commands (CLAUDE.md hard rule).
 */
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.join(fileURLToPath(new URL("../", import.meta.url)));
const siteDir = path.join(repoRoot, "_site");

rmSync(siteDir, { recursive: true, force: true });

console.log(`[clean] removed ${path.relative(repoRoot, siteDir)}/ (if it existed)`);
