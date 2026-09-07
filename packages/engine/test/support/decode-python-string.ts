/**
 * Test-only reimplementation of enough of Python's own non-raw string
 * escape decoding to support an eval-equivalence check
 * (`../wrap/python-string-wrap-fixtures.test.ts`): for every positive
 * fixture, eval the string expression before and after and assert
 * equality -- the strongest possible guard against silent corruption.
 *
 * This is deliberately never shipped in engine runtime code -- production
 * `dissolveString`/`emitString` (`../../src/languages/python/`) never
 * decode an escape sequence at all, precisely because doing so risks the
 * exact corruption this test exists to catch (see `dissolve-string.ts`'s
 * own doc comment). Decoding only needs to exist here, as a test oracle
 * independent of the engine's own code, so the test can compare "what did
 * the source mean before" against "what does it mean after" without
 * trusting the same code path both times.
 *
 * Also deliberately not a full Python string parser: no attempt is made
 * at Emscripten-launching an actual Python interpreter (this project has
 * no Python runtime dependency anywhere, and this is the wrong place to
 * introduce one) -- a small, direct escape decoder is sufficient for every
 * escape form this phase's fixtures actually use. `\N{NAME}` (named
 * Unicode escapes) is the one form intentionally left undecoded -- real
 * Unicode name resolution needs a large data table this test has no
 * reason to carry -- and passes through literally; no fixture in this
 * phase uses one.
 */

const ESCAPE_MAP: Record<string, string> = {
  '\\': '\\',
  "'": "'",
  '"': '"',
  a: '\x07',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
};

/**
 * Decode one non-raw Python string literal's *body* (the text between its
 * quotes, prefix already stripped) into the real string value it denotes.
 */
export function decodePythonStringBody(body: string): string {
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
    if (next === '\n') {
      i += 2; // line continuation: contributes nothing
      continue;
    }
    if (next === 'x' && /^[0-9a-fA-F]{2}/.test(body.slice(i + 2))) {
      result += String.fromCharCode(parseInt(body.slice(i + 2, i + 4), 16));
      i += 4;
      continue;
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
    // Unrecognized escape (including `\N{...}`): Python keeps the
    // backslash in the resulting value verbatim.
    result += ch;
    i++;
  }
  return result;
}

/**
 * Find every single/double-quoted (never triple-quoted -- out of scope for
 * this phase, see `isSafeToWrap`) string literal token in `source`,
 * respecting backslash-escapes so an escaped quote never ends a token
 * early, decode each one's body, and concatenate the results in order.
 *
 * This is the test's whole extraction strategy for "the value this
 * fixture's wrappable region denotes," on both sides of a wrap: every
 * fixture's `.in`/`.out` pair contains exactly one wrappable string
 * construct and no other string literal, so summing every literal token
 * found anywhere in the text reconstructs that construct's value
 * regardless of how many parts/lines it's split into or what
 * concatenation operator joins them -- `"a" "b"` and `"a" + "b"` and a
 * single `"ab"` all reduce to the same sum here, which is exactly the
 * property under test.
 */
export function extractConcatenatedStringValue(source: string): string {
  let result = '';
  let i = 0;
  while (i < source.length) {
    const match = /^([A-Za-z]{0,3})('|")/.exec(source.slice(i));
    if (!match) {
      i++;
      continue;
    }
    const prefixLen = match[1]!.length;
    const quote = match[2]!;
    if (match[1]!.toLowerCase().includes('r')) {
      // Raw string: never eligible for wrapping (isSafeToWrap), and its
      // own backslashes aren't real escapes -- skip over it as opaque
      // rather than mis-scanning its body for escape sequences.
      let j = i + prefixLen + 1;
      while (j < source.length && source[j] !== quote) {
        j++;
      }
      i = j + 1;
      continue;
    }

    let j = i + prefixLen + 1;
    let body = '';
    while (j < source.length && source[j] !== quote) {
      if (source[j] === '\\' && j + 1 < source.length) {
        body += source[j]! + source[j + 1]!;
        j += 2;
      } else {
        body += source[j]!;
        j++;
      }
    }
    result += decodePythonStringBody(body);
    i = j + 1;
  }
  return result;
}
