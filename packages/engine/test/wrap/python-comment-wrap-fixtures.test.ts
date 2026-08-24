import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { pythonAdapter } from '../../src/languages/python/adapter.js';
import { wrapRegions } from '../../src/languages/python/wrap.js';

import trailingCommentIn from '../fixtures/python/comments/001-trailing-comment-after-code.in.py?raw';
import trailingCommentOut from '../fixtures/python/comments/001-trailing-comment-after-code.out.py?raw';
import varyingIndentIn from '../fixtures/python/comments/002-varying-indent-blocks.in.py?raw';
import varyingIndentOut from '../fixtures/python/comments/002-varying-indent-blocks.out.py?raw';
import insideFunctionIn from '../fixtures/python/comments/003-comments-inside-function-body.in.py?raw';
import insideFunctionOut from '../fixtures/python/comments/003-comments-inside-function-body.out.py?raw';
import alreadyWrappedIn from '../fixtures/python/comments/004-already-wrapped-byte-identical.in.py?raw';
import alreadyWrappedOut from '../fixtures/python/comments/004-already-wrapped-byte-identical.out.py?raw';
import commentedOutCodeIn from '../fixtures/python/comments/005-commented-out-code-verbatim.in.py?raw';
import commentedOutCodeOut from '../fixtures/python/comments/005-commented-out-code-verbatim.out.py?raw';
import directivesIn from '../fixtures/python/comments/006-directive-comments-untouched.in.py?raw';
import directivesOut from '../fixtures/python/comments/006-directive-comments-untouched.out.py?raw';

/**
 * Phase 6's stated acceptance criterion: "Python comment wrapping works
 * end-to-end in the engine, no VSCode yet." Each fixture pairs a
 * standalone `.in.py` source with a checked-in `.out.py` gold file
 * (this project's established fixture convention — see e.g.
 * `../discovery/python-region-fixtures.test.ts`), and the test asserts
 * that running the real `wrapRegions` → `applyTextEdits` pipeline on the
 * input reproduces the gold file exactly.
 *
 * Fixtures are imported statically via `?raw` (declared for `.py`
 * sources in `../raw-import.d.ts`) rather than discovered by walking the
 * fixtures directory, per this package's no-`node:fs` convention — a
 * missing or misnamed `.out.py` is a compile-time import error here,
 * not a silently-skipped test.
 *
 * Column limit is a fixed 40 for every fixture (chosen for compact,
 * readable gold files) except where a fixture's own point is that its
 * content is *never* wrapped regardless of width (005, 006) — those are
 * still run at 40 to make the point concrete: the lines are well over
 * that limit and stay untouched anyway.
 */
const COLUMN_LIMIT = 40;

interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
}

const fixtures: readonly Fixture[] = [
  {
    name: '001-trailing-comment-after-code',
    input: trailingCommentIn,
    expected: trailingCommentOut,
  },
  { name: '002-varying-indent-blocks', input: varyingIndentIn, expected: varyingIndentOut },
  {
    name: '003-comments-inside-function-body',
    input: insideFunctionIn,
    expected: insideFunctionOut,
  },
  {
    name: '004-already-wrapped-byte-identical',
    input: alreadyWrappedIn,
    expected: alreadyWrappedOut,
  },
  {
    name: '005-commented-out-code-verbatim',
    input: commentedOutCodeIn,
    expected: commentedOutCodeOut,
  },
  { name: '006-directive-comments-untouched', input: directivesIn, expected: directivesOut },
];

function config(overrides: Partial<WrapConfig> = {}): WrapConfig {
  return {
    columnLimit: COLUMN_LIMIT,
    tabSize: 4,
    wrapComments: true,
    wrapStrings: false,
    stringPolicy: 'off',
    docDialect: 'plain',
    preserveIndentedBlocks: false,
    ...overrides,
  };
}

// `.` resolves against Vitest's cwd (this package's root) — see
// `../../src/parser/parser-manager.test.ts` for the same pattern.
const engineRoot = '.';

let parserManager: ParserManager;

beforeAll(async () => {
  const registry = new AdapterRegistry();
  registry.register(pythonAdapter);
  parserManager = await ParserManager.create({ wasmDir: engineRoot, registry });
});

describe('Python comment wrapping — end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(fixture.input, 'python', 'all', config(), parserManager);
    const actual = applyTextEdits(fixture.input, result.edits);
    expect(actual).toBe(fixture.expected);
  });

  it('produces no line over the column limit for any fixture that was actually reflowed', async () => {
    // Excludes 005/006: their whole point is content that's *never*
    // reflowed (verbatim commented-out code, verbatim directives), so
    // their lines legitimately exceed the limit with interior spaces —
    // this check is about the overflow rule for content this phase
    // actually reflows, not about verbatim pass-through.
    const reflowed = fixtures.filter(
      (f) =>
        f.name !== '005-commented-out-code-verbatim' &&
        f.name !== '006-directive-comments-untouched',
    );
    for (const fixture of reflowed) {
      const result = await wrapRegions(fixture.input, 'python', 'all', config(), parserManager);
      const actual = applyTextEdits(fixture.input, result.edits);
      for (const line of actual.split('\n')) {
        if (!line.trimStart().startsWith('#')) {
          continue; // only comment lines are this phase's concern
        }
        if (line.length > COLUMN_LIMIT) {
          // Only legitimate if the line is a single unbreakable token
          // after its marker (the overflow rule) — assert there's no
          // interior space beyond the marker's own separating space.
          const afterMarker = line.replace(/^\s*#\s?/, '');
          expect(afterMarker).not.toMatch(/ /);
        }
      }
    }
  });

  it('is idempotent: re-wrapping the gold output produces no further edits', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.expected, 'python', 'all', config(), parserManager);
      expect(result.edits).toEqual([]);
    }
  });

  it('leaves the directive and commented-out-code fixtures byte-identical', () => {
    expect(commentedOutCodeIn).toBe(commentedOutCodeOut);
    expect(directivesIn).toBe(directivesOut);
  });

  it('covers the cases the plan calls out for this phase', () => {
    // Not a behavioral assertion — a guard against silently losing
    // coverage of one of these named cases (trailing comments after
    // code, comment blocks at varying indents, comments inside function
    // bodies, an already-correctly-wrapped comment, commented-out code)
    // if a fixture were ever renamed or removed without a replacement.
    expect(fixtures.map((f) => f.name)).toEqual([
      '001-trailing-comment-after-code',
      '002-varying-indent-blocks',
      '003-comments-inside-function-body',
      '004-already-wrapped-byte-identical',
      '005-commented-out-code-verbatim',
      '006-directive-comments-untouched',
    ]);
  });
});
