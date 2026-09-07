import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseWithErrors } from './parse-result.js';

// Relative to the process's cwd, which Vitest sets to this package's root
// (`packages/engine`). No `node:url`/`import.meta.url` here -- this
// package's tests avoid depending on `@types/node` (see
// `../types/position-mapper.test.ts`).
const grammarPath = 'grammars/tree-sitter-python.wasm';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  const language = await Language.load(grammarPath);
  parser = new Parser();
  parser.setLanguage(language);
});

describe('parseWithErrors', () => {
  it('reports no errors for valid Python', () => {
    const source = 'def greet(name):\n    """Say hello."""\n    return "hello, " + name\n';

    const result = parseWithErrors(parser, source);

    expect(result.hasErrors).toBe(false);
    expect(result.errorSpans).toEqual([]);
    expect(result.tree.rootNode.type).toBe('module');
  });

  it('reports an error span for a syntactically broken function', () => {
    // Missing closing paren and body.
    const source = 'def greet(name:\n    return "hi"\n';

    const result = parseWithErrors(parser, source);

    expect(result.hasErrors).toBe(true);
    expect(result.errorSpans.length).toBeGreaterThan(0);
    // The error region starts at the malformed `def` line, not mid-file.
    expect(result.errorSpans[0]!.startRow).toBe(0);
  });

  it("does not let one broken region hide an otherwise-valid file's structure", () => {
    const source = [
      'def good_one():',
      '    return 1',
      '',
      'def broken(',
      '',
      'def good_two():',
      '    return 2',
      '',
    ].join('\n');

    const result = parseWithErrors(parser, source);

    expect(result.hasErrors).toBe(true);
    // The well-formed function is still discoverable as an ordinary named
    // node elsewhere in the tree -- the error is localized, not a parse
    // failure for the whole file. (Region discovery is responsible for
    // skipping only *overlapping* regions; this just proves the tree
    // still carries the information that logic needs.)
    const functionNames = result.tree.rootNode
      .descendantsOfType('function_definition')
      .map((node) => node?.childForFieldName('name')?.text);
    expect(functionNames).toContain('good_one');
  });

  it('reports a span for a MISSING node without needing an enclosing ERROR', () => {
    // tree-sitter often recovers a single missing token (e.g. a closing
    // bracket) by inserting a MISSING node rather than wrapping the
    // region in an ERROR node.
    const source = 'x = [1, 2, 3\n';

    const result = parseWithErrors(parser, source);

    expect(result.hasErrors).toBe(true);
    expect(result.errorSpans.length).toBeGreaterThan(0);
  });

  it('reports one span per error region rather than nested duplicates', () => {
    const source = 'def greet(name:\n    return "hi"\n';

    const result = parseWithErrors(parser, source);

    // An early spike (see docs/spikes/tree-sitter-wasm-loading.mjs)
    // observed *two* ERROR nodes for this input -- an outer one at [0, 31)
    // and one nested inside it at [20, 26). Asserting exactly one span
    // here (rather than just >0) is the actual regression guard: it
    // confirms `collectErrorSpans` stops at the first ERROR/MISSING node
    // on each path rather than also walking into and re-reporting its
    // descendants.
    expect(result.errorSpans.length).toBe(1);
  });
});
