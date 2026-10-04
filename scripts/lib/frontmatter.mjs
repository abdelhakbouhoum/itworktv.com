/**
 * scripts/lib/frontmatter.mjs — minimal YAML front-matter parser for the post
 * schema (PLAN §4).
 *
 * The post schema allows only top-level keys whose values are scalars or flat
 * arrays of scalars, so a full YAML engine is not needed — and adding one is
 * not allowed (hard rule 4, PLAN §6 dependency gate). This parser supports
 * exactly the subset the schema uses:
 *
 *   - `key: value` lines  (plain, single- or double-quoted strings, numbers,
 *     booleans, null)
 *   - flow arrays         `tags: [windows, networking]`
 *   - block arrays
 *         tags:
 *           - windows
 *           - networking
 *   - whole-line comments and blank lines
 *
 * Anything more elaborate (nested maps, multi-line strings, anchors) is
 * reported as an error instead of being guessed. Front matter must be
 * delimited by a `---` line at the very top of the file and a closing `---`
 * (or `...`) line.
 */

/**
 * Parse a markdown document's front matter.
 *
 * @param {string} source  full file contents (markdown body after front matter)
 * @param {{ filename?: string }} [opts]  used only in error messages
 * @returns {{ data: Record<string, unknown> | null, error: string | null, body: string }}
 *   `data` is null and `error` is set when the front matter is missing/broken.
 */
export function parseFrontMatter(source, { filename = "<string>" } = {}) {
  const text = String(source ?? "").replace(/^﻿/, "").replace(/\r\n/g, "\n");

  const lines = text.split("\n");
  if (lines.length === 0 || lines[0].trim() !== "---") {
    return {
      data: null,
      error: `${filename}: missing front matter (first line must be ---)`,
      body: text,
    };
  }

  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "---" || t === "...") {
      close = i;
      break;
    }
  }
  if (close === -1) {
    return { data: null, error: `${filename}: front matter is not closed (no second ---)`, body: text };
  }

  const data = Object.create(null);
  let pendingKey = null; // key whose value is a block array (or null if empty)

  for (let i = 1; i < close; i++) {
    const raw = lines[i];
    const line = raw.trim();

    if (line === "" || line.startsWith("#")) continue;

    // Block array item: `  - value`
    const item = line.match(/^-(\s+(.*))?$/);
    if (item) {
      if (pendingKey === null) {
        return {
          data: null,
          error: `${filename}:${i + 1}: list item with no parent key`,
          body: text,
        };
      }
      if (!Array.isArray(data[pendingKey])) data[pendingKey] = [];
      data[pendingKey].push(parseScalar(item[2] ?? "", filename, i + 1).value);
      continue;
    }

    // Top-level `key: value`
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!kv || raw !== line || raw.startsWith(" ")) {
      // Indented non-item lines (nested maps etc.) are outside the schema.
      if (raw.startsWith(" ") || raw.startsWith("\t")) {
        return {
          data: null,
          error: `${filename}:${i + 1}: nested/indented front-matter is not supported by the post schema`,
          body: text,
        };
      }
      return {
        data: null,
        error: `${filename}:${i + 1}: expected "key: value", got ${JSON.stringify(line.slice(0, 40))}`,
        body: text,
      };
    }

    const [, key, rawValue] = kv;
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      // A block array (`key:` then `- x` lines) is ONE key line plus items;
      // items never reach this branch, so any repeated key line is a duplicate.
      return { data: null, error: `${filename}:${i + 1}: duplicate front-matter key "${key}"`, body: text };
    }

    const value = rawValue.trim();
    if (value === "") {
      pendingKey = key;
      data[key] = null; // becomes an array if items follow, stays null otherwise
      continue;
    }

    if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = parseFlowArray(value, filename, i + 1);
      pendingKey = null;
      continue;
    }

    data[key] = parseScalar(value, filename, i + 1).value;
    pendingKey = null;
  }

  // A bare `key:` with no items is null (YAML semantics), not an empty string.
  // Nothing to do: data[key] is already null.

  return { data, error: null, body: lines.slice(close + 1).join("\n") };
}

/**
 * Parse a flow array `[a, b, c]`. Items are scalars only (schema rule).
 * @returns {unknown[]}
 */
function parseFlowArray(value, filename, lineNo) {
  const inner = value.slice(1, -1).trim();
  if (inner === "") return [];
  const items = splitTopLevelCommas(inner).map((s) => parseScalar(s, filename, lineNo).value);
  return items;
}

/** Split on commas that are not inside quotes. */
function splitTopLevelCommas(s) {
  const out = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let cur = "";
  for (const ch of s) {
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (ch === "[" || ch === "{" || (ch === "," && inDouble === false && inSingle === false)) {
      if (ch === "," && depth === 0) {
        out.push(cur);
        cur = "";
        continue;
      }
      depth += 1;
    }
    if (ch === "]" || ch === "}") depth -= 1;
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter((s, idx, arr) => s !== "" || idx !== arr.length - 1);
}

/**
 * Parse a scalar value.
 * @returns {{ value: unknown }}  (errors are thrown as descriptive Error)
 */
function parseScalar(value, filename, lineNo) {
  const v = value.trim();
  if (v === "" || v === "~" || v === "null" || v === "Null" || v === "NULL") return { value: null };
  if (v === "true" || v === "True" || v === "TRUE") return { value: true };
  if (v === "false" || v === "False" || v === "FALSE") return { value: false };

  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    const inner = v.slice(1, -1);
    // Double-quoted: backslash escapes for " \ n t
    let out = "";
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === "\\" && i + 1 < inner.length) {
        const next = inner[i + 1];
        if (next === '"' || next === "\\") {
          out += next;
          i++;
          continue;
        }
        if (next === "n") {
          out += "\n";
          i++;
          continue;
        }
        if (next === "t") {
          out += "\t";
          i++;
          continue;
        }
        throw new Error(`${filename}:${lineNo}: unsupported escape \\${next} in double-quoted string`);
      }
      out += ch;
    }
    return { value: out };
  }

  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) {
    // Single-quoted: '' is the only escape (YAML).
    const inner = v.slice(1, -1);
    if (inner.includes("'") && !/^\s*$/.test(inner.replace(/''/g, " "))) {
      // An unbalanced lone quote is a genuine syntax error for the writer.
      throw new Error(`${filename}:${lineNo}: unterminated single-quoted string`);
    }
    return { value: inner.replace(/''/g, "'") };
  }

  // Plain scalar: keep as string, except whole integers (none exist in the
  // schema, but `null`/booleans were handled above). Quoting a date is what
  // the schema requires; an unquoted date string is still a string here.
  return { value: v };
}
