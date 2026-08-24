/**
 * Display width in terminal/editor columns, not character count.
 *
 * Phase 5 ("add display width calculation for wide and combining
 * characters"): East Asian Wide and Fullwidth characters count as 2
 * columns; combining marks count as 0. This matters for two of this
 * project's routine cases — CJK text in comments/docstrings, and emoji
 * (themselves largely East Asian Wide-adjacent ranges) in docstrings —
 * where `text.length` (the Phase 1-4 stand-in) silently over- or
 * under-counts, letting reflow either wrap too early or run a line past
 * the actual column limit.
 *
 * Deliberately dependency-free: the engine's only runtime dependency is
 * `web-tree-sitter` (see `package.json` and the project's "keep the
 * engine minimal" convention), so this hand-rolls a condensed range
 * table rather than pulling in an East-Asian-width package. The ranges
 * below are drawn from Unicode's `EastAsianWidth.txt` (`W`/`F`
 * categories) and the `Mn`/`Me` general-category combining-mark blocks,
 * condensed to the ranges this project is realistically going to see in
 * source comments and docstrings — not a byte-for-byte transcription of
 * either table.
 *
 * Iterates by Unicode code point, not UTF-16 code unit — `for...of` over
 * a string already does this, correctly stepping over surrogate pairs
 * (astral-plane emoji included) as one character rather than two.
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += codePointWidth(ch.codePointAt(0)!);
  }
  return width;
}

function codePointWidth(codePoint: number): number {
  if (isZeroWidth(codePoint)) {
    return 0;
  }
  if (isWide(codePoint)) {
    return 2;
  }
  return 1;
}

function inRanges(codePoint: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  // Linear scan: these tables are short (a few dozen entries) and this
  // runs per-character on comment/docstring-sized text, not source
  // files — a binary search would be premature optimization here.
  for (const [start, end] of ranges) {
    if (codePoint >= start && codePoint <= end) {
      return true;
    }
  }
  return false;
}

/**
 * Combining marks (Unicode general categories Mn "Mark, nonspacing" and
 * Me "Mark, enclosing") and other zero-width formatting characters
 * (variation selectors, zero-width joiner/non-joiner). These attach to
 * the preceding character without advancing the visual column.
 */
const ZERO_WIDTH_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0300, 0x036f], // Combining Diacritical Marks
  [0x0483, 0x0489], // Cyrillic combining marks
  [0x0591, 0x05bd], // Hebrew points
  [0x05bf, 0x05bf],
  [0x05c1, 0x05c2],
  [0x05c4, 0x05c5],
  [0x05c7, 0x05c7],
  [0x0610, 0x061a], // Arabic marks
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06dc],
  [0x06df, 0x06e4],
  [0x06e7, 0x06e8],
  [0x06ea, 0x06ed],
  [0x0e31, 0x0e31], // Thai
  [0x0e34, 0x0e3a],
  [0x0e47, 0x0e4e],
  [0x1ab0, 0x1aff], // Combining Diacritical Marks Extended
  [0x1dc0, 0x1dff], // Combining Diacritical Marks Supplement
  [0x200b, 0x200d], // zero-width space/non-joiner/joiner
  [0x20d0, 0x20ff], // Combining Diacritical Marks for Symbols
  [0xfe00, 0xfe0f], // variation selectors
  [0xfe20, 0xfe2f], // Combining Half Marks
  [0xfeff, 0xfeff], // zero-width no-break space (BOM)
];

/**
 * East Asian Wide (`W`) and Fullwidth (`F`) ranges, condensed from
 * `EastAsianWidth.txt`: CJK Unified Ideographs and their extensions,
 * Hiragana/Katakana, Hangul (Jamo and syllables), fullwidth ASCII
 * variants and CJK punctuation, and the common pictographic/emoji
 * blocks (themselves East Asian Wide in the modern annex).
 */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2329, 0x232a], // angle brackets
  [0x2e80, 0x2fdf], // CJK Radicals Supplement, Kangxi Radicals
  [0x2ff0, 0x303e], // Ideographic Description Chars, CJK Symbols and Punctuation
  [0x3041, 0x33ff], // Hiragana .. CJK Compatibility
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi Syllables and Radicals
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe30, 0xfe4f], // CJK Compatibility Forms
  [0xfe54, 0xfe66], // Small Form Variants (punctuation)
  [0xfe68, 0xfe6b],
  [0xff01, 0xff60], // Fullwidth ASCII variants and punctuation
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x16fe0, 0x16fff], // Ideographic Symbols and Punctuation, Tangut-adjacent
  [0x17000, 0x18d08], // Tangut, Nushu
  [0x1aff0, 0x1b16f], // Kana Extended/Supplement
  [0x1f200, 0x1f2ff], // Enclosed Ideographic Supplement
  [0x1f300, 0x1f64f], // Misc Symbols and Pictographs, Emoticons
  [0x1f680, 0x1f6ff], // Transport and Map Symbols
  [0x1f900, 0x1f9ff], // Supplemental Symbols and Pictographs
  [0x1fa70, 0x1faff], // Symbols and Pictographs Extended-A
  [0x20000, 0x2fffd], // CJK Unified Ideographs Extension B and beyond
  [0x30000, 0x3fffd],
];

function isZeroWidth(codePoint: number): boolean {
  return inRanges(codePoint, ZERO_WIDTH_RANGES);
}

function isWide(codePoint: number): boolean {
  return inRanges(codePoint, WIDE_RANGES);
}
