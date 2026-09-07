/**
 * Self-contained `.editorconfig` `max_line_length` resolution
 * (commit 3).
 *
 * Parsed directly rather than depending on the EditorConfig extension
 * being installed -- otherwise precedence tier 3 (see
 * `./column-limit.ts`) silently disappears for anyone who doesn't
 * happen to have that other extension, which is worse than not
 * supporting `.editorconfig` at all. Uses `node:fs` directly (this is
 * `packages/vscode-extension`, not the engine -- Node built-ins are fine
 * here) rather than `vscode.workspace.fs`, since the algorithm below
 * needs plain synchronous directory-walking and `.editorconfig` files
 * are almost always small, local, and outside any remote-filesystem
 * scenario `vscode.workspace.fs` exists for.
 *
 * Implements the parts of the EditorConfig spec this feature actually
 * needs -- `root`, section glob matching, and `max_line_length` -- not a
 * general-purpose EditorConfig property reader. See the "Known
 * limitations" section at the bottom for what's deliberately out of
 * scope.
 *
 * The directory walk itself is cached per directory (`dirCache` below) --
 * this used to run `existsSync`/`readFileSync` at every directory level
 * from the target file up to the filesystem root on *every* resolution,
 * including from the auto-wrap path which resolves on every triggering
 * keystroke. Invalidation has three triggers, checked in this file only
 * as plain data operations (`invalidateEditorConfigCacheDir`,
 * `clearEditorConfigCache`) so this module can stay `vscode`-free and
 * unit-testable outside a real editor host, same as everything else
 * here -- `./editorconfig-cache-invalidation.ts` is the thin `vscode`-facing
 * glue that wires them to real events:
 *
 * 1. Saving a `.editorconfig` document invalidates just that one
 *    directory's entry (`handleEditorConfigSave`) -- precise, since a save
 *    event already tells us exactly what changed.
 * 2. The window regaining focus clears the whole cache
 *    (`handleWindowStateChange`) -- coarse but cheap, covering anything
 *    that could have changed `.editorconfig` files on disk while the
 *    window was unfocused (`git pull`, a branch switch, an external
 *    editor) with no per-file signal available to narrow it.
 * 3. `EDITORCONFIG_CACHE_TTL_MS` is a backstop expiry on every entry
 *    regardless of the above, bounding staleness for the one gap neither
 *    trigger catches -- a `.editorconfig` edited via a command run in
 *    VSCode's own integrated terminal, which touches disk without ever
 *    saving a document or blurring the window.
 *
 * None of this changes precedence tier 3's place in `./column-limit.ts`'s
 * resolution order -- only *when* a fresh value is observed there, never
 * whether or in what order it's consulted.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { matchesGlob } from './glob.js';

interface EditorConfigSection {
  /** `null` for properties that appear before any `[glob]` header -- treated as applying unconditionally, matching how most EditorConfig parsers handle a bare preamble. */
  readonly pattern: string | null;
  readonly properties: ReadonlyMap<string, string>;
}

interface EditorConfigFile {
  /** Absolute directory containing this `.editorconfig` file -- glob patterns are matched relative to here. */
  readonly dir: string;
  readonly sections: readonly EditorConfigSection[];
}

/**
 * Resolve the effective `max_line_length` for `filePath` by walking from
 * its containing directory up to the filesystem root (or up to the
 * nearest ancestor `.editorconfig` declaring `root = true`, whichever
 * comes first), applying every matching section in root-to-leaf,
 * top-to-bottom order -- so that a value from a `.editorconfig` closer to
 * `filePath`, or a later section within one file, always overwrites one
 * from farther away, per the spec's own "closer/later wins" precedence.
 *
 * Returns `undefined` when no matching section sets `max_line_length`,
 * or the closest matching value is explicitly `off` (EditorConfig's own
 * way of saying "no limit" -- treated as "this tier doesn't apply",
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
        // A non-numeric, non-"off" value is malformed input -- ignored,
        // leaving whatever the previous matching section established,
        // rather than clearing tier 3 outright over one bad line.
      }
    }
  }
  return result;
}

/** How long a directory's cached `.editorconfig` state is trusted before a lookup re-reads disk, absent an explicit invalidation. See this file's own doc comment for the full invalidation picture. */
export const EDITORCONFIG_CACHE_TTL_MS = 45_000;

