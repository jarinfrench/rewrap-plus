import { beforeAll, describe, expect, it } from 'vitest';
import { createTestParserManager } from '../helpers/create-test-parser-manager.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import type { LanguageAdapter } from '../../src/types/adapter.js';
import { pythonAdapter } from '../../src/languages/python/adapter.js';
import { javascriptAdapter } from '../../src/languages/javascript/adapter.js';
import { typescriptAdapter } from '../../src/languages/typescript/adapter.js';
import { cppAdapter } from '../../src/languages/cpp/adapter.js';
import { javaAdapter } from '../../src/languages/java/adapter.js';
import { markdownAdapter } from '../../src/languages/markdown/adapter.js';
import { latexAdapter } from '../../src/languages/latex/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

/**
 * Idempotency property tests: `wrap(wrap(x)) === wrap(x)`
 * across every gold fixture in the repo, wired into CI as a blocking check
 * (an ordinary `it` in the default `npm test` run, same as every other
 * suite — there's no separate "blocking" mechanism in this project beyond
 * "part of the test run the CI-equivalent gate already requires").
 *
 * Every language's `.in.*` fixtures are picked up via `import.meta.glob`
 * rather than a hand-maintained list of named imports — deliberately, so
 * this suite can't quietly fall back out of sync with the fixture set the
 * way it once did: this file originally only ever imported Python's own
 * fixtures (`languages/python/adapter.ts` was the only adapter that
 * existed when it was written), and nothing caught that the other four
 * languages' gold fixtures, added by later phases, were never added here
 * too. A glob keyed on each language's own fixture directory means a
 * fixture added to any of them is automatically exercised by this suite
 * the next time it runs, with no second edit required.
 *
 * Distinct from the idempotency check each phase's own gold-fixture suite
 * already has (`python-comment-wrap-fixtures.test.ts` and its language/
 * region-kind counterparts each re-wrap their own `.out.*` gold file and
 * assert no further edits): those check idempotency *from the gold
 * output*, under *that phase's own* narrow config (`wrapStrings: false`
 * for the comment suite, `stringPolicy: 'prose'` for most string suites,
 * etc. — whatever matches that phase's own fixtures). This suite instead
 * computes `wrap(x)` itself from every fixture's raw `.in.*` — never
 * trusting the checked-in `.out.*` to already be correct — under one
 * shared, everything-enabled config applied uniformly across every
 * language and region kind together, not one phase's slice at a time.
 * That's a genuinely different, broader exercise of the same property: it
 * holds regardless of which config produced the first wrap, since
 * idempotency only requires that a *second* call under the *same* config
 * as the first produces no further change — it says nothing about whether
 * that config matches what any individual fixture was originally written
 * to test.
 *
 * Negative fixtures (`neg-*`) are included deliberately, not skipped:
 * under `stringPolicy: 'all'` (not each fixture's own narrower policy),
 * several of them stop being negative — the prose heuristic and
 * language-specific exemptions (e.g. Python's dict-key exemption) are
 * policy-gated, so a SQL query or dict key genuinely gets wrapped here
 * where it wouldn't under that language's own string-wrap fixture suite.
 * That's fine and expected: this suite doesn't assert *what* gets
 * wrapped, only that wrapping twice is the same as wrapping once,
 * whatever the first pass produced. Hard structural refusals
 * (`isSafeToWrap` — raw strings, mixed prefixes, a multi-part
 * triple-quoted run, line continuations, a Java text block, irregular
 * whitespace) are policy-independent and stay negative here too.
 */

interface LanguageFixtureSet {
  readonly languageId: string;
  readonly adapter: LanguageAdapter;
  readonly fixtures: Readonly<Record<string, string>>;
}

