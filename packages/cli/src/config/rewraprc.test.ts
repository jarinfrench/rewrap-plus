import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findNearestRewraprc, resolveRewraprcConfig } from './rewraprc.js';

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'rewrap-plus-rewraprc-'));
  return tempDir;
}

describe('findNearestRewraprc', () => {
  it('finds a .rewraprc in an ancestor directory', () => {
    const root = makeTempDir();
    writeFileSync(join(root, '.rewraprc'), '{}');
    const nested = join(root, 'src', 'pkg');
    mkdirSync(nested, { recursive: true });

    expect(findNearestRewraprc(nested)).toBe(join(root, '.rewraprc'));
  });

  it('also finds a .rewraprc.json', () => {
    const root = makeTempDir();
    writeFileSync(join(root, '.rewraprc.json'), '{}');

    expect(findNearestRewraprc(root)).toBe(join(root, '.rewraprc.json'));
  });

  it('returns undefined when neither exists', () => {
    const root = makeTempDir();
    expect(findNearestRewraprc(root)).toBeUndefined();
  });
});

describe('resolveRewraprcConfig', () => {
  it('reads known camelCase fields', () => {
    const root = makeTempDir();
    writeFileSync(
      join(root, '.rewraprc'),
      JSON.stringify({
        columnLimit: 88,
        tabSize: 2,
        wrapComments: false,
        wrapStrings: true,
        stringPolicy: 'all',
        docDialect: 'google',
        preserveIndentedBlocks: false,
        balancedWrapping: true,
        respectEditorConfig: false,
      }),
    );

    const result = resolveRewraprcConfig(join(root, 'target.py'));
    expect(result.path).toBe(join(root, '.rewraprc'));
    expect(result.parseError).toBeUndefined();
    expect(result.config).toEqual({
      columnLimit: 88,
      tabSize: 2,
      wrapComments: false,
      wrapStrings: true,
      stringPolicy: 'all',
      docDialect: 'google',
      preserveIndentedBlocks: false,
      balancedWrapping: true,
      respectEditorConfig: false,
    });
  });

  it('ignores unknown top-level keys', () => {
    const root = makeTempDir();
    writeFileSync(join(root, '.rewraprc'), JSON.stringify({ columnLimit: 88, notAKnownKey: 'x' }));

    expect(resolveRewraprcConfig(join(root, 'target.py')).config).toEqual({ columnLimit: 88 });
  });

  it('omits a field with the wrong type instead of throwing', () => {
    const root = makeTempDir();
    writeFileSync(join(root, '.rewraprc'), JSON.stringify({ columnLimit: 'wide' }));

    expect(resolveRewraprcConfig(join(root, 'target.py')).config).toEqual({});
  });

  it('reports a parse error for malformed JSON instead of throwing', () => {
    const root = makeTempDir();
    writeFileSync(join(root, '.rewraprc'), '{ not valid json');

    const result = resolveRewraprcConfig(join(root, 'target.py'));
    expect(result.config).toEqual({});
    expect(result.path).toBe(join(root, '.rewraprc'));
    expect(result.parseError).toBeDefined();
  });

  it('returns an empty config when no .rewraprc exists', () => {
    const root = makeTempDir();
    const result = resolveRewraprcConfig(join(root, 'target.py'));
    expect(result.config).toEqual({});
    expect(result.path).toBeUndefined();
  });
});