interface DirCacheEntry {
  /** Whether `<dir>/.editorconfig` exists -- cached explicitly (not just absence-of-entry) since a directory with no `.editorconfig` is the dominant case while walking toward the filesystem root, and is exactly what used to cost an uncached `existsSync` at every level. */
  readonly exists: boolean;
  readonly sections: readonly EditorConfigSection[];
  readonly declaresRoot: boolean;
  readonly cachedAt: number;
}

const dirCache = new Map<string, DirCacheEntry>();

function getDirCacheEntry(dir: string): DirCacheEntry {
  const cached = dirCache.get(dir);
  if (cached && Date.now() - cached.cachedAt < EDITORCONFIG_CACHE_TTL_MS) {
    return cached;
  }
  const entry = readDirCacheEntry(dir);
  dirCache.set(dir, entry);
  return entry;
}

function readDirCacheEntry(dir: string): DirCacheEntry {
  const path = join(dir, '.editorconfig');
  if (!existsSync(path)) {
    return { exists: false, sections: [], declaresRoot: false, cachedAt: Date.now() };
  }
  const content = readFileSync(path, 'utf8');
  const sections = parseEditorConfig(content);
  return { exists: true, sections, declaresRoot: isRoot(sections), cachedAt: Date.now() };
}

/**
 * Clear the cached `.editorconfig` state for exactly one directory. Used
 * when that directory's `.editorconfig` is saved in the editor, so the
 * next resolution touching it re-reads immediately rather than waiting
 * out `EDITORCONFIG_CACHE_TTL_MS`. Deliberately narrow -- a save event
 * already identifies precisely which directory changed, so there's no
 * reason to discard anything else that's cached.
 */
export function invalidateEditorConfigCacheDir(dir: string): void {
  dirCache.delete(dir);
}

/**
 * Clear every cached directory entry. Used when the window regains focus,
 * since anything could have changed `.editorconfig` files on disk while
 * it was unfocused with no per-file signal available to narrow the
 * invalidation to. Cheap even though it's total: entries are only ever
 * populated lazily on lookup, so this just means the next lookup per
 * directory re-reads disk once, the same one-time cost as a fresh
 * `resolveEditorConfigMaxLineLength` call.
 */
export function clearEditorConfigCache(): void {
  dirCache.clear();
}

/**
 * Pure decision logic for the on-save invalidation trigger -- takes a
 * plain `{scheme, fsPath}` shape rather than `vscode.Uri` so it stays
 * `vscode`-free and unit-testable directly (this file's own doc comment
 * explains why); `./editorconfig-cache-invalidation.ts` is the thin
 * `vscode`-facing wiring that calls this from `onDidSaveTextDocument`.
 */
export function handleEditorConfigSave(uri: { readonly scheme: string; readonly fsPath: string }): void {
  if (uri.scheme === 'file' && basename(uri.fsPath) === '.editorconfig') {
    invalidateEditorConfigCacheDir(dirname(uri.fsPath));
  }
}

/**
 * Pure decision logic for the on-focus invalidation trigger -- see
 * `handleEditorConfigSave`'s doc comment for why this stays `vscode`-free.
 */
export function handleWindowStateChange(state: { readonly focused: boolean }): void {
  if (state.focused) {
    clearEditorConfigCache();
  }
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
    const entry = getDirCacheEntry(dir);
    if (entry.exists) {
      collected.push({ dir, sections: entry.sections });
      if (entry.declaresRoot) {
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
 * sections -- index 0 is always the (possibly empty) preamble
 * (`pattern: null`) for any `key = value` lines before the first
 * `[glob]` header, since that's where `root = true` lives.
 *
 * Deliberately minimal: no inline (trailing) comment stripping, no
 * value validation beyond what `max_line_length` itself needs -- see
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
      continue; // not a recognizable `key = value` line -- skip rather than throw, matching the engine-wide "skip, don't block" posture
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
 * to EditorConfig's own dialect -- the path relative to `sectionDir` -- and
 * handing it off.
 *
 * Exported (unlike the rest of this module's internals) so glob-pattern
 * edge cases -- brace alternation, character classes, `**` -- can be unit
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
// - Numeric brace ranges (`{1..3}`) and nested brace groups -- see
//   `./glob.ts`'s own "Known limitations". Vanishingly rare in real
//   `.editorconfig` files for `max_line_length` sections specifically
//   (ranges are far more common for numbered fixture/test directories),
//   so left unhandled rather than adding a second glob dialect for a
//   case this feature is unlikely to ever see exercised.
// - No inline (trailing) comment stripping -- `key = value ; comment`
//   treats `; comment` as part of `value`. Full-line comments (`;`/`#`
//   as the line's first non-whitespace character) are handled.
