import { describe, expect, it } from 'vitest';
import { scanDirectives } from './directives.js';

describe('scanDirectives', () => {
  it('has no effect on a source with no directives', () => {
    const scan = scanDirectives('x = 1\ny = 2\n');
    expect(scan.isDisabledAt(0)).toBe(false);
    expect(scan.isIgnoredAt(0)).toBe(false);
    expect(scan.isForcedAt(0)).toBe(false);
  });

  it('disables rows within a rewrap: off .. on range, inclusive/exclusive', () => {
    const source = ['x = 1', '# rewrap: off', 'y = 2', 'z = 3', '# rewrap: on', 'w = 4'].join('\n');
    const scan = scanDirectives(source);
    expect(scan.isDisabledAt(0)).toBe(false); // before off
    expect(scan.isDisabledAt(1)).toBe(true); // the off directive's own row
    expect(scan.isDisabledAt(2)).toBe(true);
    expect(scan.isDisabledAt(3)).toBe(true);
    expect(scan.isDisabledAt(4)).toBe(false); // the on directive's own row
    expect(scan.isDisabledAt(5)).toBe(false);
  });

  it('treats fmt: off/on as the same toggle as rewrap: off/on', () => {
    const source = ['# fmt: off', 'y = 2', '# rewrap: on', 'w = 4'].join('\n');
    const scan = scanDirectives(source);
    expect(scan.isDisabledAt(1)).toBe(true);
    expect(scan.isDisabledAt(3)).toBe(false);
  });

  it('disables everything to end of file for an unterminated off', () => {
    const source = ['x = 1', '# rewrap: off', 'y = 2'].join('\n');
    const scan = scanDirectives(source);
    expect(scan.isDisabledAt(2)).toBe(true);
    expect(scan.isDisabledAt(100)).toBe(true);
  });

  it('targets the next row for a standalone rewrap: ignore', () => {
    const source = ['# rewrap: ignore', 'x = "foo"'].join('\n');
    const scan = scanDirectives(source);
    expect(scan.isIgnoredAt(1)).toBe(true);
    expect(scan.isIgnoredAt(0)).toBe(false);
  });

  it('targets the same row for a trailing rewrap: force', () => {
    const source = 'x = "foo"  # rewrap: force';
    const scan = scanDirectives(source);
    expect(scan.isForcedAt(0)).toBe(true);
  });

  it('targets the next row for a standalone rewrap: force', () => {
    const source = ['# rewrap: force', 'x = "foo"'].join('\n');
    const scan = scanDirectives(source);
    expect(scan.isForcedAt(1)).toBe(true);
    expect(scan.isForcedAt(0)).toBe(false);
  });

  it('does not recognize fmt: ignore or fmt: force', () => {
    const source = ['# fmt: ignore', 'x = "foo"', '# fmt: force', 'y = "bar"'].join('\n');
    const scan = scanDirectives(source);
    expect(scan.isIgnoredAt(1)).toBe(false);
    expect(scan.isForcedAt(3)).toBe(false);
  });

  it('is case-insensitive and tolerant of extra spacing', () => {
    const source = ['#   REWRAP : IGNORE', 'x = "foo"'].join('\n');
    const scan = scanDirectives(source);
    expect(scan.isIgnoredAt(1)).toBe(true);
  });

  it('recognizes a directive under a non-default comment marker (e.g. JS/TS "//")', () => {
    const source = ['// rewrap: off', 'const y = 2;', '// rewrap: on'].join('\n');
    const scan = scanDirectives(source, '//');
    expect(scan.isDisabledAt(1)).toBe(true);
    expect(scan.isDisabledAt(2)).toBe(false);
  });

  it('does not recognize a "#" directive when scanning under a "//" marker', () => {
    const source = ['# rewrap: off', 'const y = 2;'].join('\n');
    const scan = scanDirectives(source, '//');
    expect(scan.isDisabledAt(1)).toBe(false);
  });
});
