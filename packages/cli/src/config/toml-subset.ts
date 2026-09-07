/**
 * A minimal TOML reader -- just enough to read one dotted table's
 * `key = value` pairs out of a `pyproject.toml`, the same "implement the
 * parts of the spec this feature actually needs, not a general-purpose
 * reader" call `../config/editorconfig.ts` already makes for
 * `.editorconfig` (and, before it,
 * `packages/vscode-extension/src/config/editorconfig.ts`). Pulling in a
 * full TOML dependency for one four-key table (`./pyproject.ts`'s
 * `[tool.rewrap-plus]`) would be a real dependency for a narrow need;
 * `black`/`ruff`/every other `pyproject.toml`-reading Python tool's own
 * `[tool.*]` tables use exactly this shape (flat `key = value` pairs
 * under one table header), so that's all this needs to parse correctly.
 *
 * Supported: `[dotted.table.headers]`, `key = "string"` (double-quoted,
 * `\"`/`\\`/`\n`/`\t` escapes only), `key = 123` / `key = -4` (bare
 * integers, `_` digit separators per the TOML spec), `key = true` /
 * `key = false`, and `#` full-line or trailing comments outside a
 * string.
 *
 * Not supported (a value in a table this module returns simply omits
 * the key, the same "skip malformed/unsupported input" posture
 * `editorconfig.ts` takes for a bad `.editorconfig` line): single-quoted
 * (literal) strings, multi-line strings, floats, dates, arrays, inline
 * tables, and `[[array of tables]]` headers. None of these are used by
 * `[tool.rewrap-plus]`'s own key set (`./pyproject.ts`), so a real
 * `pyproject.toml` with an unrelated `[tool.black]` array-valued key
 * elsewhere in the file parses fine -- the unsupported value is simply
 * never a key this module is asked to read.
 */
export type TomlValue = string | number | boolean;

/** Maps a dotted table header (`"tool.rewrap-plus"`, header brackets/whitespace already stripped) to its flat `key -> value` pairs. */
export type TomlTables = ReadonlyMap<string, ReadonlyMap<string, TomlValue>>;

export function parseTomlSubset(content: string): TomlTables {
  const tables = new Map<string, Map<string, TomlValue>>();
  let current: Map<string, TomlValue> | undefined;

  for (const rawLine of content.split(/\r\n|\r|\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) {
      continue;
    }

    const headerMatch = /^\[([^[\]]+)]$/.exec(line);
    if (headerMatch) {
      const name = headerMatch[1]!.trim();
      current = tables.get(name);
      if (!current) {
        current = new Map();
        tables.set(name, current);
      }
      continue;
    }

    // `[[array.of.tables]]` and anything else structurally unlike a
    // plain `[table]` header or `key = value` line (including a stray
    // line before any header, which has no table to attach to) is
    // skipped outright rather than throwing -- same "don't block on
    // input this feature doesn't need to understand" posture as
    // `editorconfig.ts`'s own unrecognized-line handling.
    if (!current || line.startsWith('[')) {
      continue;
    }

    const eq = line.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const key = unquoteKey(line.slice(0, eq).trim());
    const rawValue = line.slice(eq + 1).trim();
    const value = parseValue(rawValue);
    if (value !== undefined) {
      current.set(key, value);
    }
  }

  return tables;
}

/**
 * Strips a `#` trailing comment -- but only one that starts outside a
 * double-quoted string, so `key = "a # not a comment"` isn't truncated.
 * A bare `#` as the first non-whitespace character (a full-line comment)
 * is caught by this the same way, since it starts outside any string by
 * definition.
 */
function stripComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i - 1] !== '\\') {
      inString = !inString;
    } else if (ch === '#' && !inString) {
      return line.slice(0, i);
    }
  }
  return line;
}

/** TOML allows a bare key to be quoted (`"key with spaces"`); every key this module actually reads is a bare identifier, but stripping quotes if present costs nothing and avoids a silent lookup miss. */
function unquoteKey(key: string): string {
  if (key.length >= 2 && key.startsWith('"') && key.endsWith('"')) {
    return key.slice(1, -1);
  }
  return key;
}

function parseValue(raw: string): TomlValue | undefined {
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }

  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return unescapeString(raw.slice(1, -1));
  }

  // Bare integer, with TOML's optional leading sign and `_` digit
  // separators (e.g. `1_000`) -- anything else (floats, dates, arrays,
  // inline tables, single-quoted strings) falls through to `undefined`
  // and the key is simply omitted, per this module's own "unsupported ->
  // skip" contract.
  if (/^[+-]?\d[\d_]*$/.test(raw)) {
    const parsed = Number.parseInt(raw.replace(/_/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function unescapeString(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === 'n') {
        result += '\n';
        i++;
      } else if (next === 't') {
        result += '\t';
        i++;
      } else if (next === '"') {
        result += '"';
        i++;
      } else if (next === '\\') {
        result += '\\';
        i++;
      } else {
        result += ch; // unrecognized escape -- keep the backslash literally rather than guessing
      }
    } else {
      result += ch;
    }
  }
  return result;
}
