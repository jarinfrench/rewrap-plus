import { describe, expect, it } from 'vitest';
import { findUnbreakableSpans } from './unbreakable-spans.js';

function spanTexts(line: string): string[] {
  return findUnbreakableSpans(line).map((s) => line.slice(s.start, s.end));
}

function spanTextsWith(line: string, extraPatterns: readonly RegExp[]): string[] {
  return findUnbreakableSpans(line, extraPatterns).map((s) => line.slice(s.start, s.end));
}

describe('findUnbreakableSpans', () => {
  it('finds no spans in plain prose', () => {
    expect(findUnbreakableSpans('just some ordinary words here')).toEqual([]);
  });

  it('finds a brace placeholder with no internal whitespace', () => {
    expect(spanTexts('Total: {count} items')).toEqual(['{count}']);
  });

  it('finds an f-string interpolation containing internal whitespace', () => {
    expect(spanTexts('Result: {a + b} done')).toEqual(['{a + b}']);
  });

  it('finds a format-spec placeholder with nested braces', () => {
    expect(spanTexts('Value: {value:{width}} end')).toEqual(['{value:{width}}']);
  });

  it('finds a rich format placeholder with conversion and spec', () => {
    expect(spanTexts('Name: {name!r:>10}.')).toEqual(['{name!r:>10}']);
  });

  it('finds percent-style placeholders', () => {
    expect(spanTexts('%s failed with code %(code)d')).toEqual(['%s', '%(code)d']);
  });

  it('finds escape sequences', () => {
    expect(spanTexts('line one\\nline two')).toEqual(['\\n']);
    expect(spanTexts('tab\\there')).toEqual(['\\t']);
    expect(spanTexts('hex \\x41 unicode \\u1234 wide \\U0001F600')).toEqual([
      '\\x41',
      '\\u1234',
      '\\U0001F600',
    ]);
    expect(spanTexts('named \\N{BULLET}')).toEqual(['\\N{BULLET}']);
  });

  it('finds a C++/C-style multi-digit hex escape whole, not just its first 2 digits', () => {
    // Regression for a confirmed string-corruption bug: unlike Python's
    // fixed-2-digit `\x`, C++'s `\x` consumes every following hex digit.
    // Recognizing only `\x12` out of `\x1234` let a wrap split land
    // between the escape and its remaining digits, silently turning one
    // character (0x1234) into a different character plus two literal
    // digit characters — reproduced directly against `emitString` while
    // auditing this module.
    expect(spanTexts('wide \\x1234 char')).toEqual(['\\x1234']);
  });

  it('finds octal escapes of 1-3 digits, not just a bare \\0', () => {
    expect(spanTexts('octal \\101 escape')).toEqual(['\\101']);
    expect(spanTexts('octal \\12 escape')).toEqual(['\\12']);
    expect(spanTexts('null \\0 byte')).toEqual(['\\0']);
  });

  it('finds a JS/TS ES2015 \\u{...} code-point escape whole', () => {
    // Regression: this form had no representation at all before, so a
    // wrap could split between `\u` and `{1F600}` — not merely a wrong
    // value but invalid JavaScript/TypeScript syntax (`\u` not followed
    // by 4 hex digits or `{...}` is a SyntaxError), reproduced directly
    // against `emitString` while auditing this module.
    expect(spanTexts('emoji \\u{1F600} here')).toEqual(['\\u{1F600}']);
  });

  it('finds a C++ escaped question mark', () => {
    expect(spanTexts('trigraph \\? guard')).toEqual(['\\?']);
  });

  it('finds an inline code span containing internal whitespace', () => {
    expect(spanTexts('run `git commit -m msg` first')).toEqual(['`git commit -m msg`']);
  });

  it('does not misread a bare code-fence delimiter as an empty inline code span', () => {
    // Regression: `` `[^`\n]*` `` (zero-or-more) matched the first two
    // backticks of a bare ` ``` ` as an empty span, stranding the third
    // backtick as its own separately-breakable atom — confirmed directly
    // while building a docstring fixture with a fenced code sample inside
    // a field-entry description. See `../segmentation/unbreakable-spans.ts`'s
    // own comment on the `INLINE_CODE`/`REST_ROLE` fix.
    expect(spanTexts('```')).toEqual([]);
    expect(spanTexts('before ``` after')).toEqual([]);
  });

  it('finds a reST role whole, including its leading colon prefix', () => {
    expect(spanTexts('see :func:`do the thing` for details')).toEqual([':func:`do the thing`']);
  });

  it('finds a bare URL with no internal whitespace', () => {
    expect(spanTexts('see https://example.com/a/b for more')).toEqual(['https://example.com/a/b']);
  });

  it('finds multiple non-overlapping spans in one line', () => {
    expect(spanTexts('{greeting}, %s! see `here` now')).toEqual(['{greeting}', '%s', '`here`']);
  });

  it('finds a span from an extra caller-supplied pattern, alongside the built-in set', () => {
    // The `\verb`/`\lstinline` shape (`docs/planning/markdown-latex-plan.md`
    // §4.3) — a delimiter-bounded raw span the built-in patterns know
    // nothing about.
    const verb = /\\verb\*?(.)[^\n]*?\1/;
    expect(spanTextsWith('see \\verb|a b c| now', [verb])).toEqual(['\\verb|a b c|']);
  });

  it('prefers an extra pattern over a built-in one that would also match at the same start', () => {
    // A `\verb`-delimited span that also happens to look URL-shaped
    // inside it — the extra pattern must win, keeping the whole `\verb`
    // span intact rather than the built-in `URL` pattern only grabbing
    // part of it.
    const verb = /\\verb\|[^\n|]*\|/;
    const line = '\\verb|https://example.com| after';
    const spans = findUnbreakableSpans(line, [verb]);
    expect(spans).toHaveLength(1);
    expect(line.slice(spans[0]!.start, spans[0]!.end)).toBe('\\verb|https://example.com|');
  });

  it('still finds built-in spans when extra patterns are given but do not match', () => {
    const neverMatches = /NEVER_MATCHES_ANYTHING_XYZ/;
    expect(spanTextsWith('see {x} now', [neverMatches])).toEqual(['{x}']);
  });

  it('does not carry extra patterns over into a call without them', () => {
    // A fresh combined RegExp is built per call — an earlier call's
    // extra patterns must never leak into a later call that didn't ask
    // for them. "AAA" matches neither the built-in set nor anything but
    // the extra pattern below, so any match on the second, plain call
    // would have to be a leak from the first.
    const shout = /AAA/;
    findUnbreakableSpans('AAA', [shout]);
    expect(findUnbreakableSpans('AAA bbb')).toEqual([]);
  });

  it('returns the same result as no extra patterns when given an empty array', () => {
    expect(spanTextsWith('see {x} now', [])).toEqual(spanTexts('see {x} now'));
  });

  it('stays fast on a long letter run with no colon anywhere (quadratic-backtracking regression)', () => {
    // Confirmed directly while auditing this module: the `URL` pattern's
    // unbounded `[a-zA-Z0-9+.-]*` scheme, followed by a required `://`
    // that never appears, cost `O(k)` per starting position within a
    // `k`-character run — a 150,000-character run of plain letters took
    // ~20 seconds on this pattern alone. This runs on every comment/
    // docstring/string line `atomizeWords` segments, a hot path.
    const input = 'a'.repeat(200_000);
    const start = Date.now();
    findUnbreakableSpans(input);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
