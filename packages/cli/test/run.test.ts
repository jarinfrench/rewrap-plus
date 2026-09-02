/**
 * End-to-end tests for `run()` against the real engine and real
 * (temp-directory) files — the fixture-driven, directory-walking shape
 * `CLAUDE.md` calls for on anything end-to-end, adapted to a CLI: no
 * subprocess spawn (slow, and `dist/cli.js` may not be built when this
 * suite runs), just `run()` called directly with a fake `argv` and
 * captured stdout/stderr, exactly like `./src/cli.ts`'s real entry point
 * does with the real ones.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { run, type RunIo } from '../src/run.js';

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'rewrap-plus-cli-run-'));
  return tempDir;
}

function captureIo(): RunIo & { readonly stdoutLines: string[]; readonly stderrLines: string[] } {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  return {
    stdoutLines,
    stderrLines,
    stdout: (line) => stdoutLines.push(line),
    stderr: (line) => stderrLines.push(line),
  };
}

const OVERLONG_COMMENT =
  '# ' + 'this comment is deliberately long enough to overflow the eighty column default '.repeat(2);

describe('run — write mode (default)', () => {
  it('rewraps an over-limit comment in place and exits 0', async () => {
    const root = makeTempDir();
    const file = join(root, 'a.py');
    const original = `${OVERLONG_COMMENT}\ndef f():\n    pass\n`;
    writeFileSync(file, original);

    const io = captureIo();
    const exitCode = await run([file], io);

    expect(exitCode).toBe(0);
    const rewritten = readFileSync(file, 'utf8');
    expect(rewritten).not.toBe(original);
    for (const line of rewritten.split('\n')) {
      if (line.length > 0) {
        expect(line.length).toBeLessThanOrEqual(80);
      }
    }
    expect(io.stdoutLines.some((line) => line.startsWith('rewrapped'))).toBe(true);
  });

  it('leaves an already-wrapped file untouched and reports nothing changed', async () => {
    const root = makeTempDir();
    const file = join(root, 'a.py');
    const original = '# short comment\ndef f():\n    pass\n';
    writeFileSync(file, original);

    const io = captureIo();
    const exitCode = await run([file], io);

    expect(exitCode).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(original);
    expect(io.stdoutLines.some((line) => line.startsWith('rewrapped'))).toBe(false);
  });

  it('respects --column-limit', async () => {
    const root = makeTempDir();
    const file = join(root, 'a.py');
    writeFileSync(file, '# short but not this short\n');

    const io = captureIo();
    const exitCode = await run(['--column-limit', '10', file], io);

    expect(exitCode).toBe(0);
    const rewritten = readFileSync(file, 'utf8');
    expect(rewritten).not.toBe('# short but not this short\n');
  });
});

describe('run — check mode (--check)', () => {
  it('does not write, reports what would change, and exits 1', async () => {
    const root = makeTempDir();
    const file = join(root, 'a.py');
    const original = `${OVERLONG_COMMENT}\n`;
    writeFileSync(file, original);

    const io = captureIo();
    const exitCode = await run(['--check', file], io);

    expect(exitCode).toBe(1);
    expect(readFileSync(file, 'utf8')).toBe(original); // untouched
    expect(io.stdoutLines.some((line) => line.startsWith('would rewrap'))).toBe(true);
  });

  it('exits 0 when nothing needs to change', async () => {
    const root = makeTempDir();
    const file = join(root, 'a.py');
    writeFileSync(file, '# short\n');

    const exitCode = await run(['--check', file], captureIo());
    expect(exitCode).toBe(0);
  });
});

describe('run — directory discovery', () => {
  it('wraps every recognized file under a directory argument', async () => {
    const root = makeTempDir();
    writeFileSync(join(root, 'a.py'), `${OVERLONG_COMMENT}\n`);
    // .txt has no adapter at all — genuinely unrecognized, unlike .md
    // (recognized since Markdown support landed) which would merely
    // happen not to need wrapping for this particular one-line content.
    writeFileSync(join(root, 'notes.txt'), 'not touched, unrecognized extension\n');

    const io = captureIo();
    const exitCode = await run([root], io);

    expect(exitCode).toBe(0);
    expect(readFileSync(join(root, 'a.py'), 'utf8')).not.toBe(`${OVERLONG_COMMENT}\n`);
    expect(readFileSync(join(root, 'notes.txt'), 'utf8')).toBe(
      'not touched, unrecognized extension\n',
    );
  });

  it('reports "No files matched." for a directory with nothing recognized', async () => {
    const root = makeTempDir();
    writeFileSync(join(root, 'notes.txt'), 'hi\n');

    const io = captureIo();
    const exitCode = await run([root], io);

    expect(exitCode).toBe(0);
    expect(io.stdoutLines).toContain('No files matched.');
  });
});

describe('run — error handling', () => {
  it('exits 2 for a missing path', async () => {
    const root = makeTempDir();
    const io = captureIo();
    const exitCode = await run([join(root, 'does-not-exist.py')], io);

    expect(exitCode).toBe(2);
    expect(io.stderrLines.some((line) => line.includes('no such file or directory'))).toBe(true);
  });

  it('exits 2 for an explicit file with an unrecognized extension and no --language', async () => {
    const root = makeTempDir();
    const file = join(root, 'notes.txt');
    writeFileSync(file, 'hi\n');

    const io = captureIo();
    const exitCode = await run([file], io);

    expect(exitCode).toBe(2);
    expect(io.stderrLines.some((line) => line.includes('unrecognized file extension'))).toBe(true);
  });

  it('exits 2 for no positional arguments at all', async () => {
    const exitCode = await run([], captureIo());
    expect(exitCode).toBe(2);
  });

  it('exits 2 for a malformed flag, without touching the filesystem', async () => {
    const io = captureIo();
    const exitCode = await run(['--not-a-real-flag'], io);
    expect(exitCode).toBe(2);
    expect(io.stderrLines.length).toBeGreaterThan(0);
  });
});

describe('run — --help and --version', () => {
  it('--help prints usage and exits 0 without requiring a path', async () => {
    const io = captureIo();
    const exitCode = await run(['--help'], io);
    expect(exitCode).toBe(0);
    expect(io.stdoutLines.some((line) => line.includes('Usage: rewrap-plus'))).toBe(true);
  });

  it('--version prints a version string and exits 0', async () => {
    const io = captureIo();
    const exitCode = await run(['--version'], io);
    expect(exitCode).toBe(0);
    expect(io.stdoutLines).toHaveLength(1);
    expect(io.stdoutLines[0]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('run — config file precedence end to end', () => {
  it('a pyproject.toml column-limit changes what gets wrapped', async () => {
    const root = makeTempDir();
    writeFileSync(join(root, 'pyproject.toml'), '[tool.rewrap-plus]\ncolumn-limit = 10\n');
    const file = join(root, 'a.py');
    writeFileSync(file, '# short but not this short\n');

    const exitCode = await run([file], captureIo());
    expect(exitCode).toBe(0);
    expect(readFileSync(file, 'utf8')).not.toBe('# short but not this short\n');
  });

  it('a --column-limit flag overrides pyproject.toml', async () => {
    const root = makeTempDir();
    writeFileSync(join(root, 'pyproject.toml'), '[tool.rewrap-plus]\ncolumn-limit = 10\n');
    const file = join(root, 'a.py');
    const original = '# short but not this short\n';
    writeFileSync(file, original);

    const exitCode = await run(['--column-limit', '80', file], captureIo());
    expect(exitCode).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(original); // 80 is wide enough — untouched
  });
});
