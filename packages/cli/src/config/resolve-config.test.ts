import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfigForFile } from './resolve-config.js';

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'rewrap-plus-resolve-config-'));
  return tempDir;
}

describe('resolveConfigForFile', () => {
  it('falls all the way through to built-in defaults with no config files and no flags', () => {
    const root = makeTempDir();
    const result = resolveConfigForFile(join(root, 'target.py'), {});

    expect(result.columnLimit).toEqual({ value: 80, source: 'default' });
    expect(result.wrapConfig).toEqual({
      columnLimit: 80,
      tabSize: 4,
      wrapComments: true,
      wrapStrings: true,
      stringPolicy: 'prose',
      docDialect: 'auto',
      preserveIndentedBlocks: true,
      balancedWrapping: false,
    });
    expect(result.rewraprcPath).toBeUndefined();
  });

  it('lets pyproject.toml override the default column limit', () => {
    const root = makeTempDir();
    writeFileSync(join(root, 'pyproject.toml'), '[tool.rewrap-plus]\ncolumn-limit = 79\n');

    const result = resolveConfigForFile(join(root, 'target.py'), {});
    expect(result.columnLimit).toEqual({ value: 79, source: 'pyproject.toml' });
  });

  it('lets .rewraprc override pyproject.toml', () => {
    const root = makeTempDir();
    writeFileSync(join(root, 'pyproject.toml'), '[tool.rewrap-plus]\ncolumn-limit = 79\n');
    writeFileSync(join(root, '.rewraprc'), JSON.stringify({ columnLimit: 88 }));

    const result = resolveConfigForFile(join(root, 'target.py'), {});
    expect(result.columnLimit).toEqual({ value: 88, source: '.rewraprc' });
  });

  it('lets a flag override every file-based source', () => {
    const root = makeTempDir();
    writeFileSync(join(root, 'pyproject.toml'), '[tool.rewrap-plus]\ncolumn-limit = 79\n');
    writeFileSync(join(root, '.rewraprc'), JSON.stringify({ columnLimit: 88 }));

    const result = resolveConfigForFile(join(root, 'target.py'), { columnLimit: 120 });
    expect(result.columnLimit).toEqual({ value: 120, source: 'flag' });
  });

  it('consults .editorconfig only between pyproject.toml and the default', () => {
    const root = makeTempDir();
    writeFileSync(join(root, '.editorconfig'), 'root = true\n\n[*]\nmax_line_length = 100\n');

    const withoutOverride = resolveConfigForFile(join(root, 'target.py'), {});
    expect(withoutOverride.columnLimit).toEqual({ value: 100, source: '.editorconfig' });

    writeFileSync(join(root, 'pyproject.toml'), '[tool.rewrap-plus]\ncolumn-limit = 79\n');
    const withPyproject = resolveConfigForFile(join(root, 'target.py'), {});
    expect(withPyproject.columnLimit).toEqual({ value: 79, source: 'pyproject.toml' });
  });

  it('skips the .editorconfig tier when respectEditorConfig resolves to false', () => {
    const root = makeTempDir();
    writeFileSync(join(root, '.editorconfig'), 'root = true\n\n[*]\nmax_line_length = 100\n');
    writeFileSync(join(root, '.rewraprc'), JSON.stringify({ respectEditorConfig: false }));

    const result = resolveConfigForFile(join(root, 'target.py'), {});
    expect(result.columnLimit).toEqual({ value: 80, source: 'default' });
  });

  it('merges non-columnLimit fields through the same flag > rewraprc > pyproject > default chain', () => {
    const root = makeTempDir();
    writeFileSync(join(root, 'pyproject.toml'), '[tool.rewrap-plus]\nstring-policy = "all"\ntab-size = 2\n');
    writeFileSync(join(root, '.rewraprc'), JSON.stringify({ stringPolicy: 'off' }));

    const result = resolveConfigForFile(join(root, 'target.py'), { wrapComments: false });
    expect(result.wrapConfig.stringPolicy).toBe('off'); // .rewraprc beats pyproject.toml
    expect(result.wrapConfig.tabSize).toBe(2); // pyproject.toml beats the default (no rewraprc/flag opinion)
    expect(result.wrapConfig.wrapComments).toBe(false); // flag beats everything
  });

  it('surfaces a .rewraprc parse error without throwing', () => {
    const root = makeTempDir();
    writeFileSync(join(root, '.rewraprc'), '{ not valid json');

    const result = resolveConfigForFile(join(root, 'target.py'), {});
    expect(result.rewraprcParseError).toBeDefined();
    expect(result.wrapConfig.columnLimit).toBe(80); // falls back cleanly rather than blowing up
  });
});
