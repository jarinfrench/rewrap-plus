import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { discoverRegions } from '../../src/discovery/discover-regions.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { markdownAdapter } from '../../src/languages/markdown/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

/**
 * Zero-edit gold fixtures for every §5.6 "never a region" node type, plus
 * the two §5.2 discovery-level exclusions (a footnote definition, a `$$`
 * display-math paragraph) — `docs/planning/markdown-latex-plan.md` Phase
 * C commit 9. Each fixture is verified two ways:
 *
 * - **Discovery-level**: `discoverRegions` (real `markdownAdapter`, real
 *   grammar) produces zero `'prose'` regions for a fixture whose entire
 *   content is the excluded construct — proving the exclusion happens at
 *   *discovery*, the same "never even a candidate" standard
 *   `docs/adapters.md`'s Java text-block negative fixture already
 *   established, not merely a decline further down the pipeline.
 * - **End-to-end**: `wrapRegions` produces byte-identical output. This is
 *   the more familiar gold-fixture shape, but it's not yet a meaningful
 *   *second* proof on its own: `markdownAdapter.wrapProse` doesn't exist
 *   until commit 10, so every Markdown source produces zero edits
 *   regardless of content right now. Kept anyway (not deferred to a later
 *   commit) so these exact fixture files stay valid, unchanged, once
 *   `wrapProse` lands — a real second signal from that point on, a
 *   trivial one until then.
 *
 * A future grammar upgrade that reclassifies any of these node types (or
 * changes what `hasError` reports for one) fails one of these fixtures by
 * name, rather than silently changing what this adapter wraps.
 */
const verbatimFixtures = import.meta.glob('../fixtures/markdown/verbatim/**/*.in.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const paragraphNegFixtures = import.meta.glob('../fixtures/markdown/paragraphs/neg-*.in.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const mathNegFixtures = import.meta.glob('../fixtures/markdown/math/neg-*.in.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const allFixtures: Record<string, string> = {
  ...verbatimFixtures,
  ...paragraphNegFixtures,
  ...mathNegFixtures,
};

function outPathFor(inPath: string): string {
  return inPath.replace(/\.in\.md$/, '.out.md');
}

const verbatimOutFixtures = import.meta.glob('../fixtures/markdown/verbatim/**/*.out.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const paragraphNegOutFixtures = import.meta.glob('../fixtures/markdown/paragraphs/neg-*.out.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const mathNegOutFixtures = import.meta.glob('../fixtures/markdown/math/neg-*.out.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const outFixtures: Record<string, string> = {
  ...verbatimOutFixtures,
  ...paragraphNegOutFixtures,
  ...mathNegOutFixtures,
};

function config(overrides: Partial<WrapConfig> = {}): WrapConfig {
  return {
    columnLimit: 60,
    tabSize: 4,
    wrapComments: true,
    wrapStrings: true,
    stringPolicy: 'all',
    docDialect: 'auto',
    preserveIndentedBlocks: false,
    balancedWrapping: false,
    ...overrides,
  };
}

const engineRoot = '.';

let parserManager: ParserManager;
let parser: Parser;

beforeAll(async () => {
  const registry = new AdapterRegistry();
  registry.register(markdownAdapter);
  parserManager = await ParserManager.create({ wasmDir: engineRoot, registry });

  await Parser.init();
  const language = await Language.load('grammars/tree-sitter-markdown.wasm');
  parser = new Parser();
  parser.setLanguage(language);
});

describe('Markdown — §5.6/§5.2 exclusions never produce a region', () => {
  const entries = Object.entries(allFixtures).sort(([a], [b]) => a.localeCompare(b));

  it('the fixture glob actually found fixtures (guards against a silently-empty glob)', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)('%s: discovers zero prose regions', (path, source) => {
    const tree = parser.parse(source)!;
    const regions = discoverRegions(markdownAdapter, tree, source, 'markdown');
    expect(regions).toEqual([]);
  });

  it.each(entries)('%s: matches its .out.md fixture', (path, source) => {
    const outPath = outPathFor(path);
    const expected = outFixtures[outPath];
    if (expected === undefined) {
      throw new Error(`test setup: no matching .out.md found for ${path} (looked for ${outPath})`);
    }
    expect(source).toBe(expected);
  });

  it.each(entries)('%s: wrapRegions produces zero edits end to end', async (_path, source) => {
    const result = await wrapRegions(source, 'markdown', 'all', config(), parserManager);
    const actual = applyTextEdits(source, result.edits);
    expect(actual).toBe(source);
  });
});
