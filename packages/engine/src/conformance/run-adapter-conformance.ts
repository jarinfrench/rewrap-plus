import { Query } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry, validateDescriptor } from '../adapter-registry.js';
import { ParserManager } from '../parser/parser-manager.js';
import { parseWithErrors } from '../parser/parse-result.js';
import { applyTextEdits } from '../apply-edits.js';
import { detectLineEnding } from '../detect-line-ending.js';
import type { LanguageAdapter } from '../types/adapter.js';
import type { WrapConfig } from '../types/config.js';
import { wrapRegions } from '../wrap.js';

/**
 * Fixtures a single `runAdapterConformance` call needs from the adapter
 * it's checking.
 *
 * Deliberately narrow — every field here is *source text*, not
 * hand-built engine types, matching this package's established
 * fixture-driven convention (this package's own gold-fixture tests never
 * hand-build `WrappableRegion`s either). Adding a language is meant to
 * mean "write a descriptor plus fixtures," and fixtures here means
 * exactly that: files, not code.
 */
export interface ConformanceFixtures {
  /**
   * Base directory `LanguageDescriptor.grammarWasm` paths resolve
   * against — see `ParserManagerOptions.wasmDir`'s own doc comment. In
   * this package's own tests this is `'.'`, matching every other
   * grammar-loading test (`ParserManager` resolves against Vitest's
   * cwd, the package root).
   */
  readonly wasmDir: string;

  /** Column limit every wrap-based check in this suite wraps at. */
  readonly columnLimit: number;

  /**
   * One or more realistic source snippets, each containing at least one
   * *region* — a line-comment block, a string literal, a `'prose'`
   * paragraph, whichever kind(s) this adapter actually produces — that
   * overflows `columnLimit` and so actually needs wrapping. Every
   * wrap-based invariant (idempotency, re-parse cleanliness, line-length,
   * line-ending preservation) runs once per entry — a conformance
   * failure names which source it was found in. Generalized from an
   * earlier "at least one line-comment block" wording once a `'prose'`
   * adapter's own sources (Markdown/LaTeX paragraphs, with no
   * line-comment concept at all for Markdown) needed to satisfy the same
   * contract.
   *
   * Deliberately plural: a single snippet can't exercise both a CRLF
   * and an LF source's line-ending preservation in one pass, and a
   * conformance kit that only ever proved itself against one shape of
   * input would be a weaker gate than this kit is meant to provide.
   */
  readonly sources: readonly string[];
}

const CONFIG: Omit<WrapConfig, 'columnLimit'> = {
  tabSize: 4,
  wrapComments: true,
  wrapStrings: false,
  stringPolicy: 'off',
  docDialect: 'plain',
  preserveIndentedBlocks: false,
  balancedWrapping: false,
};

/**
 * A parameterized `describe` block every `LanguageAdapter` must pass,
 * asserting the language-independent invariants that keep any adapter
 * honest before other code hardens around whatever one adapter (Python)
 * happens to do. Call this once per adapter, inside an ordinary Vitest
 * test file — it registers its own `describe`/`it` blocks, the same
 * pattern this package already uses for fixture-driven suites (e.g.
 * `test/wrap/python-comment-wrap-fixtures.test.ts`), just parameterized
 * over an adapter instead of hardcoded to Python's.
 *
 * This is the deliverable that makes new languages cheap: adding a
 * language means writing a descriptor plus fixtures and calling this
 * one function, not designing a test strategy from scratch.
 *
 * Every invariant below is named in the doc comment of the `it` block
 * that checks it.
 */
