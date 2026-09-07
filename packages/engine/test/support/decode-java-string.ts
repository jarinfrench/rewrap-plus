/**
 * Test-only reimplementation of enough of Java's own string escape decoding
 * to support an eval-equivalence check for the Java adapter's string-wrap
 * gold fixtures (`../wrap/java-string-wrap-fixtures.test.ts`) -- the Java
 * counterpart to `./decode-python-string.ts`. See that module's own doc
 * comment for the shared rationale: never shipped in engine runtime code, a
 * test-only oracle independent of the engine's own dissolve/emit, not a
 * full-fidelity implementation, only faithful enough for the escape forms
 * this project's own gold fixtures actually use.
 *
 * `eval` isn't an option the way it is for `./decode-js-string.ts` -- a Java
 * string literal isn't valid JavaScript -- so this hand-decodes, same
 * approach as the Python and C++ oracles.
 *
 * Scope:
 * - Java has no `\x` hex escape (unlike C++/JS) -- only `\uXXXX` (always
 *   exactly four hex digits) and octal `\0`-`\377`.
 * - Real `javac` processes `\uXXXX` as a *pre-lexical* translation applied
 *   to the raw source text before tokenization even begins (JLS Sec. 3.3), so
 *   it can appear anywhere, not just inside a string literal. This oracle
 *   only decodes it where it appears inside a scanned string literal's
 *   body, which is sufficient for every fixture this project has -- none
 *   place a `\u` escape outside a string.
 * - Text blocks (`"""..."""`, Java 15+) are skipped as opaque, never
 *   decoded: this adapter never wraps them at all
 *   (`neg-004-text-block.in.java`), and their whitespace-normalization
 *   rules are a different, more involved decoding problem this oracle has
 *   no reason to take on.
 */

const ESCAPE_MAP: Record<string, string> = {
  '\\': '\\',
  "'": "'",
  '"': '"',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  s: ' ', // Java 15+ escape for a literal space, permitted in text blocks and ordinary strings alike
};

/** Decode one Java string literal's *body* (quotes already stripped, never a text block). */
export function decodeJavaStringBody(body: string): string {
  let result = '';
  let i = 0;
  while (i < body.length) {
    const ch = body[i]!;
    if (ch !== '\\' || i === body.length - 1) {
      result += ch;
      i++;
      continue;
    }

    const next = body[i + 1]!;
    if (next in ESCAPE_MAP) {
      result += ESCAPE_MAP[next];
      i += 2;
      continue;
    }
    if (next === 'u' && /^[0-9a-fA-F]{4}/.test(body.slice(i + 2))) {
      result += String.fromCharCode(parseInt(body.slice(i + 2, i + 6), 16));
      i += 6;
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1));
    if (octal) {
      result += String.fromCharCode(parseInt(octal[0], 8) & 0xff);
      i += 1 + octal[0].length;
      continue;
    }
    // Unrecognized escape: keep the backslash verbatim, same fallback as
    // the Python/C++ oracles.
    result += ch;
    i++;
  }
  return result;
}

/**
 * Find every ordinary (non-text-block) double-quoted string literal token
 * in `source`, respecting backslash escapes, and concatenate their decoded
 * values in order. Same whole-file scanning strategy as
 * `decode-python-string.ts`'s own `extractConcatenatedStringValue`: every
 * fixture pairs exactly one wrappable string construct with no other
 * string literal, so summing every token found anywhere reconstructs that
 * construct's value regardless of how many `+`-joined parts the source
 * splits it into.
 */
export function extractConcatenatedStringValue(source: string): string {
  let result = '';
  let i = 0;
  while (i < source.length) {
    if (source[i] !== '"') {
      i++;
      continue;
    }
    if (source.slice(i, i + 3) === '"""') {
      // Text block: skip over it opaquely, never decoded (see module doc
      // comment).
      const close = source.indexOf('"""', i + 3);
      i = close === -1 ? source.length : close + 3;
      continue;
    }

    let j = i + 1;
    let body = '';
    while (j < source.length && source[j] !== '"') {
      if (source[j] === '\\' && j + 1 < source.length) {
        body += source[j]! + source[j + 1]!;
        j += 2;
      } else {
        body += source[j]!;
        j++;
      }
    }
    result += decodeJavaStringBody(body);
    i = j + 1;
  }
  return result;
}
