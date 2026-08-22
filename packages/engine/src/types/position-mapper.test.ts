import { describe, expect, it } from 'vitest';
import { PositionMapper } from './position-mapper.js';

/**
 * A UTF-8 byte-length helper duplicated here — rather than imported from
 * `./position-mapper.js`, which keeps its own copy private — so these
 * tests can compute *expected* byte offsets from Unicode source text
 * directly. Deliberately avoids Node's `Buffer`: this package has no
 * `@types/node` dependency, and the engine is meant to stay runtime-
 * agnostic (Node today; `web-tree-sitter` is WASM-based specifically to
 * keep a browser host possible later, per the roadmap).
 */
function utf8ByteLength(ch: string): number {
  const codePoint = ch.codePointAt(0)!;
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function utf8ByteLengthOf(text: string): number {
  let total = 0;
  for (const ch of text) total += utf8ByteLength(ch);
  return total;
}

describe('PositionMapper — ASCII basics', () => {
  it('maps byte offsets to positions on a single line', () => {
    const mapper = new PositionMapper('hello world');

    expect(mapper.byteOffsetToPosition(0)).toEqual({ line: 0, character: 0 });
    expect(mapper.byteOffsetToPosition(5)).toEqual({ line: 0, character: 5 });
    expect(mapper.byteOffsetToPosition(11)).toEqual({ line: 0, character: 11 });
  });

  it('maps positions to byte offsets on a single line', () => {
    const mapper = new PositionMapper('hello world');

    expect(mapper.positionToByteOffset({ line: 0, character: 0 })).toBe(0);
    expect(mapper.positionToByteOffset({ line: 0, character: 5 })).toBe(5);
    expect(mapper.positionToByteOffset({ line: 0, character: 11 })).toBe(11);
  });

  it('tracks row and column across multiple lines', () => {
    const mapper = new PositionMapper('abc\ndef\nghi');

    // 'abc\n' is 4 bytes, so byte 4 is the start of the second line.
    expect(mapper.byteOffsetToPosition(4)).toEqual({ line: 1, character: 0 });
    // byte 6 is 'f' on the second line (index 2 into "def").
    expect(mapper.byteOffsetToPosition(6)).toEqual({ line: 1, character: 2 });
    // byte 8 is the start of the third line.
    expect(mapper.byteOffsetToPosition(8)).toEqual({ line: 2, character: 0 });
  });

  it('treats a trailing newline as introducing a final empty line', () => {
    const mapper = new PositionMapper('abc\n');

    expect(mapper.byteOffsetToPosition(4)).toEqual({ line: 1, character: 0 });
  });

  it('handles a source with no trailing newline as a single line', () => {
    const mapper = new PositionMapper('abc');

    expect(mapper.byteOffsetToPosition(3)).toEqual({ line: 0, character: 3 });
  });

  it('handles an empty source', () => {
    const mapper = new PositionMapper('');

    expect(mapper.byteOffsetToPosition(0)).toEqual({ line: 0, character: 0 });
    expect(mapper.positionToByteOffset({ line: 0, character: 0 })).toBe(0);
  });

  it('handles consecutive blank lines', () => {
    const mapper = new PositionMapper('a\n\n\nb');

    expect(mapper.byteOffsetToPosition(2)).toEqual({ line: 1, character: 0 });
    expect(mapper.byteOffsetToPosition(3)).toEqual({ line: 2, character: 0 });
    expect(mapper.byteOffsetToPosition(4)).toEqual({ line: 3, character: 0 });
  });

  it('throws a RangeError for a row past the end of the document', () => {
    const mapper = new PositionMapper('one line');

    expect(() => mapper.positionToByteOffset({ line: 5, character: 0 })).toThrow(RangeError);
  });
});

describe('PositionMapper — smart quotes (3-byte UTF-8, single UTF-16 unit)', () => {
  // U+2018 ‘, U+2019 ’, U+201C “, U+201D ” are all in the general
  // punctuation block: 3 bytes in UTF-8, 1 code unit in UTF-16 — exactly
  // the kind of non-ASCII content the span.ts UTF-16/UTF-8 caveat calls
  // out as "extremely common" in real docstrings and comments.
  const text = '“Hello,” she said.';

  it('accounts for each smart quote as 3 bytes but 1 UTF-16 unit', () => {
    const mapper = new PositionMapper(text);

    // "“" (3 bytes) + "Hello," (6 bytes) + "”" (3 bytes) = byte 12,
    // but only 8 UTF-16 units (1 + 6 + 1) into the string.
    expect(mapper.byteOffsetToPosition(12)).toEqual({ line: 0, character: 8 });
  });

  it('round-trips every code-point boundary through both directions', () => {
    const mapper = new PositionMapper(text);
    let byteOffset = 0;

    for (const ch of text) {
      const position = mapper.byteOffsetToPosition(byteOffset);
      expect(mapper.positionToByteOffset(position)).toBe(byteOffset);
      byteOffset += utf8ByteLength(ch);
    }
    expect(mapper.byteOffsetToPosition(byteOffset)).toEqual({
      line: 0,
      character: [...text].reduce((n, ch) => n + ch.length, 0),
    });
  });
});

describe('PositionMapper — CJK (3-byte UTF-8, single UTF-16 unit)', () => {
  const text = '中文comment测试';

  it('accounts for CJK characters as 3 bytes but 1 UTF-16 unit each', () => {
    const mapper = new PositionMapper(text);

    // "中文" = 2 chars * 3 bytes = 6 bytes, but 2 UTF-16 units.
    expect(mapper.byteOffsetToPosition(6)).toEqual({ line: 0, character: 2 });
  });

  it('round-trips every code-point boundary through both directions', () => {
    const mapper = new PositionMapper(text);
    let byteOffset = 0;

    for (const ch of text) {
      const position = mapper.byteOffsetToPosition(byteOffset);
      expect(mapper.positionToByteOffset(position)).toBe(byteOffset);
      byteOffset += utf8ByteLength(ch);
    }
  });
});

describe('PositionMapper — emoji (4-byte UTF-8, surrogate-pair UTF-16)', () => {
  // U+1F600 😀 is an astral-plane code point: 4 bytes in UTF-8, but a
  // *surrogate pair* (2 code units) in UTF-16 — the case most likely to
  // break a naive byte<->character mapping.
  const text = 'note 😀 done';

  it('accounts for the emoji as 4 bytes and 2 UTF-16 units', () => {
    const mapper = new PositionMapper(text);

    // "note " = 5 bytes / 5 units. The emoji adds 4 bytes / 2 units.
    expect(mapper.byteOffsetToPosition(5)).toEqual({ line: 0, character: 5 });
    expect(mapper.byteOffsetToPosition(9)).toEqual({ line: 0, character: 7 });
  });

  it('positions after the emoji land past both surrogate halves', () => {
    const mapper = new PositionMapper(text);

    // byte 10 is 'd' of "done", right after the space that follows the emoji.
    expect(mapper.byteOffsetToPosition(10)).toEqual({ line: 0, character: 8 });
  });

  it('round-trips positionToByteOffset for the UTF-16 offset just past the surrogate pair', () => {
    const mapper = new PositionMapper(text);

    expect(mapper.positionToByteOffset({ line: 0, character: 7 })).toBe(9);
  });

  it('handles multiple astral characters and a multi-line document', () => {
    const mapper = new PositionMapper('a😀b\nc😀d');

    // Second line starts right after the first line's newline byte.
    // Line 0: 'a' (1) + 😀 (4) + 'b' (1) + '\n' (1) = 7 bytes.
    expect(mapper.byteOffsetToPosition(7)).toEqual({ line: 1, character: 0 });
  });
});

describe('PositionMapper — combining characters', () => {
  // A combining acute accent (U+0301) following a plain 'e' is two
  // separate code points — two for-of iteration steps — even though they
  // render as one visual grapheme ("é"). Byte/UTF-16 accounting operates
  // per code point, not per grapheme; grapheme-aware display width is a
  // Phase 5 concern (East Asian Wide/combining-mark width), not this one.
  const decomposed = 'cafe\u0301'; // "café" as e + combining acute
  const precomposed = 'caf\u00e9'; // "café" as a single precomposed é

  it('counts a combining mark as its own code point (2 bytes, 1 UTF-16 unit)', () => {
    const mapper = new PositionMapper(decomposed);

    // 'c','a','f','e' = 4 bytes / 4 units. U+0301 adds 2 bytes / 1 unit.
    expect(mapper.byteOffsetToPosition(4)).toEqual({ line: 0, character: 4 });
    expect(mapper.byteOffsetToPosition(6)).toEqual({ line: 0, character: 5 });
  });

  it('gives the decomposed and precomposed forms different byte lengths', () => {
    const decomposedMapper = new PositionMapper(decomposed);
    const precomposedMapper = new PositionMapper(precomposed);

    // Decomposed: c,a,f (3) + e (1) + combining acute (2) = 6 bytes.
    expect(decomposedMapper.byteOffsetToPosition(6)).toEqual({ line: 0, character: 5 });
    // Precomposed: c,a,f (3) + é (2, U+00E9 is <= 0x7FF) = 5 bytes.
    expect(precomposedMapper.byteOffsetToPosition(5)).toEqual({ line: 0, character: 4 });
  });

  it('round-trips every code-point boundary for the decomposed form', () => {
    const mapper = new PositionMapper(decomposed);
    let byteOffset = 0;

    for (const ch of decomposed) {
      const position = mapper.byteOffsetToPosition(byteOffset);
      expect(mapper.positionToByteOffset(position)).toBe(byteOffset);
      byteOffset += utf8ByteLength(ch);
    }
  });
});

describe('PositionMapper#spanFromByteRange', () => {
  it('builds a SourceSpan with UTF-16 row/column filled in from byte offsets', () => {
    const mapper = new PositionMapper('def greet():\n    return "café 😀"\n');

    // The string literal starts right after 'return "' on line 1.
    const startByte = utf8ByteLengthOf('def greet():\n    return "');
    const endByte = startByte + utf8ByteLengthOf('café 😀');

    const span = mapper.spanFromByteRange(startByte, endByte);

    expect(span.startByte).toBe(startByte);
    expect(span.endByte).toBe(endByte);
    expect(span.startRow).toBe(1);
    expect(span.endRow).toBe(1);
    // 'café 😀' is c,a,f,é,' ' (5 units) + 😀 (2 units) = 7 UTF-16 units.
    expect(span.endColumn - span.startColumn).toBe(7);
  });
});