export function runAdapterConformance(
  adapter: LanguageAdapter,
  fixtures: ConformanceFixtures,
): void {
  const { descriptor } = adapter;
  const cfg: WrapConfig = { ...CONFIG, columnLimit: fixtures.columnLimit };

  describe(`adapter conformance: ${descriptor.id}`, () => {
    let parserManager: ParserManager;

    beforeAll(async () => {
      const registry = new AdapterRegistry();
      registry.register(adapter);
      parserManager = await ParserManager.create({ wasmDir: fixtures.wasmDir, registry });
    });

    /** "Descriptor validates" */
    it('descriptor passes structural validation', () => {
      expect(() => validateDescriptor(descriptor, adapter.discoverProse !== undefined)).not.toThrow();
    });

    /** "All tree-sitter queries compile against the grammar" */
    it('every declared query compiles against the grammar', async () => {
      const parser = await parserManager.parserFor(descriptor.id);
      const language = parser.language;
      expect(language).not.toBeNull();

      // `queries.comments`/`.strings`/`.prose` are each optional as of the
      // `'prose'` region kind (`docs/planning/markdown-latex-plan.md`
      // §3.2) — a prose-only adapter (Markdown) declares `queries.prose`
      // and neither of the other two; a masked-line-scan prose adapter
      // (LaTeX) declares none of the three query fields at all and relies
      // entirely on its own `discoverProse` hook, which has no query
      // source for this test to compile in the first place. Each is
      // therefore compiled only when actually declared.
      if (descriptor.queries.comments) {
        expect(() => new Query(language!, descriptor.queries.comments!).delete()).not.toThrow();
      }
      if (descriptor.queries.strings) {
        expect(() => new Query(language!, descriptor.queries.strings!).delete()).not.toThrow();
      }
      if (descriptor.queries.prose) {
        expect(() => new Query(language!, descriptor.queries.prose!).delete()).not.toThrow();
      }
      if (descriptor.queries.concatenations) {
        expect(() => new Query(language!, descriptor.queries.concatenations!).delete()).not.toThrow();
      }
    });

    describe.each(fixtures.sources.map((source, index) => [index, source] as const))(
      'source fixture #%i',
      (_index, source) => {
        /**
         * "Wrapping is idempotent across all of the adapter's fixtures"
         * and, in the same pass, "already-wrapped input is
         * byte-identical" — re-wrapping the *result* of a first wrap
         * must produce no further edits, which is exactly what both of
         * those invariants require: a first wrap may legitimately
         * change the file, but its own output must already be a fixed
         * point.
         */
        it('is idempotent: wrapping the wrapped output produces no further edits', async () => {
          const first = await wrapRegions(source, descriptor.id, 'all', cfg, parserManager);
          const wrapped = applyTextEdits(source, first.edits);

          const second = await wrapRegions(wrapped, descriptor.id, 'all', cfg, parserManager);
          expect(second.edits).toEqual([]);
        });

        /** "Output re-parses with zero error nodes" */
        it('wrapped output re-parses with zero error nodes', async () => {
          const result = await wrapRegions(source, descriptor.id, 'all', cfg, parserManager);
          const wrapped = applyTextEdits(source, result.edits);

          const parser = await parserManager.parserFor(descriptor.id);
          const { hasErrors } = parseWithErrors(parser, wrapped);
          expect(hasErrors).toBe(false);
        });

        /**
         * "No line exceeds the limit except a lone unbreakable atom"
         *
         * Scoped to `result.edits[*].newText` — exactly the text
         * `wrapRegions` produced — rather than every line of the
         * reassembled file. Scanning the whole file would also catch
         * untouched original code lines that happen to be long for
         * reasons that have nothing to do with wrapping (a legitimately
         * over-limit line the source already had, outside any wrapped
         * region), which this invariant was never meant to constrain.
         */
        it('produces no reflowed line over the limit, except a lone unbreakable atom', async () => {
          const result = await wrapRegions(source, descriptor.id, 'all', cfg, parserManager);

          for (const edit of result.edits) {
            for (const line of edit.newText.split(/\r?\n/)) {
              if (line.length <= fixtures.columnLimit) {
                continue;
              }
              const stripped = stripKnownCommentDecoration(
                line,
                descriptor,
                adapter.discoverProse !== undefined,
              );
              if (stripped === null) {
                continue; // a bare delimiter-only line (e.g. block open/close alone) — never content, never the concern here
              }
              // Legitimate only if the line is a single unbreakable
              // token after its decoration — assert there's no interior
              // space beyond the decoration's own separating space.
              expect(stripped).not.toMatch(/ /);
            }
          }
        });

        /**
         * "Line endings, trailing whitespace, and file-final newline
         * preserved"
         */
        it("preserves the source's line-ending convention", async () => {
          const result = await wrapRegions(source, descriptor.id, 'all', cfg, parserManager);
          const wrapped = applyTextEdits(source, result.edits);

          expect(detectLineEnding(wrapped)).toBe(detectLineEnding(source));
          if (detectLineEnding(source) === '\r\n') {
            // Every line break in the output is part of a `\r\n` pair —
            // no bare `\n` snuck in from an emit path that forgot to
            // match source convention (`docs/adapters.md`, "CRLF
            // handling", is the concrete bug this guards against).
            expect(wrapped).not.toMatch(/[^\r]\n/);
          } else {
            expect(wrapped).not.toContain('\r');
          }
        });

        /**
         * Deliberately kept strict, with **no** carve-out for a `'prose'`
         * region's own two-space hard break
         * (`docs/planning/markdown-latex-plan.md` §4.2/§4.6) — a
         * Markdown paragraph line ending in exactly two spaces is real,
         * intentional trailing whitespace that must survive a wrap
         * (`../prose/dissolve-prose.ts` glues it onto the preceding
         * atom's own text for exactly this reason). Rather than loosen
         * this invariant to tolerate it, this kit's own conformance
         * *sources* are expected to avoid two-space hard breaks
         * entirely — the one legitimate trailing whitespace in the whole
         * project is tested for real in the Markdown adapter's own gold
         * fixtures (`docs/planning/markdown-latex-plan.md` §8.2's
         * `paragraphs` fixture directory, "each hard-break form"), where
         * a `WrappableRegion`-aware test can assert *which* line is
         * allowed to carry it, rather than this kit's own flat
         * before/after string comparison, which has no way to
         * distinguish "expected" trailing whitespace from a real
         * regression. Decided here rather than deferred, since the
         * alternative (loosening this check) would have silently
         * widened what every *other* language's conformance run
         * tolerates too.
         */
        it('never introduces trailing whitespace on a changed line', async () => {
          const result = await wrapRegions(source, descriptor.id, 'all', cfg, parserManager);
          const wrapped = applyTextEdits(source, result.edits);

          for (const line of wrapped.split(/\r?\n/)) {
            expect(line).not.toMatch(/[ \t]$/);
          }
        });

        it('preserves whether the source ends in a trailing newline', async () => {
          const result = await wrapRegions(source, descriptor.id, 'all', cfg, parserManager);
          const wrapped = applyTextEdits(source, result.edits);

          const sourceEndsWithNewline = /\r?\n$/.test(source);
          const wrappedEndsWithNewline = /\r?\n$/.test(wrapped);
          expect(wrappedEndsWithNewline).toBe(sourceEndsWithNewline);
        });
      },
    );
  });
}

