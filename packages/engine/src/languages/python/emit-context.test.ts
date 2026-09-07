import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { discoverRegions } from '../../discovery/discover-regions.js';
import type { WrapConfig } from '../../types/config.js';
import { pythonAdapter } from './adapter.js';
import { emitContext } from './emit-context.js';

const grammarPath = 'grammars/tree-sitter-python.wasm';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  const language = await Language.load(grammarPath);
  parser = new Parser();
  parser.setLanguage(language);
});

function baseConfig(overrides: Partial<WrapConfig> = {}): WrapConfig {
  return {
    columnLimit: 80,
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

/**
 * Several fixtures below deliberately discover more than one region (a
 * dict/list/tuple/set literal with an unrelated sibling string alongside
 * the concatenation run under test) -- picking by array position would be
 * fragile since which one sorts first varies by fixture shape. The
 * concatenation run under test always has more than one part; a fixture
 * with only one region falls back to it directly.
 */
function contextFor(source: string, cfg: WrapConfig = baseConfig()) {
  const tree = parser.parse(source)!;
  const regions = discoverRegions(pythonAdapter, tree, source, 'python');
  const region = regions.find((r) => r.parts.length > 1) ?? regions[regions.length - 1]!;
  return emitContext(region, tree, cfg);
}

describe('emitContext (needsParens)', () => {
  it('needs parens for a bare assignment RHS', () => {
    expect(contextFor('x = "a" "b"\n').needsParens).toBe(true);
  });

  it('needs parens for a return statement', () => {
    expect(contextFor('def f():\n    return "a" "b"\n').needsParens).toBe(true);
  });

  it('needs parens for an augmented assignment', () => {
    expect(contextFor('x += "a" "b"\n').needsParens).toBe(true);
  });

  it('needs parens for a ternary branch', () => {
    expect(contextFor('x = "a" "b" if cond else "c"\n').needsParens).toBe(true);
  });

  it('needs parens for a lambda body', () => {
    expect(contextFor('f = lambda: "a" "b"\n').needsParens).toBe(true);
  });

  it('needs parens for a boolean-operator operand', () => {
    expect(contextFor('x = cond and "a" "b"\n').needsParens).toBe(true);
  });

  it('does not need parens inside a call argument list', () => {
    expect(contextFor('foo("a" "b")\n').needsParens).toBe(false);
  });

  it('does not need parens inside a keyword argument', () => {
    expect(contextFor('foo(key="a" "b")\n').needsParens).toBe(false);
  });

  it('does not need parens inside a nested call', () => {
    expect(contextFor('foo(bar("a" "b"))\n').needsParens).toBe(false);
  });

  it('does not need parens inside a list literal', () => {
    expect(contextFor('x = ["a" "b", "c"]\n').needsParens).toBe(false);
  });

  it('does not need parens inside a dict value', () => {
    expect(contextFor('x = {"k": "a" "b"}\n').needsParens).toBe(false);
  });

  it('does not need parens inside a tuple', () => {
    expect(contextFor('x = ("a" "b", "c")\n').needsParens).toBe(false);
  });

  it('does not need parens inside a set literal', () => {
    expect(contextFor('x = {"a" "b", "c"}\n').needsParens).toBe(false);
  });

  it('does not need parens inside an already-parenthesized expression', () => {
    expect(contextFor('x = (\n    "a"\n    "b"\n)\n').needsParens).toBe(false);
  });

  it('does not need parens inside a list comprehension', () => {
    expect(contextFor('x = ["a" "b" for _ in y]\n').needsParens).toBe(false);
  });

  it('does not need parens inside a generator expression', () => {
    expect(contextFor('x = ("a" "b" for _ in y)\n').needsParens).toBe(false);
  });

  it('does not need parens for a default parameter value', () => {
    expect(contextFor('def f(x="a" "b"):\n    pass\n').needsParens).toBe(false);
  });

  it('does not need parens for a list-splat argument', () => {
    expect(contextFor('foo(*["a" "b"])\n').needsParens).toBe(false);
  });

  it('needs parens for a lone (non-concatenated) string being newly split', () => {
    expect(contextFor('x = "a"\n').needsParens).toBe(true);
  });
});

describe('emitContext (isDictKey)', () => {
  it('is true for a dict literal key', () => {
    expect(contextFor('x = {"the_key": "a" "b"}\n').isDictKey).toBe(false); // picks the concat (value)
    const tree = parser.parse('x = {"the_key": "v"}\n')!;
    const regions = discoverRegions(pythonAdapter, tree, 'x = {"the_key": "v"}\n', 'python');
    const keyRegion = regions[0]!; // "the_key" sorts before "v"
    expect(emitContext(keyRegion, tree, baseConfig()).isDictKey).toBe(true);
  });

  it('is false for a dict literal value', () => {
    expect(contextFor('x = {"k": "a" "b"}\n').isDictKey).toBe(false);
  });

  it('is false outside any dict literal', () => {
    expect(contextFor('x = "a" "b"\n').isDictKey).toBe(false);
  });
});

describe('emitContext (concatenationStyle)', () => {
  it('preserves an originally implicit run', () => {
    expect(contextFor('x = "a" "b"\n').concatenationStyle).toBe('implicit');
  });

  it('preserves an originally +-joined run', () => {
    expect(contextFor('x = "a" + "b"\n').concatenationStyle).toBe('operator');
  });

  it('defaults a lone string (nothing to preserve) to the descriptor default', () => {
    expect(contextFor('x = "a"\n').concatenationStyle).toBe('implicit');
  });

  it('honors an explicit cfg.concatStyle override over the observed style', () => {
    const cfg = baseConfig({ concatStyle: 'operator' });
    expect(contextFor('x = "a" "b"\n', cfg).concatenationStyle).toBe('operator');
  });

  it('ignores an unrecognized cfg.concatStyle value', () => {
    const cfg = baseConfig({ concatStyle: 'nonsense' });
    expect(contextFor('x = "a" + "b"\n', cfg).concatenationStyle).toBe('operator');
  });
});
