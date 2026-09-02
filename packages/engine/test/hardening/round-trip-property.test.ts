import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import { parseWithErrors } from '../../src/parser/parse-result.js';
import type { WrapConfig } from '../../src/types/config.js';
import type { LanguageAdapter } from '../../src/types/adapter.js';
import { pythonAdapter } from '../../src/languages/python/adapter.js';
import { javascriptAdapter } from '../../src/languages/javascript/adapter.js';
import { typescriptAdapter } from '../../src/languages/typescript/adapter.js';
import { cppAdapter } from '../../src/languages/cpp/adapter.js';
import { javaAdapter } from '../../src/languages/java/adapter.js';
import { wrapRegions } from '../../src/wrap.js';
import { extractConcatenatedStringValue as extractPythonValue } from '../support/decode-python-string.js';
import { extractConcatenatedStringValue as extractJsValue } from '../support/decode-js-string.js';
import { extractConcatenatedStringValue as extractCppValue } from '../support/decode-cpp-string.js';
import { extractConcatenatedStringValue as extractJavaValue } from '../support/decode-java-string.js';

/**
 * Round-trip property tests with generated input: fast-check generators
 * for comments/docstrings/strings, asserting four named properties —
 * idempotent, no line over limit except a lone atom, output still parses,
 * string values unchanged — against generated rather than hand-written
 * source.
 *
 * The "line comments" and "string literals" categories are parameterized
 * across every registered adapter — the same Python-only gap
 * `../wrap/idempotency-all-fixtures.test.ts` and this directory's other
 * suites had before being generalized. "Docstrings" stays Python-only
 * below, deliberately: it isn't a gap the way the other two were — Python
 * is the only registered adapter with a real docstring construct at all
 * (JS/TS/C++/Java have doc *comments* — JSDoc/Doxygen/Javadoc-style,
 * dissolved/emitted through a different pipeline — not docstrings), so there's no
 * "JS docstring" case this suite is missing.
 *
 * Deliberately word-bank-based rather than raw fuzzed Unicode: a
 * generator that could produce quotes, backslashes, or newlines *inside*
 * the generated content would mostly be exercising dissolve/escape edge
 * cases — real, but already covered by the existing hand-written,
 * eval-equivalence-checked gold fixtures (`../wrap/python-string-wrap-
 * fixtures.test.ts` and its JS/TS/C++/Java counterparts), which can name
 * and check an *exact* expected decoded value in a way a property test
 * can't as usefully. What this suite adds on top is broad, structural
 * randomization the gold fixtures don't: word count, word length, column
 * limit, and nesting depth (for line comments) all vary per run,
 * exercising the reflow/emit pipeline's general shape rather than any one
 * hand-picked case.
 */
const WORD_BANK = [
  'a',
  'i',
  'to',
  'of',
  'the',
  'word',
  'words',
  'prose',
  'sentence',
  'wraps',
  'wrapping',
  'around',
  'nicely',
  'here',
  'there',
  'testing',
  'engine',
  'value',
  'reflow',
  'column',
  'limit',
  'paragraph',
  'documentation',
  'implementation',
  'extraordinarily',
  'supercalifragilisticexpialidocious',
];

const wordArb = fc.constantFrom(...WORD_BANK);
const sentenceArb = fc
  .array(wordArb, { minLength: 1, maxLength: 40 })
  .map((words) => words.join(' '));
/**
 * `sentenceArb` widened to include the zero-word case, for the
 * string-literal property only (not line comments/docstrings, where an
 * empty body isn't the failure mode this guards). A sibling
 * implementation once rewrapped an empty string literal (`x = ""`) into a
 * bare, delimiter-less `x =` — invalid syntax. `stringPolicy: 'all'`
 * (this suite's config, below) already bypasses the prose gate that would
 * otherwise keep an empty string from ever reaching `wrapString` at all,
 * so this generator just needs to actually produce `''` sometimes; the
 * existing "re-parses cleanly" and "string value unchanged" assertions in
 * the property below do the rest.
 */
