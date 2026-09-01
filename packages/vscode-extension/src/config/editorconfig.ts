/**
 * Self-contained `.editorconfig` `max_line_length` resolution
 * (commit 3).
 *
 * Parsed directly rather than depending on the EditorConfig extension
 * being installed — otherwise precedence tier 3 (see
 * `./column-limit.ts`) silently disappears for anyone who doesn't
 * happen to have that other extension, which is worse than not
 * supporting `.editorconfig` at all. Uses `node:fs` directly (this is
 * `packages/vscode-extension`, not the engine — Node built-ins are fine
 * here) rather than `vscode.workspace.fs`, since the algorithm below
 * needs plain synchronous directory-walking and `.editorconfig` files
 * are almost always small, local, and outside any remote-filesystem
 * scenario `vscode.workspace.fs` exists for.
 *
 * Implements the parts of the EditorConfig spec this feature actually
 * needs — `root`, section glob matching, and `max_line_length` — not a
 * general-purpose EditorConfig property reader. See the "Known
 * limitations" section at the bottom for what's deliberately out of
 * scope.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { matchesGlob } from './glob.js';

interface EditorConfigSection {
  /** `null` for properties that appear before any `[glob]` header — treated as applying unconditionally, matching how most EditorConfig parsers handle a bare preamble. */
  readonly pattern: string | null;
  readonly properties: ReadonlyMap<string, string>;
}

interface EditorConfigFile {
  /** Absolute directory containing this `.editorconfig` file — glob patterns are matched relative to here. */
  readonly dir: string;
  readonly sections: readonly EditorConfigSection[];
}

/**
 * Resolve the effective `max_line_length` for `filePath` by walking from
 * its containing directory up to the filesystem root (or up to the
 * nearest ancestor `.editorconfig` declaring `root = true`, whichever
 * comes first), applying every matching section in root-to-leaf,
 * top-to-bottom order — so that a value from a `.editorconfig` closer to
 * `filePath`, or a later section within one file, always overwrites one
 * from farther away, per the spec's own "closer/later wins" precedence.
 *
 * Returns `undefined` when no matching section sets `max_line_length`,
 * or the closest matching value is explicitly `off` (EditorConfig's own
 * way of saying "no limit" — treated as "this tier doesn't apply",
 * falling through to tier 4 in `./column-limit.ts` rather than being
 * mistaken for "no opinion, keep an earlier match").
 */
export function resolveEditorConfigMaxLineLength(filePath: string): number | undefined {
  const files = collectEditorConfigFiles(dirname(filePath));

  let result: number | undefined;
  for (const file of files) {
    for (const section of file.sections) {
      if (section.pattern !== null && !matchesEditorConfigGlob(section.pattern, file.dir, filePath)) {
        continue;
      }
      const raw = section.properties.get('max_line_length');
      if (raw === undefined) {
        continue;
      }
      if (raw.toLowerCase() === 'off') {
        result = undefined;
      } else {
        const parsed = Number.parseInt(raw, 10);
        if (Number.isFinite(parsed)) {
          result = parsed;
        }
        // A non-numeric, non-"off" value is malformed input — ignored,
        // leaving whatever the previous matching section established,
        // rather than clearing tier 3 outright over one bad line.
      }
    }
  }
  return result;
}

/**
 * Walk from `startDir` up to the filesystem root, collecting every
 * `.editorconfig` found, stopping *after* including the first one (searching
 * nearest-first) that declares `root = true`. Returned farthest-to-nearest
 * (root-most first), the order `resolveEditorConfigMaxLineLength` needs to
 * apply sections in.
 */
function collectEditorConfigFiles(startDir: string): EditorConfigFile[] {
  const collected: EditorConfigFile[] = [];

  let dir = startDir;
  for (;;) {
    const path = join(dir, '.editorconfig');
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf8');
      const sections = parseEditorConfig(content);
      collected.push({ dir, sections });
      if (isRoot(sections)) {
        break;
      }
    }

    const parent = dirname(dir);
    if (parent === dir) {
      break; // reached the filesystem root without finding root = true
    }
    dir = parent;
  }

  return collected.reverse();
}

function isRoot(sections: readonly EditorConfigSection[]): boolean {
  const preamble = sections.find((section) => section.pattern === null);
  return preamble?.properties.get('root')?.toLowerCase() === 'true';
}

/**
 * Parse one `.editorconfig` file's text into an ordered list of
 * sections — index 0 is always the (possibly empty) preamble
 * (`pattern: null`) for any `key = value` lines before the first
 * `[glob]` header, since that's where `root = true` lives.
 *
 * Deliberately minimal: no inline (trailing) comment stripping, no
 * value validation beyond what `max_line_length` itself needs — see
 * "Known limitations" below.
 */
function parseEditorConfig(content: string): EditorConfigSection[] {
  const sections: EditorConfigSection[] = [];
  let current: { pattern: string | null; properties: Map<string, string> } = {
    pattern: null,
    properties: new Map(),
  };
  sections.push(current);

  for (const rawLine of content.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) {
      continue;
    }

    const sectionMatch = /^\[(.*)]$/.exec(line);
    if (sectionMatch) {
      current = { pattern: sectionMatch[1]!, properties: new Map() };
      sections.push(current);
      continue;
    }

    const eq = line.indexOf('=');
    if (eq === -1) {
      continue; // not a recognizable `key = value` line — skip rather than throw, matching the engine-wide "skip, don't block" posture
    }
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    current.properties.set(key, value);
  }

  return sections;
}

/**
 * Test `pattern` (as it appeared inside a `[...]` section header,
 * `sectionDir`-relative) against `filePath`.
 *
 * Per the EditorConfig spec: a pattern containing a path separator is
 * anchored to `sectionDir` and matched against the full relative path; a
 * pattern with no path separator matches the filename at *any* depth
 * below `sectionDir`. That's exactly `./glob.ts`'s `matchesGlob`
 * convention, so this is a thin wrapper computing the one thing specific
 * to EditorConfig's own dialect — the path relative to `sectionDir` — and
 * handing it off.
 *
 * Exported (unlike the rest of this module's internals) so glob-pattern
 * edge cases — brace alternation, character classes, `**` — can be unit
 * tested directly against pattern/path triples, without needing a
 * fixture directory on disk for each one; `resolveEditorConfigMaxLineLength`'s
 * own tests cover the walk-order/`root`/`off` semantics end to end
 * instead, where fixture files are the more natural shape.
 */
export function matchesEditorConfigGlob(pattern: string, sectionDir: string, filePath: string): boolean {
  const relativePath = relative(sectionDir, filePath).split('\\').join('/');
  return matchesGlob(pattern, relativePath);
}

// Known limitations:
//
// - Numeric brace ranges (`{1..3}`) and nested brace groups — see
//   `./glob.ts`'s own "Known limitations". Vanishingly rare in real
//   `.editorconfig` files for `max_line_length` sections specifically
//   (ranges are far more common for numbered fixture/test directories),
//   so left unhandled rather than adding a second glob dialect for a
//   case this feature is unlikely to ever see exercised.
// - No inline (trailing) comment stripping — `key = value ; comment`
//   treats `; comment` as part of `value`. Full-line comments (`;`/`#`
//   as the line's first non-whitespace character) are handled.
