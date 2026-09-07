import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverFiles } from './file-discovery.js';
import { makeTempDirHelper } from './test-helpers/make-temp-dir.js';

const makeTempDir = makeTempDirHelper('rewrap-plus-discovery-');

describe('discoverFiles', () => {
  it('detects the language of an explicit file argument', () => {
    const root = makeTempDir();
    const file = join(root, 'a.py');
    writeFileSync(file, '# hi\n');

    const result = discoverFiles([file]);
    expect(result.files).toEqual([{ path: resolve(file), languageId: 'python' }]);
    expect(result.unrecognized).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it('reports an explicit file with an unrecognized extension, without --language', () => {
    const root = makeTempDir();
    const file = join(root, 'notes.txt');
    writeFileSync(file, '# hi\n');

    const result = discoverFiles([file]);
    expect(result.files).toEqual([]);
    expect(result.unrecognized).toEqual([file]);
  });

  it('lets --language force an explicit file with an unknown extension', () => {
    const root = makeTempDir();
    const file = join(root, 'script');
    writeFileSync(file, '# hi\n');

    const result = discoverFiles([file], { languageOverride: 'python' });
    expect(result.files).toEqual([{ path: resolve(file), languageId: 'python' }]);
    expect(result.unrecognized).toEqual([]);
  });

  it('reports a missing path', () => {
    const root = makeTempDir();
    const result = discoverFiles([join(root, 'does-not-exist.py')]);
    expect(result.missing).toEqual([join(root, 'does-not-exist.py')]);
  });

  it('recursively walks a directory, only collecting recognized extensions', () => {
    const root = makeTempDir();
    mkdirSync(join(root, 'src', 'nested'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.py'), '');
    writeFileSync(join(root, 'src', 'nested', 'b.ts'), '');
    // .txt has no adapter at all -- genuinely unrecognized, unlike .md
    // (recognized since Markdown support landed).
    writeFileSync(join(root, 'notes.txt'), '');

    const result = discoverFiles([root]);
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual([resolve(join(root, 'src', 'a.py')), resolve(join(root, 'src', 'nested', 'b.ts'))].sort());
    expect(result.unrecognized).toEqual([]);
  });

  it('skips node_modules, dot-directories, dist, out, and coverage during a directory walk', () => {
    const root = makeTempDir();
    for (const dir of ['node_modules', '.git', 'dist', 'out', 'coverage', '.hidden']) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, 'skip.py'), '');
    }
    writeFileSync(join(root, 'keep.py'), '');

    const result = discoverFiles([root]);
    expect(result.files.map((f) => f.path)).toEqual([resolve(join(root, 'keep.py'))]);
  });

  it('ignores --language for files discovered via a directory walk', () => {
    const root = makeTempDir();
    writeFileSync(join(root, 'notes.txt'), '');
    writeFileSync(join(root, 'a.py'), '');

    const result = discoverFiles([root], { languageOverride: 'python' });
    expect(result.files.map((f) => f.path)).toEqual([resolve(join(root, 'a.py'))]);
  });
});