const stringSentenceArb = fc.oneof({ arbitrary: fc.constant(''), weight: 1 }, { arbitrary: sentenceArb, weight: 9 });
const columnLimitArb = fc.integer({ min: 20, max: 100 });
const depthArb = fc.integer({ min: 0, max: 3 });

const NUM_RUNS = 40;

function config(overrides: Partial<WrapConfig> = {}): WrapConfig {
  return {
    columnLimit: 60,
    tabSize: 4,
    wrapComments: true,
    wrapStrings: true,
    stringPolicy: 'all',
    docDialect: 'plain',
    preserveIndentedBlocks: false,
    balancedWrapping: false,
    ...overrides,
  };
}

/** Wrap `line` in `depth` levels of nested `def f():` — 4 spaces per level. */
function nestDef(depth: number, line: string): string {
  let body = line;
  for (let i = 0; i < depth; i++) {
    const indent = ' '.repeat((depth - i - 1) * 4 + 4);
    const reindented = body
      .split('\n')
      .map((l) => (l.length > 0 ? indent + l : l))
      .join('\n');
    body = `${' '.repeat((depth - i - 1) * 4)}def f${i}():\n${reindented}`;
  }
  return body + '\n';
}

/**
 * Brace-language counterpart to `nestDef`: `depth` levels of nested
 * `function f{i}() { ... }` declarations, 4 spaces per level. Nested
 * function *declarations* (unlike nested function *definitions* in C++,
 * or nested method definitions in Java) are valid JS/TS at any depth,
 * including depth 0 (no wrapper at all — a bare top-level comment is
 * already valid JS/TS, same as it is for Python).
 */
function nestJsFunction(depth: number, line: string): string {
  let body = line;
  for (let i = 0; i < depth; i++) {
    const outerIndent = ' '.repeat((depth - i - 1) * 4);
    const innerIndent = ' '.repeat((depth - i - 1) * 4 + 4);
    const reindented = body
      .split('\n')
      .map((l) => (l.length > 0 ? innerIndent + l : l))
      .join('\n');
    body = `${outerIndent}function f${i}() {\n${reindented}\n${outerIndent}}`;
  }
  return body + '\n';
}

/**
 * C++/Java counterpart to `nestDef`: unlike Python (indentation-only) or
 * JS/TS (nested function *declarations* are legal at file scope), neither
 * C++ nor Java allows a nested named function/method definition, and
 * neither allows a bare statement or block at file/class scope at all. So
 * `depth` levels of nesting here means `depth` nested blocks (always
 * legal *inside* a function/method body, at any depth) inside one single,
 * always-present enclosing function/method — `outerHeader` supplies that
 * one line (`void f() {\n... \n}` for C++, `class C {\n  void f() {\n
 * ...\n  }\n}` for Java). Unlike `nestDef`/`nestJsFunction`, depth 0 still
 * carries that one unavoidable wrapper.
 *
 * `blockHeader` prefixes each nested `{` (`'if (true) '`, or `''` for a
 * bare block). Found necessary for C++ specifically, by direct probing
 * (`docs/spikes/probe-concat-depth.mjs`'s sibling investigation, same
 * session): a function body consisting of *nothing but* a bare nested
 * `{ }` block — no other statement anywhere in the body — is genuinely
 * ambiguous C++ grammar, and `tree-sitter-cpp` resolves it as a variable
 * declaration with a braced initializer (`void f() { ... };`) rather than
 * a function definition, producing a real parse error. Any actual
 * statement before the block, or a block introduced by a keyword like
 * `if`, disambiguates it correctly — confirmed by direct probing to
 * produce zero errors either way. Java's grammar has no such ambiguity (a
 * bare nested block parses cleanly there), so it passes `''`.
 */
function nestBraceBlocks(
  depth: number,
  line: string,
  wrap: (inner: string) => string,
  blockHeader: string,
): string {
  const bodyIndent = ' '.repeat((depth + 1) * 4);
  let inner = line
    .split('\n')
    .map((l) => (l.length > 0 ? bodyIndent + l : l))
    .join('\n');
  for (let i = depth; i >= 1; i--) {
    const indent = ' '.repeat(i * 4);
    inner = `${indent}${blockHeader}{\n${inner}\n${indent}}`;
  }
  return wrap(inner);
}

