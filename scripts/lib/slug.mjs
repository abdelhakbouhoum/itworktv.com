/**
 * scripts/lib/slug.mjs — slug helpers shared by eleventy.config.js,
 * new-post.mjs, queue.mjs and the unit tests (P1.13).
 *
 * Convention (PLAN §3): a post file is named `YYYY-MM-DD-<slug>.md` and the
 * URL is `/posts/<slug>/` — the date prefix never appears in a URL, ever.
 * The URL is derived from the filename by the `stripDatePrefix` filter.
 */

/** Matches the `YYYY-MM-DD-` prefix of a post file slug. */
export const DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}-/;

/**
 * "2026-10-04-example" -> "example"
 * Input without a date prefix is returned unchanged (idempotent).
 *
 * @param {string} fileSlug  `page.fileSlug` (filename without extension)
 * @returns {string}
 */
export function stripDatePrefix(fileSlug) {
  return String(fileSlug ?? "").replace(DATE_PREFIX_RE, "");
}

/**
 * "Find the process using a port on Windows"
 *   -> "find-the-process-using-a-port-on-windows"
 *
 * Lowercase, ASCII, single hyphens only (PLAN §5.2 slug shape).
 *
 * @param {string} title
 * @returns {string}  may be "" for input with no usable characters
 */
export function slugify(title) {
  return String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * "2026-10-04" + "find-the-process-using-a-port"
 *   -> "2026-10-04-find-the-process-using-a-port"
 *
 * @param {string} dateISO  "YYYY-MM-DD"
 * @param {string} slug
 * @returns {string}  file slug (without extension)
 */
export function postFileSlug(dateISO, slug) {
  return `${dateISO}-${slug}`;
}
