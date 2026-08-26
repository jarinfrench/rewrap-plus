import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findNearestPyproject, resolvePyprojectConfig } from './pyproject.js';

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'rewrap-plus-pyproject-'));
  return tempDir;
}

describe('findNearestPyproject', () => {
  it('finds a pyproject.toml in an ancestor directory', () => {
    const root = makeTempDir();
    writeFileSync(join(root, 'pyproject.toml'), '[tool.black]\n');
    const nested = join(root, 'src', 'pkg');
    mkdirSync(nested, { recursive: true });

    expect(findNearestPyproject(nested)).toBe(join(root, 'pyproject.toml'));
  });

  it('returns undefined when no pyproject.toml exists on the way up', () => {
    const root = makeTempDir();
    const nested = join(root, 'src');
    mkdirSync(nested, { recursive: true });

    expect(findNearestPyproject(nested)).toBeUndefined();
  });
});

describe('resolvePyprojectConfig', () => {
  it('reads [tool.rewrap-plus] fields, mapping kebab-case to camelCase', () => {
    const root = makeTempDir();
    writeFileSync(
      join(root, 'pyproject.toml'),
      [
        '[tool.rewrap-plus]',
        'column-limit = 79',
        'tab-size = 2',
        'wrap-comments = true',
        'wrap-strings = false',
        'string-policy = "all"',
        'doc-dialect = "numpy"',
        'preserve-indented-blocks = false',
        'balanced-wrapping = true',
        'respect-editor-config = false',
      ].join('\n'),
    );

    expect(resolvePyprojectConfig(join(root, 'target.py'))).toEqual({
      columnLimit: 79,
      tabSize: 2,
      wrapComments: true,
      wrapStrings: false,
      stringPolicy: 'all',
      docDialect: 'numpy',
      preserveIndentedBlocks: false,
      balancedWrapping: true,
      respectEditorConfig: false,
    });
  });

  it('returns an empty config when pyproject.toml has no [tool.rewrap-plus] table', () => {
    const root = makeTempDir();
    writeFileSync(join(root, 'pyproject.toml'), '[tool.black]\nline-length = 88\n');

    expect(resolvePyprojectConfig(join(root, 'target.py'))).toEqual({});
  });

  it('returns an empty config when no pyproject.toml exists', () => {
    const root = makeTempDir();
    expect(resolvePyprojectConfig(join(root, 'target.py'))).toEqual({});
  });

  it('omits a field whose TOML value has the wrong type or an unrecognized enum value', () => {
    const root = makeTempDir();
    writeFileSync(
      join(root, 'pyproject.toml'),
      ['[tool.rewrap-plus]', 'column-limit = "wide"', 'string-policy = "sometimes"'].join('\n'),
    );

    expect(resolvePyprojectConfig(join(root, 'target.py'))).toEqual({});
  });
});