interface LanguageSet {
  readonly languageId: string;
  readonly adapter: LanguageAdapter;
  readonly lineCommentMarker: string;
  readonly nestLineComment: (depth: number, comment: string) => string;
  readonly buildStringSource: (sentence: string) => string;
  readonly extractStringValue: (source: string) => string;
}

const LANGUAGE_SETS: readonly LanguageSet[] = [
  {
    languageId: 'python',
    adapter: pythonAdapter,
    lineCommentMarker: '#',
    nestLineComment: (depth, comment) => nestDef(depth, `${' '.repeat(depth * 4)}${comment}`),
    buildStringSource: (sentence) => `x = "${sentence}"\n`,
    extractStringValue: extractPythonValue,
  },
  {
    languageId: 'javascript',
    adapter: javascriptAdapter,
    lineCommentMarker: '//',
    nestLineComment: (depth, comment) =>
      nestJsFunction(depth, `${' '.repeat(depth * 4)}${comment}`),
    buildStringSource: (sentence) => `const x = "${sentence}";\n`,
    extractStringValue: extractJsValue,
  },
  {
    languageId: 'typescript',
    adapter: typescriptAdapter,
    lineCommentMarker: '//',
    nestLineComment: (depth, comment) =>
      nestJsFunction(depth, `${' '.repeat(depth * 4)}${comment}`),
    buildStringSource: (sentence) => `const x: string = "${sentence}";\n`,
    extractStringValue: extractJsValue,
  },
  {
    languageId: 'cpp',
    adapter: cppAdapter,
    lineCommentMarker: '//',
    nestLineComment: (depth, comment) =>
      nestBraceBlocks(depth, comment, (inner) => `void f() {\n${inner}\n}\n`, 'if (true) '),
    buildStringSource: (sentence) => `void f() {\n  const char* x = "${sentence}";\n}\n`,
    extractStringValue: extractCppValue,
  },
  {
    languageId: 'java',
    adapter: javaAdapter,
    lineCommentMarker: '//',
    nestLineComment: (depth, comment) =>
      nestBraceBlocks(depth, comment, (inner) => `class C {\n  void f() {\n${inner}\n  }\n}\n`, ''),
    buildStringSource: (sentence) => `class C {\n  String x = "${sentence}";\n}\n`,
    extractStringValue: extractJavaValue,
  },
];

/**
 * The overflow rule allows a single unbreakable atom (one word here,
 * since the word bank never contains spaces) to exceed the column limit
 * — mirrors the same allowance every gold-fixture suite's own "no line
 * over the limit" check makes (e.g. `../wrap/python-comment-wrap-
 * fixtures.test.ts`).
 *
 * Scoped to `edits[*].newText` — exactly the text `wrapRegions` produced
 * — never the whole reassembled file: an untouched code line (`def
 * f0():`, `function f0() {`, `void f() {`) is neither reflowed content
 * nor this property's concern, the same reasoning `run-adapter-
 * conformance.ts`'s own over-limit check documents.
 */
function assertNoLineOverLimitExceptLoneAtom(
  edits: readonly { readonly newText: string }[],
  columnLimit: number,
  lineCommentMarker: string,
): void {
  const markerEscaped = lineCommentMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const markerPattern = new RegExp(`^${markerEscaped}\\s?`);
  for (const edit of edits) {
    for (const line of edit.newText.split(/\r?\n/)) {
      if (line.length <= columnLimit) {
        continue;
      }
      const withoutDecoration = line
        .trim()
        .replace(/^\(/, '')
        .replace(/\)$/, '')
        .replace(/^"""|"""$/g, '')
        .replace(markerPattern, '')
        // JS/TS/Java's `'operator'`-style concatenation (trailing `+`,
        // `../src/languages/java/descriptor.ts`'s own
        // `operatorPlacement: 'trailing'`) leaves every continuation line
        // but the last ending in `" +` rather than bare `"` — strip the
        // operator before the quote-stripping below so it doesn't read as
        // a second token sharing the line.
        .replace(/ \+$/, '')
        .replace(/^"|"$/g, '')
        // A single *trailing* space is the deliberate "preserve the
        // trailing space at split points" glue the string-emit fixtures
        // cover (`"foo " "bar"`, not `"foo" "bar"`) — not a
        // second atom sharing this line, so it doesn't disqualify an
        // otherwise-lone-atom line the way an *interior* space would.
        .replace(/ +$/, '');
      expect(withoutDecoration).not.toMatch(/ /);
    }
  }
}

