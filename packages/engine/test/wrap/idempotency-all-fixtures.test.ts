import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { pythonAdapter } from '../../src/languages/python/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

import commentsTrailing from '../fixtures/python/comments/001-trailing-comment-after-code.in.py?raw';
import commentsVaryingIndent from '../fixtures/python/comments/002-varying-indent-blocks.in.py?raw';
import commentsInsideFunction from '../fixtures/python/comments/003-comments-inside-function-body.in.py?raw';
import commentsAlreadyWrapped from '../fixtures/python/comments/004-already-wrapped-byte-identical.in.py?raw';
import commentsCommentedOutCode from '../fixtures/python/comments/005-commented-out-code-verbatim.in.py?raw';
import commentsDirectives from '../fixtures/python/comments/006-directive-comments-untouched.in.py?raw';

import docstringsMinimal from '../fixtures/python/docstrings/001-minimal-plain.in.py?raw';
import docstringsGoogle from '../fixtures/python/docstrings/002-google-style.in.py?raw';
import docstringsNumpy from '../fixtures/python/docstrings/003-numpy-style.in.py?raw';
import docstringsSphinx from '../fixtures/python/docstrings/004-sphinx-style.in.py?raw';
import docstringsAlreadyWrapped from '../fixtures/python/docstrings/005-already-wrapped-byte-identical.in.py?raw';
import docstringsDoctest from '../fixtures/python/docstrings/006-doctest-preserved.in.py?raw';
import docstringsMultiRegion from '../fixtures/python/docstrings/007-module-class-attribute-docstrings.in.py?raw';
import docstringsQuoteAloneMultiPara from '../fixtures/python/docstrings/008-quote-alone-multi-paragraph.in.py?raw';

import stringsLongProse from '../fixtures/python/strings/001-long-prose-message.in.py?raw';
import stringsRebalanced from '../fixtures/python/strings/002-existing-concat-rebalanced.in.py?raw';
import stringsFstring from '../fixtures/python/strings/003-fstring-interpolation.in.py?raw';
import stringsNeedsParens from '../fixtures/python/strings/004-needs-parens-return.in.py?raw';
import stringsAlreadyGrouped from '../fixtures/python/strings/005-already-grouped-call-arg.in.py?raw';
import stringsOperatorStyle from '../fixtures/python/strings/006-operator-style-preserved.in.py?raw';
import stringsAlreadyWrapped from '../fixtures/python/strings/007-already-correctly-wrapped-byte-identical.in.py?raw';
import stringsTripleSingleLine from '../fixtures/python/strings/008-triple-quoted-single-line-prose.in.py?raw';
import stringsTripleMultiLine from '../fixtures/python/strings/009-triple-quoted-multiline-prose.in.py?raw';
import stringsNegSql from '../fixtures/python/strings/neg-001-sql-query.in.py?raw';
import stringsNegRegex from '../fixtures/python/strings/neg-002-regex-pattern.in.py?raw';
import stringsNegUrl from '../fixtures/python/strings/neg-003-url.in.py?raw';
import stringsNegDictKey from '../fixtures/python/strings/neg-004-dict-key.in.py?raw';
import stringsNegI18n from '../fixtures/python/strings/neg-005-i18n-key.in.py?raw';
import stringsNegLogging from '../fixtures/python/strings/neg-006-logging-format-string.in.py?raw';
import stringsNegPath from '../fixtures/python/strings/neg-007-path-literal.in.py?raw';
import stringsNegRaw from '../fixtures/python/strings/neg-008-raw-string.in.py?raw';
import stringsNegWhitespace from '../fixtures/python/strings/neg-009-irregular-whitespace.in.py?raw';
import stringsNegTripleQuote from '../fixtures/python/strings/neg-010-triple-quoted-ordinary-string.in.py?raw';
import stringsNegLineContinuation from '../fixtures/python/strings/neg-011-line-continuation.in.py?raw';
import stringsNegTripleCodeLike from '../fixtures/python/strings/neg-012-triple-quoted-code-like.in.py?raw';

