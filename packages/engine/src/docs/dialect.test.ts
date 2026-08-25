import { describe, expect, it } from 'vitest';
import type { Block } from '../types/document.js';
import { DialectRegistry, reflowDocBlocks, segmentLines } from './dialect.js';
import type { DocDialect } from './dialect.js';

function fixedScoreDialect(id: DocDialect['id'], score: number): DocDialect {
  return {
    id,
    detect: () => score,
    segment: () => [],
    emit: () => [],
  };
}

describe('DialectRegistry', () => {
  it('resolves a registered dialect by id', () => {
    const registry = new DialectRegistry();
    const dialect = fixedScoreDialect('plain', 0.1);
    registry.register(dialect);
    expect(registry.resolve('plain')).toBe(dialect);
  });

  it('returns undefined for an unregistered dialect', () => {
    const registry = new DialectRegistry();
    expect(registry.resolve('google')).toBeUndefined();
  });

  describe('detectBest', () => {
    it('picks the candidate with the highest detect score', () => {
      const registry = new DialectRegistry();
      registry.register(fixedScoreDialect('plain', 0.05));
      registry.register(fixedScoreDialect('google', 0.9));
      registry.register(fixedScoreDialect('numpy', 0.3));
      expect(registry.detectBest('text', ['plain', 'google', 'numpy'])).toBe('google');
    });

    it('favors the first candidate in order when scores tie', () => {
      const registry = new DialectRegistry();
      registry.register(fixedScoreDialect('plain', 0.05));
      registry.register(fixedScoreDialect('google', 0.05));
      expect(registry.detectBest('text', ['google', 'plain'])).toBe('google');
      expect(registry.detectBest('text', ['plain', 'google'])).toBe('plain');
    });

    it('throws for an empty candidate list', () => {
      const registry = new DialectRegistry();
      expect(() => registry.detectBest('text', [])).toThrow(/non-empty/);
    });

    it('throws when a named candidate is not registered', () => {
      const registry = new DialectRegistry();
      registry.register(fixedScoreDialect('plain', 0.05));
      expect(() => registry.detectBest('text', ['plain', 'google'])).toThrow(
        /no dialect registered for 'google'/,
      );
    });
  });
});

describe('reflowDocBlocks', () => {
  it('reflows a paragraph and restores a listItem marker via decorateFirstLine', () => {
    const blocks: Block[] = [
      { type: 'paragraph', atoms: [{ text: 'hello', width: 5, breakBefore: false }] },
      {
        type: 'listItem',
        marker: '-',
        hangingIndent: 2,
        atoms: [{ text: 'one', width: 3, breakBefore: false }],
      },
    ];
    const lines = reflowDocBlocks(blocks, { availableWidth: 80, reflowOptions: {} });
    expect(lines).toEqual(['hello', '- one']);
  });
});

describe('segmentLines', () => {
  it('behaves like plain splitBlocks when there is no trailing blank line', () => {
    const blocks = segmentLines(['Summary.', '', 'More text.'], {});
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'blank', 'paragraph']);
  });

  it('preserves a genuine trailing blank line that splitBlocks alone would drop', () => {
    const blocks = segmentLines(['Summary.', ''], {});
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'blank']);
  });

  it('produces a single blank block for an all-blank line array', () => {
    const blocks = segmentLines([''], {});
    expect(blocks.map((b) => b.type)).toEqual(['blank']);
  });

  it('produces nothing for an empty line array', () => {
    expect(segmentLines([], {})).toEqual([]);
  });
});