let parserManager: ParserManager;

beforeAll(async () => {
  const registry = new AdapterRegistry();
  for (const { adapter } of LANGUAGE_SETS) {
    registry.register(adapter);
  }
  parserManager = await ParserManager.create({ wasmDir: '.', registry });
});

describe.each(LANGUAGE_SETS)(
  'round-trip properties over generated input ($languageId)',
  ({ languageId, lineCommentMarker, nestLineComment, buildStringSource, extractStringValue }) => {
    it('line comments: idempotent, within-limit, and always re-parse cleanly', async () => {
      await fc.assert(
        fc.asyncProperty(
          sentenceArb,
          columnLimitArb,
          depthArb,
          async (sentence, columnLimit, depth) => {
            const source = nestLineComment(depth, `${lineCommentMarker} ${sentence}`);
            const cfg = config({ columnLimit });

            const first = await wrapRegions(source, languageId, 'all', cfg, parserManager);
            const wrapped = applyTextEdits(source, first.edits);

            const second = await wrapRegions(wrapped, languageId, 'all', cfg, parserManager);
            expect(second.edits).toEqual([]);

            assertNoLineOverLimitExceptLoneAtom(first.edits, columnLimit, lineCommentMarker);

            const parser = await parserManager.parserFor(languageId);
            expect(parseWithErrors(parser, wrapped).hasErrors).toBe(false);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    it('string literals: idempotent, within-limit, re-parse cleanly, and the string value never changes', async () => {
      await fc.assert(
        fc.asyncProperty(stringSentenceArb, columnLimitArb, async (sentence, columnLimit) => {
          const source = buildStringSource(sentence);
          const cfg = config({ columnLimit });

          const first = await wrapRegions(source, languageId, 'all', cfg, parserManager);
          const wrapped = applyTextEdits(source, first.edits);

          const second = await wrapRegions(wrapped, languageId, 'all', cfg, parserManager);
          expect(second.edits).toEqual([]);

          assertNoLineOverLimitExceptLoneAtom(first.edits, columnLimit, lineCommentMarker);

          const parser = await parserManager.parserFor(languageId);
          expect(parseWithErrors(parser, wrapped).hasErrors).toBe(false);

          expect(extractStringValue(wrapped)).toBe(extractStringValue(source));
        }),
        { numRuns: NUM_RUNS },
      );
    });
  },
);

describe('round-trip properties over generated input (python docstrings — see module doc comment)', () => {
  // Reuses the shared `parserManager` from `beforeAll` above (registered
  // with every adapter, Python included) and the module-level `nestDef` —
  // no adapter- or nesting-logic duplication needed for this one
  // Python-only category.
  it('docstrings: idempotent, within-limit, and always re-parse cleanly', async () => {
    await fc.assert(
      fc.asyncProperty(
        sentenceArb,
        columnLimitArb,
        depthArb,
        async (sentence, columnLimit, depth) => {
          const source = nestDef(depth + 1, `${' '.repeat((depth + 1) * 4)}"""${sentence}"""`);
          const cfg = config({ columnLimit });

          const first = await wrapRegions(source, 'python', 'all', cfg, parserManager);
          const wrapped = applyTextEdits(source, first.edits);

          const second = await wrapRegions(wrapped, 'python', 'all', cfg, parserManager);
          expect(second.edits).toEqual([]);

          assertNoLineOverLimitExceptLoneAtom(first.edits, columnLimit, '#');

          const parser = await parserManager.parserFor('python');
          expect(parseWithErrors(parser, wrapped).hasErrors).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
