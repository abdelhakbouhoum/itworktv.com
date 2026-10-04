#!/usr/bin/env node
/**
 * scripts/check-links.mjs — link gate (P1.12, thin wrapper).
 *
 * Runs linkinator (npm-native, cross-platform — PLAN §6.4) over the local
 * build artefact `_site/`, INTERNAL links + fragments only. External links
 * are deliberately skipped here: per the §6.4 hybrid, they run WEEKLY in
 * .github/workflows/weekly-audit.yml (devops-engineer), because flaky
 * third parties must not block a daily deploy (R16).
 *
 * Skips (exit 0 with a note) when `_site/` does not exist yet — e.g.
 * mid-Phase-1, before the first full build.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { check } from "linkinator";

const repoRoot = path.join(fileURLToPath(new URL("../", import.meta.url)));
const siteDir = path.join(repoRoot, "_site");

// Local check only: external URLs, mailto:/tel: are not reachable on disk.
const IGNORE = [
  /^https?:\/\//i,
  /^mailto:/i,
  /^tel:/i,
  /^ftp:/i,
  /^data:/i,
];

async function main() {
  if (!existsSync(siteDir)) {
    console.log("[links] No _site/ directory found — run `npm run build` first. Skipping link check.");
    return;
  }

  const result = await check({
    path: siteDir,
    recurse: true,
    ignore: IGNORE,
    reject: [404, 500], // default status-based rejection
  });

  const { totalLinks, totalAnchors, totalErrors } = result.summary;
  console.log(`[links] ${totalAnchors} anchors, ${totalLinks} links checked, ${totalErrors} broken`);

  if (totalErrors > 0) {
    for (const link of result.brokenLinks ?? []) {
      console.error(`[links] BROKEN  ${link.url}  (${link.err?.reason ?? "unreachable"})`);
    }
    process.exit(1);
  }
  console.log("[links] no broken internal links or fragments.");
}

main().catch((err) => {
  console.error(`[links] linkinator failed: ${err.stack ?? err}`);
  process.exit(1);
});
