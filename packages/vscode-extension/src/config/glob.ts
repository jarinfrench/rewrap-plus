/**
 * Shared glob matching used by `.editorconfig` section headers
 * (`./editorconfig.ts`) and `rewrapPlus.stringWrapInclude`
 * (`./string-wrap-include.ts`) — both match a workspace-supplied glob
 * pattern against a path relative to some anchor directory, and both
 * need the same "no separator means any depth" convention (equivalent to
 * an implicit `**\/` prefix) since that's the single most common case
 * for either feature (`*.py`, or the default `**`).
 *
 * Pulled out from `./editorconfig.ts` rather than duplicated when
 * `stringWrapInclude` needed the same engine — the two callers differ
 * only in how they compute the relative path handed to `matchesGlob`
 * (an EditorConfig section's own directory vs. the workspace folder),
 * not in the glob dialect itself.
 */

/** Translate one glob into a `RegExp` source fragment (unanchored — `matchesGlob` wraps it in `^...$`). Supports `*`, `**`, `?`, `[seq]`/`[!seq]`, and single-level `{a,b,c}` alternation.
 *
 * ## Every maximal run of `*` collapses to exactly one quantifier
 *
 * A pattern is workspace-supplied — a `.editorconfig` from a cloned repo,
 * or a `rewrapPlus.stringWrapInclude` entry in workspace settings, is
 * exactly as untrusted as any other file content this project parses
 * (`SECURITY.md`'s "workspace-trust bypass" category). An earlier version
 * only special-cased a *pair* of stars (`**` → `.*`, anything else one
 * `*` at a time → `[^/]*`), so three or more consecutive stars compiled
 * to several adjacent `[^/]*`/`.*` quantifiers back to back — e.g. `****`
 * became `[^/]*[^/]*` (after one `**` pair and two lone `*`s). Multiple
 * adjacent quantifiers over overlapping character classes is the
 * textbook catastrophic-backtracking shape: confirmed directly (not just
 * suspected) by timing the compiled regex against a non-matching path —
 * a `[glob]` header with ~25 consecutive `*` characters took over two
 * minutes to fail one match, and the growth curve was exponential in
 * star count. Since a run of two-or-more stars already means "any depth,
 * including zero characters" under both this module's own
 * `**`-across-separators semantics and every real specification's
 * redundant-star handling, collapsing an *entire* run (however long)
 * into the single widest quantifier it implies is both a strict semantic
 * no-op for well-formed patterns and what removes the adjacent-quantifier
 * ambiguity that made the blowup possible: a run is now always exactly
 * one `RegExp` quantifier, never several in a row.
 */
export function globToRegExpSource(pattern: string): string {
  let re = '';
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i]!;

    if (ch === '*') {
      let j = i + 1;
      while (pattern[j] === '*') {
        j += 1;
      }
      const isGlobstar = j - i >= 2;
      re += isGlobstar ? '.*' : '[^/]*';
      i = j;
      continue;
    }

    if (ch === '?') {
      re += '[^/]';
      i += 1;
      continue;
    }

    if (ch === '[') {
      let j = i + 1;
      let negate = false;
      if (pattern[j] === '!') {
        negate = true;
        j += 1;
      }
      let body = '';
      while (j < pattern.length && pattern[j] !== ']') {
        body += pattern[j];
        j += 1;
      }
      re += `[${negate ? '^' : ''}${body.replace(/\\/g, '\\\\')}]`;
      i = j + 1; // skip the closing ']' too
      continue;
    }

    if (ch === '{') {
      let j = i + 1;
      let group = '';
      while (j < pattern.length && pattern[j] !== '}') {
        group += pattern[j];
        j += 1;
      }
      const alternatives = group.split(',').map((alt) => escapeRegExpLiteral(alt));
      re += `(?:${alternatives.join('|')})`;
      i = j + 1; // skip the closing '}' too
      continue;
    }

    re += escapeRegExpLiteral(ch);
    i += 1;
  }

  return re;
}

function escapeRegExpLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Test `pattern` against `path` (already relative to whatever anchor the
 * caller's glob dialect uses — an EditorConfig section's directory, or a
 * workspace folder — and already `/`-separated).
 *
 * A pattern containing a path separator is matched against the full
 * relative path; a pattern with no path separator matches at *any* depth
 * (equivalent to prefixing it with `**\/`) — including depth 0, which is
 * why this prepends an *optional* `(?:.*\/)?`, not a mandatory literal
 * `/`: a mandatory separator would make e.g. `*.py` fail to match `a.py`
 * sitting directly at the anchor, which is the single most common case
 * there is. A leading `/` on the pattern is an explicit anchor and is
 * stripped before matching either way — it selects the "has a separator"
 * branch without itself being part of the matched text.
 */
export function matchesGlob(pattern: string, path: string): boolean {
  const anchored = pattern.startsWith('/') ? pattern.slice(1) : pattern;
  const source = anchored.includes('/')
    ? globToRegExpSource(anchored)
    : `(?:.*/)?${globToRegExpSource(anchored)}`;

  return new RegExp(`^${source}$`).test(path);
}

// Known limitations (shared by every caller of matchesGlob):
//
// - Numeric brace ranges (`{1..3}`) are not expanded — the naive
//   comma-split sees no comma, so `{1..3}` is matched as the single
//   literal string `"1..3"`, never as a range.
// - Nested `{a,{b,c}}` brace groups are not supported; only one flat
//   level of comma-separated alternatives.