/**
 * Idempotency property tests: `wrap(wrap(x)) === wrap(x)`
 * across every gold fixture in the repo, wired into CI as a blocking check
 * (an ordinary `it` in the default `npm test` run, same as every other
 * suite — there's no separate "blocking" mechanism in this project beyond
 * "part of the test run the CI-equivalent gate already requires").
 *
 * Distinct from the idempotency check each phase's own gold-fixture suite
 * already has (`python-comment-wrap-fixtures.test.ts` and its docstring/
 * string counterparts each re-wrap their own `.out.py` gold file and
 * assert no further edits): those check idempotency *from the gold
 * output*, under *that phase's own* narrow config (`wrapStrings: false`
 * for the comment suite, `docDialect: 'plain'`, etc. — whatever matches
 * that phase's own fixtures). This suite instead computes `wrap(x)` itself
 * from every fixture's raw `.in.py` — never trusting the checked-in
 * `.out.py` to already be correct — under one shared, everything-enabled
 * config applied uniformly across every fixture category (comments,
 * docstrings, strings together, not one phase's slice at a time). That's
 * a genuinely different, broader exercise of the same property: it holds
 * regardless of which config produced the first wrap, since idempotency
 * only requires that a *second* call under the *same* config as the first
 * produces no further change — it says nothing about whether that config
 * matches what any individual fixture was originally written to test.
 *
 * Negative string fixtures (`neg-*`) are included deliberately, not
 * skipped: under `stringPolicy: 'all'` (not each fixture's own
 * `'prose'`), several of them stop being negative — the prose heuristic
 * and the dict-key exemption are both `'prose'`-only gates (see
 * `wrap.ts`), so a SQL query or dict key genuinely gets wrapped here where
 * it wouldn't under the string-wrap fixture suite's own config. That's
 * fine and expected: this suite doesn't assert *what* gets wrapped, only
 * that wrapping twice is the same as wrapping once, whatever the first
 * pass produced. The hard structural refusals (`isSafeToWrap` — raw
 * strings, mixed prefixes, a multi-part triple-quoted run, line
 * continuations, irregular whitespace) are policy-independent and stay
 * negative here too. A single-part triple-quoted literal is the one
 * string shape whose `isSafeToWrap` gate is *itself*
 * `looksLikeProse`, unconditionally, regardless of `stringPolicy` — so
 * `stringsTripleSingleLine`/`stringsTripleMultiLine` (008/009) stay
 * positive here exactly as they are under the string-wrap suite's own
 * `'prose'` config, while `stringsNegTripleQuote` (010, multi-part) and
 * `stringsNegTripleCodeLike` (012, single-part but SQL-shaped) stay
 * negative under `'all'` for the same reason they do under `'prose'` —
 * see `./python-string-wrap-fixtures.test.ts`'s own fixtures for the
 * positive/negative rationale in full.
 */
const fixtureSources: readonly string[] = [
  commentsTrailing,
  commentsVaryingIndent,
  commentsInsideFunction,
  commentsAlreadyWrapped,
  commentsCommentedOutCode,
  commentsDirectives,
  docstringsMinimal,
  docstringsGoogle,
  docstringsNumpy,
  docstringsSphinx,
  docstringsAlreadyWrapped,
  docstringsDoctest,
  docstringsMultiRegion,
  docstringsQuoteAloneMultiPara,
  stringsLongProse,
  stringsRebalanced,
  stringsFstring,
  stringsNeedsParens,
  stringsAlreadyGrouped,
  stringsOperatorStyle,
  stringsAlreadyWrapped,
  stringsTripleSingleLine,
  stringsTripleMultiLine,
  stringsNegSql,
  stringsNegRegex,
  stringsNegUrl,
  stringsNegDictKey,
  stringsNegI18n,
  stringsNegLogging,
  stringsNegPath,
  stringsNegRaw,
  stringsNegWhitespace,
  stringsNegTripleQuote,
  stringsNegLineContinuation,
  stringsNegTripleCodeLike,
];

const fixtureNames: readonly string[] = [
  'comments/001-trailing-comment-after-code',
  'comments/002-varying-indent-blocks',
  'comments/003-comments-inside-function-body',
  'comments/004-already-wrapped-byte-identical',
  'comments/005-commented-out-code-verbatim',
  'comments/006-directive-comments-untouched',
  'docstrings/001-minimal-plain',
  'docstrings/002-google-style',
  'docstrings/003-numpy-style',
  'docstrings/004-sphinx-style',
  'docstrings/005-already-wrapped-byte-identical',
  'docstrings/006-doctest-preserved',
  'docstrings/007-module-class-attribute-docstrings',
  'docstrings/008-quote-alone-multi-paragraph',
  'strings/001-long-prose-message',
  'strings/002-existing-concat-rebalanced',
  'strings/003-fstring-interpolation',
  'strings/004-needs-parens-return',
  'strings/005-already-grouped-call-arg',
  'strings/006-operator-style-preserved',
  'strings/007-already-correctly-wrapped-byte-identical',
  'strings/008-triple-quoted-single-line-prose',
  'strings/009-triple-quoted-multiline-prose',
  'strings/neg-001-sql-query',
  'strings/neg-002-regex-pattern',
  'strings/neg-003-url',
  'strings/neg-004-dict-key',
  'strings/neg-005-i18n-key',
  'strings/neg-006-logging-format-string',
  'strings/neg-007-path-literal',
  'strings/neg-008-raw-string',
  'strings/neg-009-irregular-whitespace',
  'strings/neg-010-triple-quoted-ordinary-string',
  'strings/neg-011-line-continuation',
  'strings/neg-012-triple-quoted-code-like',
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

const engineRoot = '.';

let parserManager: ParserManager;

beforeAll(async () => {
  const registry = new AdapterRegistry();
  registry.register(pythonAdapter);
  parserManager = await ParserManager.create({ wasmDir: engineRoot, registry });
});

describe.each([
  ['greedy', config()],
  ['balanced', config({ balancedWrapping: true })],
] as const)('idempotency across every gold fixture in the repo (%s mode)', (_mode, cfg) => {
  it.each(fixtureNames.map((name, i) => [name, fixtureSources[i]!] as const))(
    'wrap(wrap(%s)) === wrap(%s)',
    async (_name, source) => {
      const first = await wrapRegions(source, 'python', 'all', cfg, parserManager);
      const wrapped = applyTextEdits(source, first.edits);

      const second = await wrapRegions(wrapped, 'python', 'all', cfg, parserManager);
      expect(second.edits).toEqual([]);
    },
  );

  it('covers every fixture file this suite is meant to (guards against a silently dropped import)', () => {
    expect(fixtureNames).toHaveLength(35);
    expect(fixtureSources).toHaveLength(fixtureNames.length);
  });
});
