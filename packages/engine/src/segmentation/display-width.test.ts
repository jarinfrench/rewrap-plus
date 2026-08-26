import { describe, expect, it } from 'vitest';
import { displayWidth } from './display-width.js';

describe('displayWidth', () => {
  it('counts plain ASCII as one column per character', () => {
    expect(displayWidth('hello world')).toBe(11);
    expect(displayWidth('')).toBe(0);
  });

  it('counts CJK ideographs as two columns each', () => {
    expect(displayWidth('日本語')).toBe(6);
  });

  it('counts Hangul syllables as two columns each', () => {
    expect(displayWidth('한글')).toBe(4);
  });

  it('counts Hiragana and Katakana as two columns each', () => {
    expect(displayWidth('ひらがな')).toBe(8);
    expect(displayWidth('カタカナ')).toBe(8);
  });

  it('counts fullwidth forms as two columns each', () => {
    expect(displayWidth('\uFF21\uFF22\uFF23')).toBe(6); // fullwidth "ABC"
  });

  it('counts a combining mark as zero width', () => {
    // "e" + combining acute accent (U+0301) — visually one character,
    // two code points.
    const eWithCombiningAcute = 'e\u0301';
    expect(displayWidth(eWithCombiningAcute)).toBe(1);
  });

  it('counts a run of combining marks as zero width', () => {
    const base = 'a';
    const combiners = '\u0300\u0301\u0302';
    expect(displayWidth(base + combiners)).toBe(1);
  });

  it('counts an astral-plane emoji (surrogate pair) as two columns, not four', () => {
    // U+1F600 GRINNING FACE — a UTF-16 surrogate pair. Iterating by code
    // point (not code unit) is what keeps this from double-counting.
    const grinningFace = '\u{1F600}';
    expect(grinningFace).toHaveLength(2); // sanity check: it IS a surrogate pair
    expect(displayWidth(grinningFace)).toBe(2);
  });

  it('counts a string mixing ASCII and emoji correctly', () => {
    expect(displayWidth('hi \u{1F600}!')).toBe(3 + 2 + 1); // "hi " + emoji + "!"
  });

  it('counts smart quotes and em-dashes as one column, not two', () => {
    // These are exactly the non-ASCII characters flagged as
    // "extremely common" in docstrings — and they are emphatically
    // narrow, unlike CJK punctuation.
    expect(displayWidth('\u2018quoted\u2019')).toBe(8);
    expect(displayWidth('em\u2014dash')).toBe(7);
  });

  it('counts a variation selector as zero width', () => {
    // Text-presentation variation selector, e.g. after a symbol like ☺.
    expect(displayWidth('\u263A\uFE0E')).toBe(1);
  });

  it('handles a fixture-scale mixed CJK/ASCII/emoji string', () => {
    const text = 'Hello 世界 \u{1F600} done';
    // "Hello " (6) + "世界" (4) + " " (1) + emoji (2) + " done" (5)
    expect(displayWidth(text)).toBe(6 + 4 + 1 + 2 + 5);
  });
});