const pythonFixtures = import.meta.glob('../fixtures/python/**/*.in.py', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const javascriptFixtures = import.meta.glob('../fixtures/javascript/**/*.in.js', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const typescriptFixtures = import.meta.glob('../fixtures/typescript/**/*.in.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const cppFixtures = import.meta.glob('../fixtures/cpp/**/*.in.cpp', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const javaFixtures = import.meta.glob('../fixtures/java/**/*.in.java', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const markdownFixtures = import.meta.glob('../fixtures/markdown/**/*.in.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const latexFixtures = import.meta.glob('../fixtures/latex/**/*.in.tex', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

/**
 * One entry per adapter with its own end-to-end gold-fixture directory —
 * mirrors the set of adapters `docs/adapters.md` records as passing
 * `runAdapterConformance` with real (non-canary) fixtures. TSX has no
 * fixture directory of its own by design (`docs/adapters.md`'s "TSX gets
 * a full duplicate gold-fixture set only at the unit-test level" note) so
 * it isn't listed here either — nothing to glob.
 *
 * Markdown's own fixtures are all zero-edit as of this addition
 * (Phase C commit 9 — discovery only, `markdownAdapter.wrapProse`
 * doesn't exist until commit 10), so
 * this suite exercises them trivially for now; they become a real
 * idempotency check, not just a discovery-exclusion one, the moment real
 * wrapping fixtures land alongside the negative ones already here.
 */
const LANGUAGE_SETS: readonly LanguageFixtureSet[] = [
  { languageId: 'python', adapter: pythonAdapter, fixtures: pythonFixtures },
  { languageId: 'javascript', adapter: javascriptAdapter, fixtures: javascriptFixtures },
  { languageId: 'typescript', adapter: typescriptAdapter, fixtures: typescriptFixtures },
  { languageId: 'cpp', adapter: cppAdapter, fixtures: cppFixtures },
  { languageId: 'java', adapter: javaAdapter, fixtures: javaFixtures },
  { languageId: 'markdown', adapter: markdownAdapter, fixtures: markdownFixtures },
  { languageId: 'latex', adapter: latexAdapter, fixtures: latexFixtures },
];

function config(overrides: Partial<WrapConfig> = {}): WrapConfig {
  return {
    columnLimit: 60,
    tabSize: 4,
    wrapComments: true,
    wrapStrings: true,
    stringPolicy: 'all',
    docDialect: 'auto',
    preserveIndentedBlocks: true,
    balancedWrapping: false,
    ...overrides,
  };
}

let parserManager: ParserManager;

beforeAll(async () => {
  parserManager = await createTestParserManager(LANGUAGE_SETS.map(({ adapter }) => adapter));
});

describe.each([
  ['greedy', config()],
  ['balanced', config({ balancedWrapping: true })],
] as const)('idempotency across every gold fixture in the repo (%s mode)', (_mode, cfg) => {
  for (const { languageId, fixtures } of LANGUAGE_SETS) {
    const entries = Object.entries(fixtures).sort(([a], [b]) => a.localeCompare(b));

    describe(languageId, () => {
      it.each(entries)('wrap(wrap(%s)) === wrap(...)', async (path, source) => {
        const first = await wrapRegions(source, languageId, 'all', cfg, parserManager);
        const wrapped = applyTextEdits(source, first.edits);

        const second = await wrapRegions(wrapped, languageId, 'all', cfg, parserManager);
        expect(second.edits).toEqual([]);
      });
    });
  }

  /**
   * Guards against the exact failure mode that let this suite go
   * Python-only for four adapter-additions' worth of history: a glob
   * pattern that silently matches nothing (a typo'd extension, a
   * directory that was renamed) produces zero `it.each` cases rather than
   * a failure, so a suite full of green checkmarks can still be covering
   * only some of the languages it claims to. Every language directory
   * must contribute at least one fixture.
   */
  it('every language directory contributed at least one fixture (guards against a glob silently matching nothing)', () => {
    for (const { languageId, fixtures } of LANGUAGE_SETS) {
      expect(Object.keys(fixtures).length, `expected at least one fixture for '${languageId}'`).toBeGreaterThan(0);
    }
  });
});
