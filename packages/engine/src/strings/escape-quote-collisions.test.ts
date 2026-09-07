import { describe, expect, it } from 'vitest';
import { escapeQuoteCollisions } from './escape-quote-collisions.js';

describe('escapeQuoteCollisions', () => {
  it('escapes a bare occurrence of the target quote character', () => {
    expect(escapeQuoteCollisions(`she said "hi" to me`, '"')).toBe(`she said \\"hi\\" to me`);
  });

  it('leaves text with no colliding quote character untouched', () => {
    expect(escapeQuoteCollisions(`it's fine`, '"')).toBe(`it's fine`);
  });

  it('never touches a quote character inside an already-escaped sequence', () => {
    // `\'` is already a safe, atomic escape regardless of delimiter --
    // must not become `\\'`.
    expect(escapeQuoteCollisions(`it\\'s fine`, "'")).toBe(`it\\'s fine`);
    expect(escapeQuoteCollisions(`she said \\"hi\\"`, '"')).toBe(`she said \\"hi\\"`);
  });

  it('never touches a quote character inside a brace placeholder/interpolation', () => {
    // Only the interpolation's own `'` characters are exempt -- the same
    // characters written as bare text outside `{}` are real string
    // content and must still be escaped.
    expect(escapeQuoteCollisions(`value is {d['key']}`, "'")).toBe(`value is {d['key']}`);
  });

  it('never touches a quote character inside a URL or inline code span', () => {
    expect(escapeQuoteCollisions(`see https://example.com/it's-fine`, "'")).toBe(
      `see https://example.com/it's-fine`,
    );
    expect(escapeQuoteCollisions('run `echo \'hi\'`', "'")).toBe("run `echo 'hi'`");
  });

  it('escapes every bare occurrence, not just the first', () => {
    expect(escapeQuoteCollisions(`"a" and "b" and "c"`, '"')).toBe(
      `\\"a\\" and \\"b\\" and \\"c\\"`,
    );
  });

  it('is a no-op on empty text', () => {
    expect(escapeQuoteCollisions('', '"')).toBe('');
  });
});
