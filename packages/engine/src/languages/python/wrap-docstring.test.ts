import { describe, expect, it } from 'vitest';
import type { WrapConfig } from '../../types/config.js';
import type { WrappableRegion } from '../../types/region.js';
import { wrapDocstring } from './wrap-docstring.js';

function regionForWholeSource(source: string, indentColumn = 0): WrappableRegion {
  const lines = source.split('\n');
  const endRow = lines.length - 1;
  const endColumn = lines[endRow]!.length;
  const span = { startByte: 0, endByte: 0, startRow: 0, startColumn: 0, endRow, endColumn };
  return {
    kind: 'docstring',
    span,
    parts: [span],
    rawText: source,
    indentColumn,
    languageId: 'python',
  };
}

function config(overrides: Partial<WrapConfig> = {}): WrapConfig {
  return {
    columnLimit: 40,
    tabSize: 4,
    wrapComments: true,
    wrapStrings: false,
    stringPolicy: 'off',
    docDialect: 'plain',
    preserveIndentedBlocks: false,
    balancedWrapping: false,
    ...overrides,
  };
}

describe('wrapDocstring', () => {
  it('leaves an already-short, correctly formatted docstring byte-identical', () => {
    const source = '"""A short summary."""';
    const result = wrapDocstring(regionForWholeSource(source), source, config());
    expect(result).toBe(source);
  });

  it('wraps long content within the column limit under the plain dialect', () => {
    const source = '"""A summary that is far too long to fit inside a forty column limit."""';
    const result = wrapDocstring(regionForWholeSource(source), source, config());
    for (const line of result.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });

  it('honors an explicitly forced dialect over auto-detection', () => {
    const source = ['"""Summary.', '', 'Args:', '    x: description of x."""'].join('\n');
    const forcedPlain = wrapDocstring(
      regionForWholeSource(source),
      source,
      config({ docDialect: 'plain', columnLimit: 80 }),
    );
    const forcedGoogle = wrapDocstring(
      regionForWholeSource(source),
      source,
      config({ docDialect: 'google', columnLimit: 80 }),
    );
    // Under 'plain', "Args:" and its entry merge into one ordinary
    // paragraph (no section/field structure recognized at all); under
    // 'google', "Args:" stays on its own line as a section header and
    // "x:" is recognized as a field-entry label — a real, observable
    // difference in output shape driven purely by which dialect was
    // forced.
    expect(forcedPlain).toContain('Args: x: description of x.');
    expect(forcedGoogle).toMatch(/Args:\n\s*x: description of x\./);
  });

  it('auto-detects the google dialect from Args:/Returns:-shaped content', () => {
    const source = ['"""Summary.', '', 'Args:', '    x: description of x."""'].join('\n');
    const result = wrapDocstring(
      regionForWholeSource(source),
      source,
      config({ docDialect: 'auto', columnLimit: 80 }),
    );
    // Matches the forced-'google' shape above, confirming auto-detection
    // actually picked 'google' rather than falling back to 'plain'.
    expect(result).toMatch(/Args:\n\s*x: description of x\./);
  });

  it('is idempotent: wrapping the wrapped output produces byte-identical text', async () => {
    const source = '"""A summary that is far too long to fit inside a forty column limit."""';
    const cfg = config();
    const first = wrapDocstring(regionForWholeSource(source), source, cfg);
    const second = wrapDocstring(regionForWholeSource(first), first, cfg);
    expect(second).toBe(first);
  });
});
