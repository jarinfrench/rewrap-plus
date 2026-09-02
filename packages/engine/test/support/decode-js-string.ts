/**
 * Test-only eval-equivalence oracle for JavaScript/TypeScript string
 * literals — the JS/TS counterpart to `./decode-python-string.ts`. See that
 * module's own doc comment for the full rationale ("eval the string
 * expression before and after and assert equality," why this must never
 * ship in engine runtime code, why an independent oracle rather than
 * trusting the engine's own dissolve/emit code both times).
 *
 * Unlike Python, no hand-written escape decoder is needed here: the string
 * literal syntax this project's JS/TS fixtures use (`'...'`/`"..."`, never
 * a template literal — see below) is already valid JavaScript, and this
 * test suite already runs inside a real JS engine. So the oracle scans the
 * source for every single/double-quoted token, joins them with `+`, and
 * literally `eval`s the result — genuinely "eval the string expression,"
 * not a reimplementation of what eval would do.
 *
 * A backtick template literal is scanned over and skipped, never extracted
 * as a token: this project's JS/TS adapters don't wrap template literals at
 * all yet (`docs/planning/implementation-plan.md`, Phase 12b: "Consider
 * deferring templates the way triple-quoted code strings were deferred in
 * Python"), so no fixture should contain one inside the wrappable construct
 * under test — but a stray backtick elsewhere in a fixture (unlikely today,
 * still worth guarding) must not have its own internal quote characters
 * mis-parsed as string-token boundaries.
 */
export function extractConcatenatedStringValue(source: string): string {
  const tokens: string[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== '`') {
        j += source[j] === '\\' && j + 1 < source.length ? 2 : 1;
      }
      i = j + 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) {
        j += source[j] === '\\' && j + 1 < source.length ? 2 : 1;
      }
      tokens.push(source.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    i++;
  }

  if (tokens.length === 0) {
    return '';
  }
  return eval(tokens.join(' + ')) as string;
}
