import { describe, expect, it } from 'vitest';
import { plainDialect } from './plain.js';

describe('plainDialect', () => {
  it('detect returns a small constant baseline, never 0', () => {
    expect(plainDialect.detect('anything at all')).toBeGreaterThan(0);
    expect(plainDialect.detect('anything at all')).toBeLessThan(0.5);
  });

  it('segment is a direct splitBlocks pass-through', () => {
    const blocks = plainDialect.segment('Summary.\n\nMore text.', {});
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'blank', 'paragraph']);
  });

  it('emit reflows via the shared reflowDocBlocks helper', () => {
    const blocks = plainDialect.segment('hello world', {});
    const lines = plainDialect.emit(blocks, { availableWidth: 80, reflowOptions: {} });
    expect(lines).toEqual(['hello world']);
  });
});
