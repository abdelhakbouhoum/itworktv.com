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
 *
 * ---- linkinator 8 API ------------------------------------------------------
 * `check()` resolves to `{ links, passed }` — there is NO `summary` object
 * (the v6/v7 shape this script was originally written against is gone; that
 * mistake crashed the gate with a TypeError on `result.summary`). Verified
 * against node_modules/linkinator@8.1.0/build/src/index.d.ts:
 *
 *   LinkResult = { url, state, status?, parent?, displayText?, failureDetails? }
 *   LinkState  = "OK" | "BROKEN" | "SKIPPED"
 *
 * Only `state === "BROKEN"` is a defect. `SKIPPED` is linkinator's own
 * word for "not checked" (external hosts, mailto:, anything non-http) and
 * is not an error.
 *
 * ---- skip rules must not match the synthetic root --------------------------
 * linkinator serves `_site/` from a temporary `http://127.0.0.1:<random>/`
 * server and rewrites every internal link onto that host. `linksToSkip` is
 * applied to the ROOT url as well, so a bare `linksToSkip: [/^https?:\/\//]`
 * matches `http://127.0.0.1:…/` and skips the entire crawl — which silently
 * turns the gate green while checking nothing. We therefore skip by HOST,
 * not by scheme (see LOCAL_HOST below), and assert in the summary that the
 * crawl actually reached the artefact.
 *
 * ---- pending vs broken -----------------------------------------------------
 * A link to a Phase 2 page that has not been built yet is NOT a defect: the
 * nav and footer already link to /posts/, /tags/, /about/, /contact/,
 * /search/ and /privacy/, and those templates land in Phase 2. They are
 * reported as PENDING and do not fail the gate — a gate that fails on known
 * pending work trains people to ignore it (the auditor's point). The moment
 * Phase 2 builds one of them the link turns OK and drops off the list
 * automatically, because PENDING_PAGES is matched on the URL, not on the
 * absence of a file.
 *
 * Anything else that is BROKEN is a real defect and fails the gate.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { check } from "linkinator";

const repoRoot = path.join(fileURLToPath(new URL("../", import.meta.url)));
const siteDir = path.join(repoRoot, "_site");

/**
 * The host linkinator assigns to the synthetic local server
 * (node_modules/linkinator/build/src/server.js: `options.host ?? '127.0.0.1'`,
 * bound to port 0 = random). Only links on this host are ours to check.
 */
const LOCAL_HOST = "127.0.0.1";

/**
 * Phase 2 pages that the shell already links to but that do not exist yet.
 * Owned by content-strategist / seo-specialist — this gate must NOT create
 * them, only tolerate them. Remove an entry when its page ships.
 */
const PENDING_PAGES = [
  "/posts/",
  "/tags/",
  "/about/",
  "/contact/",
  "/search/",
  "/privacy/",
];

/**
 * Map a linkinator result URL to a site-absolute path.
 *
 * linkinator rewrites its results back onto the FILESYSTEM before returning
 * them (build/src/index.js `mapUrl`: the `http://127.0.0.1:<port>` prefix is
 * stripped and `syntheticServerRoot` is prepended), so URLs arrive as
 * absolute disk paths — `D:\…\_site\posts\` on Windows, `/…/_site/posts/` on
 * POSIX. The http(s) form is handled too so the helper stays correct if a
 * future linkinator returns URLs unmapped.
 */
function toSitePath(url) {
  const raw = String(url);
  // linkinator reports directory routes WITH a trailing separator
  // (`…/_site/posts/`), which `path.relative` normalises away. Remember it
  // first — without it every directory link would read as `/posts` and miss
  // the PENDING_PAGES entries, which are all trailing-slash routes.
  const trailingSlash = /[\\/]$/.test(raw);
  const withoutScheme = raw.replace(/^[a-z]+:\/\/[^/]+/i, "");
  const rel = path.relative(siteDir, withoutScheme).replace(/\\/g, "/");
  // A disk path that escaped the artefact (should not happen) is reported
  // as-is rather than rewritten into a bogus site path.
  const siteRel = rel.startsWith("..") ? raw.replace(/\\/g, "/") : `/${rel}`;
  const withSlash = trailingSlash && !siteRel.endsWith("/") ? `${siteRel}/` : siteRel;
  const out = withSlash.replace(/\/index\.html$/i, "/");
  return out === "" ? "/" : out;
}

function isPending(url) {
  const p = toSitePath(url);
  return PENDING_PAGES.includes(p);
}

async function main() {
  if (!existsSync(siteDir)) {
    console.log("[links] No _site/ directory found — run `npm run build` first. Skipping link check.");
    return 0;
  }

  const result = await check({
    path: siteDir,
    recurse: true,
    checkFragments: true,
    // Host-scoped, NOT scheme-scoped — see the header note. A function also
    // keeps this correct if linkinator ever returns a relative href.
    linksToSkip: (link) => {
      try {
        return new URL(link).hostname !== LOCAL_HOST;
      } catch {
        return true;
      }
    },
  });

  const links = result.links ?? [];
  const broken = links.filter((l) => l.state === "BROKEN");
  const pending = broken.filter((l) => isPending(l.url));
  const genuine = broken.filter((l) => !isPending(l.url));
  const ok = links.filter((l) => l.state === "OK").length;
  const skipped = links.filter((l) => l.state === "SKIPPED").length;

  console.log(
    `[links] ${ok} OK, ${broken.length} broken (${pending.length} pending Phase 2, ${genuine.length} genuine), ${skipped} skipped`
  );

  if (pending.length > 0) {
    console.log("[links] PENDING (Phase 2 content, not built yet — not a failure):");
    for (const link of [...new Set(pending.map((l) => toSitePath(l.url)))].sort()) {
      console.log(`[links]   ${link}`);
    }
  }

  if (genuine.length > 0) {
    console.error("[links] BROKEN (must be fixed):");
    for (const link of genuine) {
      const parent = link.parent ? toSitePath(link.parent) : "(crawl root)";
      console.error(
        `[links]   ${toSitePath(link.url)}  — ${link.status ?? "unreachable"} — linked from ${parent}`
      );
    }
    console.error(`[links] ${genuine.length} genuinely broken link(s).`);
    return 1;
  }

  // Guard against the silent-green failure mode in the header note: if the
  // crawl skipped the artefact root, "no broken links" means "nothing ran".
  const crawledArtefact = links.some((l) => l.state === "OK" && toSitePath(l.url) === "/");
  if (!crawledArtefact) {
    console.error(
      "[links] The crawl never reached _site/index.html — the gate would pass without checking anything."
    );
    return 1;
  }

  console.log("[links] no broken internal links or fragments.");
  return 0;
}

/**
 * Exit code is set via `process.exitCode`, never `process.exit()`.
 * linkinator keeps undici's shared agents alive after `check()` resolves; a
 * hard `process.exit()` tears those handles down mid-close and aborts the
 * process with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` on
 * Windows (exit 127), masking the real gate result. This is the same
 * `gracefulExit` strategy linkinator's own CLI uses (build/src/cli.js).
 */
async function run() {
  try {
    process.exitCode = await main();
  } catch (err) {
    console.error(`[links] linkinator failed: ${err.stack ?? err}`);
    process.exitCode = 1;
  }
}

run();
