#!/usr/bin/env node
/**
 * scripts/check-contrast.mjs — WCAG 2.2 AA contrast gate (PLAN §10.3).
 *
 * Reads the RAW HEX values from `src/assets/css/tokens.json` — the same file
 * the CSS is generated from — so the number being checked and the number
 * being shipped are the same number by construction. "Checked, not eyeballed."
 *
 * Every pair in `tokens.json.contrastPairs` must meet >= 4.5:1 in BOTH the
 * light and the dark theme. Pairs are token-name pairs (e.g. ["text","bg"]);
 * this script iterates them generically — no token name is hard-coded beyond
 * the pair list, so design-engineer may extend the token set freely.
 *
 * Part of `npm run check` (the fast pre-commit gate, PLAN §1.2).
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.join(fileURLToPath(new URL("../", import.meta.url)));
const TOKENS_PATH = path.join(repoRoot, "src", "assets", "css", "tokens.json");
export const WCAG_AA_NORMAL = 4.5;

/**
 * Parse "#RRGGBB" or "#RGB" into [r, g, b] 0–255.
 * @throws {Error} on malformed input
 */
export function hexToRgb(hex) {
  let h = String(hex ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(h)) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`malformed hex colour ${JSON.stringify(hex)}`);
  }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** WCAG 2.x relative luminance of an [r,g,b] triple. */
export function relativeLuminance([r, g, b]) {
  const chan = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

/**
 * WCAG contrast ratio between two hex colours, in [1, 21].
 * @param {string} hexA
 * @param {string} hexB
 * @returns {number}
 */
export function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexToRgb(hexA));
  const lb = relativeLuminance(hexToRgb(hexB));
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check every contrastPair in both themes.
 * @param {{ light: Record<string,string>, dark: Record<string,string>, contrastPairs: [string,string][] }} tokens
 * @param {{ threshold?: number }} [opts]
 * @returns {{ results: {theme: string, pair: [string,string], ratio: number, ok: boolean}[], errors: string[] }}
 */
export function checkTokens(tokens, { threshold = WCAG_AA_NORMAL } = {}) {
  const results = [];
  const errors = [];

  if (!tokens || !Array.isArray(tokens.contrastPairs) || tokens.contrastPairs.length === 0) {
    errors.push("tokens.json must contain a non-empty \"contrastPairs\" array of [tokenA, tokenB] pairs");
    return { results, errors };
  }

  for (const theme of ["light", "dark"]) {
    const map = tokens[theme];
    if (!map || typeof map !== "object") {
      errors.push(`tokens.json is missing the "${theme}" theme object`);
      continue;
    }
    for (const pair of tokens.contrastPairs) {
      if (!Array.isArray(pair) || pair.length !== 2) {
        errors.push(`contrastPairs entry ${JSON.stringify(pair)} must be [tokenA, tokenB]`);
        continue;
      }
      const [a, b] = pair;
      if (!Object.prototype.hasOwnProperty.call(map, a) || !Object.prototype.hasOwnProperty.call(map, b)) {
        errors.push(`contrast pair [${a}, ${b}] references a token missing from "${theme}"`);
        continue;
      }
      let ratio;
      try {
        ratio = contrastRatio(map[a], map[b]);
      } catch (err) {
        errors.push(`contrast pair [${a}, ${b}] in "${theme}": ${err.message}`);
        continue;
      }
      const ok = ratio >= threshold;
      results.push({ theme, pair: [a, b], ratio, ok });
      if (!ok) errors.push(`"${theme}" theme: ${a} on ${b} = ${ratio.toFixed(2)}:1 (need >= ${threshold}:1)`);
    }
  }

  return { results, errors };
}

function main() {
  if (!existsSync(TOKENS_PATH)) {
    console.error(
      `[contrast] missing ${path.relative(repoRoot, TOKENS_PATH)} — owned by design-engineer (PLAN P1.7). Cannot check contrast yet.`
    );
    process.exit(1);
  }
  let tokens;
  try {
    tokens = JSON.parse(readFileSync(TOKENS_PATH, "utf8"));
  } catch (err) {
    console.error(`[contrast] ${path.relative(repoRoot, TOKENS_PATH)} is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  const { results, errors } = checkTokens(tokens);

  for (const r of results) {
    const mark = r.ok ? "PASS" : "FAIL";
    console.log(`${mark}  ${r.theme.padEnd(5)}  ${r.pair[0]} / ${r.pair[1]}  =  ${r.ratio.toFixed(2)}:1`);
  }

  if (errors.length > 0) {
    for (const e of errors) console.error(`[contrast] ${e}`);
    process.exit(1);
  }
  console.log(`[contrast] all ${results.length} pair checks >= ${WCAG_AA_NORMAL}:1 in both themes.`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()
) {
  main();
}
