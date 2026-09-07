import { describe, expect, it } from 'vitest';
import type { LanguageDescriptor } from '../types/adapter.js';
import type { WrapConfig } from '../types/config.js';
import type { WrappableRegion } from '../types/region.js';
import { wrapDocComment } from './wrap-doc-comment.js';

const JSDOC_DESCRIPTOR: LanguageDescriptor = {
  id: 'test-lang',
  grammarWasm: 'unused.wasm',
  queries: { comments: '(comment) @comment', strings: '(string) @string' },
  comments: {
    block: { open: '/**', close: '*/', continuationPrefix: '*', alignContinuation: 'open' },
    doc: { markers: ['/**'], dialects: ['jsdoc', 'plain'] },
    neverReflow: [],
  },
  strings: {
    quotes: [{ delimiter: '"', multiline: false, escapes: true }],
    prefixes: [],
    rawForms: [],
    escapes: { sequences: [] },
    placeholders: [],
    concatenation: { style: 'operator', operator: '+' },
  },
};

function regionForWholeSource(source: string, indentColumn = 0): WrappableRegion {
  const lines = source.split('\n');
  const endRow = lines.length - 1;
  const endColumn = lines[endRow]!.length;
  const span = { startByte: 0, endByte: 0, startRow: 0, startColumn: 0, endRow, endColumn };
  return {
    kind: 'docComment',
    span,
    parts: [span],
    rawText: source,
    indentColumn,
    languageId: 'test-lang',
  };
}

function config(overrides: Partial<WrapConfig> = {}): WrapConfig {
  return {
    columnLimit: 40,
    tabSize: 4,
    wrapComments: true,
    wrapStrings: false,
    stringPolicy: 'off',
    docDialect: 'auto',
    preserveIndentedBlocks: false,
    balancedWrapping: false,
    ...overrides,
  };
}

describe('wrapDocComment', () => {
  it('auto-detects jsdoc and keeps @param/@returns as separate field entries', () => {
    const source = ['/**', ' * Greets somebody.', ' *', ' * @param name The name.', ' * @returns A greeting.', ' */'].join('\n');
    const result = wrapDocComment(regionForWholeSource(source), source, JSDOC_DESCRIPTOR, config());
    expect(result).toContain('@param name The name.');
    expect(result).toContain('@returns A greeting.');
  });

  it('reflows a long @param description across continuation lines under the jsdoc dialect', () => {
    const source = [
      '/**',
      ' * @param name A parameter description long enough that it must wrap across more than one line.',
      ' */',
    ].join('\n');
    const result = wrapDocComment(regionForWholeSource(source), source, JSDOC_DESCRIPTOR, config());
    const lines = result.split('\n');
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
    expect(lines.filter((l) => l.trim().startsWith('* ')).length).toBeGreaterThan(1);
  });

  it('falls back to plain prose reflow when no @tag is present', () => {
    const source = [
      '/**',
      ' * Just a narrative comment with no tags at all that is long enough to need wrapping.',
      ' */',
    ].join('\n');
    const result = wrapDocComment(regionForWholeSource(source), source, JSDOC_DESCRIPTOR, config());
    expect(result).not.toMatch(/@/);
    for (const line of result.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });

  it('forces a named dialect via cfg.docDialect, ignoring detection', () => {
    const source = ['/**', ' * @param name The name.', ' */'].join('\n');
    const result = wrapDocComment(
      regionForWholeSource(source),
      source,
      JSDOC_DESCRIPTOR,
      config({ docDialect: 'plain' }),
    );
    // Under 'plain', "@param name The name." is just prose -- no fieldEntry
    // hanging-indent treatment, so it stays as one paragraph line.
    expect(result).toContain('* @param name The name.');
  });

  it('is idempotent: wrapping the wrapped output produces no further change', () => {
    const source = [
      '/**',
      ' * @param name A parameter description long enough that it must wrap across more than one line.',
      ' */',
    ].join('\n');
    const first = wrapDocComment(regionForWholeSource(source), source, JSDOC_DESCRIPTOR, config());
    const second = wrapDocComment(regionForWholeSource(first), first, JSDOC_DESCRIPTOR, config());
    expect(second).toBe(first);
  });
});
