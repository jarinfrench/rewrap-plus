import { describe, expect, it } from 'vitest';
import { CliArgsError, parseCliArgs } from './args.js';

describe('parseCliArgs', () => {
  it('parses positional paths with no flags', () => {
    const args = parseCliArgs(['a.py', 'b.py']);
    expect(args.paths).toEqual(['a.py', 'b.py']);
    expect(args.check).toBe(false);
    expect(args.help).toBe(false);
    expect(args.version).toBe(false);
    expect(args.language).toBeUndefined();
    expect(args.config).toEqual({});
  });

  it('parses --check and --language', () => {
    const args = parseCliArgs(['--check', '--language', 'python', 'script']);
    expect(args.check).toBe(true);
    expect(args.language).toBe('python');
    expect(args.paths).toEqual(['script']);
  });

  it('parses -h and -v short flags', () => {
    expect(parseCliArgs(['-h']).help).toBe(true);
    expect(parseCliArgs(['-v']).version).toBe(true);
  });

  it('parses --column-limit and --tab-size as integers', () => {
    const args = parseCliArgs(['--column-limit', '100', '--tab-size', '2', 'a.py']);
    expect(args.config.columnLimit).toBe(100);
    expect(args.config.tabSize).toBe(2);
  });

  it('rejects a non-integer --column-limit', () => {
    expect(() => parseCliArgs(['--column-limit', 'wide', 'a.py'])).toThrow(CliArgsError);
  });

  it('rejects a non-positive --tab-size', () => {
    expect(() => parseCliArgs(['--tab-size', '0', 'a.py'])).toThrow(CliArgsError);
    expect(() => parseCliArgs(['--tab-size', '-1', 'a.py'])).toThrow(CliArgsError);
  });

  it('parses --string-policy and --doc-dialect against their allowed enums', () => {
    const args = parseCliArgs(['--string-policy', 'all', '--doc-dialect', 'numpy', 'a.py']);
    expect(args.config.stringPolicy).toBe('all');
    expect(args.config.docDialect).toBe('numpy');
  });

  it('rejects an unrecognized --string-policy value', () => {
    expect(() => parseCliArgs(['--string-policy', 'sometimes', 'a.py'])).toThrow(CliArgsError);
  });

  it.each([
    ['wrap-comments', 'wrapComments'],
    ['wrap-strings', 'wrapStrings'],
    ['preserve-indented-blocks', 'preserveIndentedBlocks'],
    ['balanced-wrapping', 'balancedWrapping'],
  ] as const)('parses --%s / --no-%s as a negatable boolean', (flag, configKey) => {
    expect(parseCliArgs([`--${flag}`, 'a.py']).config[configKey]).toBe(true);
    expect(parseCliArgs([`--no-${flag}`, 'a.py']).config[configKey]).toBe(false);
    expect(parseCliArgs(['a.py']).config[configKey]).toBeUndefined();
  });

  it('maps --editorconfig / --no-editorconfig to respectEditorConfig', () => {
    expect(parseCliArgs(['--editorconfig', 'a.py']).config.respectEditorConfig).toBe(true);
    expect(parseCliArgs(['--no-editorconfig', 'a.py']).config.respectEditorConfig).toBe(false);
  });

  it('--no-X wins if both --X and --no-X are somehow passed', () => {
    expect(parseCliArgs(['--wrap-comments', '--no-wrap-comments', 'a.py']).config.wrapComments).toBe(
      false,
    );
  });

  it('rejects an unrecognized flag', () => {
    expect(() => parseCliArgs(['--not-a-real-flag', 'a.py'])).toThrow(CliArgsError);
  });
});