/**
 * Strip whatever comment (or, for a prose-capable adapter, prose
 * continuation-prefix) decoration a wrapped line should carry, leaving
 * just the content the reflow algorithm actually chose to place there.
 * Returns `null` for a line that's nothing but a bare delimiter (a block
 * comment's open or close line alone), which is never itself "content"
 * and so never the concern of the over-limit check this feeds.
 *
 * Tries the line-comment marker first, then the block continuation
 * prefix, then the block open/close delimiters — whichever the
 * descriptor actually declares — then, for a prose-capable adapter, a
 * `'prose'` region's own continuation prefix (see `isProseCapable`'s own
 * doc comment below). A line matching none of them (shouldn't happen for
 * anything `wrapRegions` itself produces, but this is defensive rather
 * than assumed) is returned as-is, whitespace-trimmed, so the check
 * still has *something* meaningful to assert against rather than
 * silently skipping.
 */
function stripKnownCommentDecoration(
  line: string,
  descriptor: LanguageAdapter['descriptor'],
  isProseCapable: boolean,
): string | null {
  const trimmedStart = line.replace(/^\s*/, '');

  const marker = descriptor.comments.line?.marker;
  if (marker !== undefined && trimmedStart.startsWith(marker)) {
    const rest = trimmedStart.slice(marker.length);
    return rest.startsWith(' ') ? rest.slice(1) : rest;
  }

  const block = descriptor.comments.block;
  if (block) {
    if (trimmedStart === block.open || trimmedStart === block.close) {
      return null; // bare delimiter line — no content to check
    }
    if (block.continuationPrefix && trimmedStart.startsWith(block.continuationPrefix)) {
      const rest = trimmedStart.slice(block.continuationPrefix.length);
      return rest.startsWith(' ') ? rest.slice(1) : rest;
    }
    if (trimmedStart.startsWith(block.open)) {
      return trimmedStart.slice(block.open.length).trim();
    }
  }

  if (isProseCapable) {
    // `docs/planning/markdown-latex-plan.md` §4.6: this kit has no
    // `WrappableRegion` in hand at this point, only a flat already-
    // wrapped line, so it can't know the exact per-region
    // `continuationPrefix` a real `wrapProse` call computed (§5.3's
    // block-quote/list-hanging-indent derivation, which varies by
    // container nesting within one region, let alone across regions).
    // Loosened, rather than exact, on purpose: strip a maximal leading
    // run of `>` and horizontal whitespace, which covers every real
    // continuation-prefix shape that derivation produces (`>`, `>> `,
    // list hanging indent, a LaTeX `\item`'s own indent, ...) without
    // reconstructing it here. `isProseCapable` — "does this adapter
    // implement `discoverProse`," passed by the caller, which has the
    // adapter — rather than a descriptor-only signal like
    // `queries.prose`, since LaTeX's prose discovery declares no
    // `queries.prose` at all (`docs/planning/markdown-latex-plan.md`
    // §3.2/§6.2: no paragraph node exists to query) and would otherwise
    // fall through this check for the one adapter it's also needed for.
    // Revisit for the exact "run discoverRegions and match by region"
    // approach the plan's own §4.6 names as the fallback, if this
    // heuristic ever proves visibly wrong against a real fixture — not
    // before, since no real prose adapter exists yet to test it against.
    return trimmedStart.replace(/^[> \t]*/, '');
  }

  return trimmedStart;
}
