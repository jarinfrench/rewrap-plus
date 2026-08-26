import { describe, expect, it } from 'vitest';
import { resolveColumnLimit } from './column-limit.js';

const empty = {
  flagColumnLimit: undefined,
  rewraprcColumnLimit: undefined,
  pyprojectColumnLimit: undefined,
  editorConfigMaxLineLength: undefined,
};

describe('resolveColumnLimit', () => {
  it('falls back to the built-in default when nothing else applies', () => {
    expect(resolveColumnLimit(empty)).toEqual({ value: 80, source: 'default' });
  });

  it('prefers .editorconfig over the default', () => {
    expect(resolveColumnLimit({ ...empty, editorConfigMaxLineLength: 100 })).toEqual({
      value: 100,
      source: '.editorconfig',
    });
  });

  it('prefers pyproject.toml over .editorconfig', () => {
    expect(
      resolveColumnLimit({ ...empty, editorConfigMaxLineLength: 100, pyprojectColumnLimit: 79 }),
    ).toEqual({ value: 79, source: 'pyproject.toml' });
  });

  it('prefers .rewraprc over pyproject.toml', () => {
    expect(
      resolveColumnLimit({ ...empty, pyprojectColumnLimit: 79, rewraprcColumnLimit: 88 }),
    ).toEqual({ value: 88, source: '.rewraprc' });
  });

  it('prefers the flag over every other source', () => {
    expect(
      resolveColumnLimit({
        ...empty,
        editorConfigMaxLineLength: 100,
        pyprojectColumnLimit: 79,
        rewraprcColumnLimit: 88,
        flagColumnLimit: 120,
      }),
    ).toEqual({ value: 120, source: 'flag' });
  });
});
