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
import { wrapRegions } from '../../src/wrap.js';

/**
 * Line ending and trailing whitespace preservation.
 *
 * `detect-line-ending.test.ts` unit-tests `detectLineEndingNear` itself;
 * this file exercises it end to end through `wrapRegions`, plus the two
 * other preservation properties ("trailing whitespace, and file-final
 * newline preserved") across the *real* gold fixtures (comments,
 * docstrings/doc-comments, and strings together) for every registered
 * adapter, not just Python and not just the conformance kit's own small
 * synthetic sources.
 *
 * Originally Python-only, the same gap `../wrap/idempotency-all-
 * fixtures.test.ts` had before it was made language-generic: this suite
 * predates the JS/TS/C++/Java adapters and nothing carried its coverage
 * forward to them when they landed. Parameterized across all five
 * registered adapters here, following that same file's `import.meta.glob`
 * pattern so a fixture added to any language's directory is picked up
 * automatically rather than needing a second edit in this file too.
 */
const cfg: WrapConfig = {
  columnLimit: 30,
  tabSize: 4,
  wrapComments: true,
  wrapStrings: true,
  stringPolicy: 'all',
  docDialect: 'auto',
  preserveIndentedBlocks: true,
  balancedWrapping: false,
};

interface LanguageSet {
  readonly languageId: string;
  readonly adapter: LanguageAdapter;
  /** The single-line comment marker this language's synthetic-source test builds with. */
  readonly lineCommentMarker: string;
  readonly fixtures: Readonly<Record<string, string>>;
  /**
   * Builds a syntactically valid source containing two long line comments --
   * `crlfComment` inside a CRLF-terminated section, `lfComment` inside an
   * LF-terminated section -- each followed by a trivial declaration so the
   * comment isn't the section's last line. Kept per-language: Java needs an
   * enclosing class for either comment to sit anywhere valid, and while a
   * *statement* like `x = 1;` needs an enclosing function in C++, a free
   * *function declaration* doesn't, which is the simpler fit here for both
   * C-family languages that don't allow top-level statements.
   */
  readonly buildMixedLineEndingSource: (crlfComment: string, lfComment: string) => string;
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

const LANGUAGE_SETS: readonly LanguageSet[] = [
  {
    languageId: 'python',
    adapter: pythonAdapter,
    lineCommentMarker: '#',
    fixtures: pythonFixtures,
    buildMixedLineEndingSource: (crlf, lf) => `${crlf}\r\nx = 1\r\n\r\n${lf}\nx = 1\n`,
  },
  {
    languageId: 'javascript',
    adapter: javascriptAdapter,
    lineCommentMarker: '//',
    fixtures: javascriptFixtures,
    buildMixedLineEndingSource: (crlf, lf) => `${crlf}\r\nx = 1;\r\n\r\n${lf}\nx = 1;\n`,
  },
  {
    languageId: 'typescript',
    adapter: typescriptAdapter,
    lineCommentMarker: '//',
    fixtures: typescriptFixtures,
    buildMixedLineEndingSource: (crlf, lf) => `${crlf}\r\nx = 1;\r\n\r\n${lf}\nx = 1;\n`,
  },
  {
    languageId: 'cpp',
    adapter: cppAdapter,
    lineCommentMarker: '//',
    fixtures: cppFixtures,
    // Free function *declarations*, not statements: unlike JS/TS/Python,
    // C++ doesn't allow a bare statement at file scope, but a function
    // declaration needs no enclosing wrapper.
    buildMixedLineEndingSource: (crlf, lf) =>
      `${crlf}\r\nvoid f1() {}\r\n\r\n${lf}\nvoid f2() {}\n`,
  },
  {
    languageId: 'java',
    adapter: javaAdapter,
    lineCommentMarker: '//',
    fixtures: javaFixtures,
    // Java allows neither a top-level statement nor a top-level method
    // declaration -- every comment here needs an enclosing class.
    buildMixedLineEndingSource: (crlf, lf) =>
      `class C {\r\n${crlf}\r\n  void f1() {}\r\n\r\n${lf}\n  void f2() {}\n}\n`,
  },
];

let parserManager: ParserManager;

beforeAll(async () => {
  parserManager = await createTestParserManager(LANGUAGE_SETS.map(({ adapter }) => adapter));
});

describe.each(LANGUAGE_SETS)(
  'line-ending preservation ($languageId)',
  ({ languageId, lineCommentMarker, fixtures, buildMixedLineEndingSource }) => {
    it("each region's own edit matches the line-ending convention actually surrounding it in a genuinely mixed-CRLF/LF file", async () => {
      // First half of the file is CRLF-terminated, second half LF -- a
      // shape `detectLineEnding`'s own whole-file heuristic can't handle
      // correctly (it would pick whichever comes first and apply it
      // everywhere). Two long comments, one in each half, both needing to
      // wrap under the column limit above.
      const crlfComment = `${lineCommentMarker} ` + 'crlf word '.repeat(6).trim();
      const lfComment = `${lineCommentMarker} ` + 'lf word '.repeat(6).trim();
      const source = buildMixedLineEndingSource(crlfComment, lfComment);

      const result = await wrapRegions(source, languageId, 'all', cfg, parserManager);
      expect(result.edits).toHaveLength(2);

      // Matched by content, not `span.startRow`, since a wrapper line
      // (Java's enclosing `class C {`) can shift which row each comment
      // actually starts on.
      const crlfEdit = result.edits.find((e) => e.newText.includes('\r\n'))!;
      const lfEdit = result.edits.find((e) => !e.newText.includes('\r\n'))!;
      expect(crlfEdit).toBeDefined();
      expect(lfEdit).toBeDefined();

      expect(crlfEdit.newText).not.toMatch(/[^\r]\n/);
      expect(lfEdit.newText).not.toContain('\r');
    });

    it('never introduces trailing whitespace on any wrapped line, across the real gold fixtures', async () => {
      for (const source of Object.values(fixtures)) {
        const result = await wrapRegions(source, languageId, 'all', cfg, parserManager);
        const wrapped = applyTextEdits(source, result.edits);
        for (const line of wrapped.split(/\r?\n/)) {
          expect(line).not.toMatch(/[ \t]$/);
        }
      }
    });

    it('preserves whether the source ends in a trailing newline, across the real gold fixtures', async () => {
      for (const source of Object.values(fixtures)) {
        const result = await wrapRegions(source, languageId, 'all', cfg, parserManager);
        const wrapped = applyTextEdits(source, result.edits);
        expect(/\n$/.test(wrapped)).toBe(/\n$/.test(source));
      }
    });

    it('contributed at least one fixture (guards against a glob silently matching nothing)', () => {
      expect(Object.keys(fixtures).length).toBeGreaterThan(0);
    });
  },
);
