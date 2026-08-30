/**
 * Test-only reimplementation of enough of C++'s own non-raw string escape
 * decoding to support an eval-equivalence check for the C++ adapter's
 * string-wrap gold fixtures (`../wrap/cpp-string-wrap-fixtures.test.ts`) —
 * the C++ counterpart to `./decode-python-string.ts`. See that module's own
 * doc comment for the shared rationale: never shipped in engine runtime
 * code, a test-only oracle independent of the engine's own dissolve/emit,
 * not a full-fidelity implementation, only faithful enough for the escape
 * forms this project's own gold fixtures actually use.
 *
 * `eval` isn't an option here the way it is for
 * `./decode-js-string.ts` — a C++ string literal isn't valid JavaScript —
 * so this hand-decodes, same approach as the Python oracle.
 *
 * Scope, mirroring `decode-python-string.ts`'s own named exclusions:
 * - Raw string literals (`R"delim(...)delim"`) are skipped as opaque,
 *   never decoded — they're never eligible for wrapping (`isSafeToWrap`)
 *   the same way Python's raw strings aren't, and their backslashes carry
 *   no escape meaning at all.
 * - Encoding prefixes (`L`, `u8`, `u`, `U`, and their raw-string
 *   combinations `LR`, `u8R`, `uR`, `UR`) are recognized only to find the
 *   literal's opening quote; the decoded *value* doesn't model the actual
 *   `wchar_t`/`char16_t`/`char32_t` encoding difference a real compiler
 *   would apply, since none of this project's fixtures depend on that
 *   distinction.
 * - `\x` hex escapes take as many hex digits as follow, per the C++
 *   standard's own (notoriously unbounded) rule — not a fixed width the
 *   way `\u`/`\U` are.
 */

const ESCAPE_MAP: Record<string, string> = {
  '\\': '\\',
  "'": "'",
  '"': '"',
  '?': '?',
  a: '\x07',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
};

/** Decode one non-raw C++ string literal's *body* (quotes/prefix already stripped). */
export function decodeCppStringBody(body: string): string {
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
    if (next === 'x') {
      const hex = /^[0-9a-fA-F]+/.exec(body.slice(i + 2));
      if (hex) {
        result += String.fromCharCode(parseInt(hex[0], 16) & 0xffff);
        i += 2 + hex[0].length;
        continue;
      }
    }
    if (next === 'u' && /^[0-9a-fA-F]{4}/.test(body.slice(i + 2))) {
      result += String.fromCharCode(parseInt(body.slice(i + 2, i + 6), 16));
      i += 6;
      continue;
    }
    if (next === 'U' && /^[0-9a-fA-F]{8}/.test(body.slice(i + 2))) {
      result += String.fromCodePoint(parseInt(body.slice(i + 2, i + 10), 16));
      i += 10;
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1));
    if (octal) {
      result += String.fromCharCode(parseInt(octal[0], 8) & 0xff);
      i += 1 + octal[0].length;
      continue;
    }
    // Unrecognized escape: keep the backslash verbatim, same fallback as
    // the Python oracle.
    result += ch;
    i++;
  }
  return result;
}

const PREFIX_RE = /^(u8|[LuU])?(R)?$/;

/**
 * Find every double-quoted string literal token in `source` (never
 * single-quoted — those are C++ *character* literals, a different
 * construct with no wrapping relevance), respecting backslash escapes, and
 * concatenate their decoded values in order. Same whole-file scanning
 * strategy as `decode-python-string.ts`'s own
 * `extractConcatenatedStringValue`: every fixture pairs exactly one
 * wrappable string construct with no other string literal, so summing
 * every token found anywhere reconstructs that construct's value
 * regardless of how many parts the source splits it into.
 */
export function extractConcatenatedStringValue(source: string): string {
  let result = '';
  let i = 0;
  while (i < source.length) {
    if (source[i] !== '"') {
      i++;
      continue;
    }

    // Walk backward over an optional encoding/raw prefix immediately
    // preceding this quote (`L"`, `u8"`, `u8R"`, `LR"`, ...).
    let prefixStart = i;
    while (prefixStart > 0 && /[LuUR8]/.test(source[prefixStart - 1]!)) {
      prefixStart--;
    }
    const prefix = source.slice(prefixStart, i);
    const isRaw = PREFIX_RE.test(prefix) && prefix.includes('R');

    if (isRaw) {
      // R"delim(...)delim" — find the delimiter (text before the opening
      // paren) and the matching `)delim"` close; skip over it opaquely.
      const delimMatch = /^[^\s\\()]*\(/.exec(source.slice(i + 1));
      if (delimMatch) {
        const delim = delimMatch[0].slice(0, -1);
        const closer = `)${delim}"`;
        const closeIdx = source.indexOf(closer, i + 1 + delimMatch[0].length);
        i = closeIdx === -1 ? source.length : closeIdx + closer.length;
        continue;
      }
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
    result += decodeCppStringBody(body);
    i = j + 1;
  }
  return result;
}
