import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SyntaxNode } from '../../types/tree-sitter-types.js';
import { isAttributeDocstringPosition, isDocstringPosition } from './docstring-position.js';

const grammarPath = 'grammars/tree-sitter-python.wasm';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  const language = await Language.load(grammarPath);
  parser = new Parser();
  parser.setLanguage(language);
});

function stringNodes(source: string): SyntaxNode[] {
  const tree = parser.parse(source)!;
  return tree.rootNode.descendantsOfType('string');
}

describe('isDocstringPosition', () => {
  it('recognizes a module docstring', () => {
    const [node] = stringNodes('"""Module docstring."""\nimport os\n');
    expect(isDocstringPosition(node!)).toBe(true);
  });

  it('recognizes a module docstring preceded by a shebang and encoding comment', () => {
    const source = '#!/usr/bin/env python\n# -*- coding: utf-8 -*-\n"""Module docstring."""\n';
    const [node] = stringNodes(source);
    expect(isDocstringPosition(node!)).toBe(true);
  });

  it('recognizes a function docstring', () => {
    const [node] = stringNodes('def f():\n    """Func docstring."""\n    pass\n');
    expect(isDocstringPosition(node!)).toBe(true);
  });

  it('recognizes a function docstring preceded by a comment between the colon and body', () => {
    const source = 'def f():\n    # leading comment\n    """Func docstring."""\n    pass\n';
    const [node] = stringNodes(source);
    expect(isDocstringPosition(node!)).toBe(true);
  });

  it('recognizes a class docstring', () => {
    const [node] = stringNodes('class C:\n    """Class docstring."""\n    x = 1\n');
    expect(isDocstringPosition(node!)).toBe(true);
  });

  it('recognizes an async function docstring', () => {
    const [node] = stringNodes('async def f():\n    """Async docstring."""\n    pass\n');
    expect(isDocstringPosition(node!)).toBe(true);
  });

  it('recognizes a decorated function docstring', () => {
    const source = '@decorator\ndef f():\n    """Decorated docstring."""\n    pass\n';
    const [node] = stringNodes(source);
    expect(isDocstringPosition(node!)).toBe(true);
  });

  it('rejects a triple-quoted string that is not the first statement', () => {
    const source = 'def f():\n    x = 1\n    """Not a docstring."""\n';
    const nodes = stringNodes(source);
    const decoy = nodes.find((n) => n.text.includes('Not a docstring'))!;
    expect(isDocstringPosition(decoy)).toBe(false);
  });

  it('rejects a string that is the first statement of a non-docstring-host block', () => {
    const source = 'if True:\n    """Not a docstring -- if-blocks are not hosts."""\n';
    const [node] = stringNodes(source);
    expect(isDocstringPosition(node!)).toBe(false);
  });

  it('rejects an ordinary module-level string literal', () => {
    const source = 'import os\nx = "not a docstring"\n';
    const [node] = stringNodes(source);
    expect(isDocstringPosition(node!)).toBe(false);
  });

  it('rejects a string that is part of an implicit concatenation, even in first-statement position', () => {
    const source = '"a" "b"\n';
    const nodes = stringNodes(source);
    expect(nodes.every((n) => isDocstringPosition(n) === false)).toBe(true);
  });

  it('rejects a string that is part of a + concatenation, even in first-statement position', () => {
    const source = '"a" + "b"\n';
    const nodes = stringNodes(source);
    expect(nodes.every((n) => isDocstringPosition(n) === false)).toBe(true);
  });

  it('rejects a string that is one operand of a larger expression', () => {
    const source = 'def f():\n    return "not a docstring"\n';
    const [node] = stringNodes(source);
    expect(isDocstringPosition(node!)).toBe(false);
  });
});

describe('isAttributeDocstringPosition', () => {
  it('recognizes a bare string immediately following a plain assignment', () => {
    const source = 'RETRIES = 3\n"""Number of times to retry a failed request."""\n';
    const nodes = stringNodes(source);
    const docstring = nodes.find((n) => n.text.includes('retry'))!;
    expect(isAttributeDocstringPosition(docstring)).toBe(true);
  });

  it('recognizes a bare string following an annotated assignment', () => {
    const source = 'RETRIES: int = 3\n"""Number of times to retry a failed request."""\n';
    const nodes = stringNodes(source);
    const docstring = nodes.find((n) => n.text.includes('retry'))!;
    expect(isAttributeDocstringPosition(docstring)).toBe(true);
  });

  it('recognizes a class attribute docstring', () => {
    const source = 'class C:\n    x = 1\n    """Docs for x."""\n';
    const nodes = stringNodes(source);
    const docstring = nodes.find((n) => n.text.includes('Docs for x'))!;
    expect(isAttributeDocstringPosition(docstring)).toBe(true);
  });

  it('skips over an interleaving comment between the assignment and the docstring', () => {
    const source = 'RETRIES = 3\n# retries before giving up\n"""Number of times to retry."""\n';
    const nodes = stringNodes(source);
    const docstring = nodes.find((n) => n.text.includes('Number of times'))!;
    expect(isAttributeDocstringPosition(docstring)).toBe(true);
  });

  it('rejects a string following an augmented assignment', () => {
    // The augmented assignment is itself the "previous statement", and it
    // is not a plain/annotated assignment -- this is a decoy string, not a
    // docstring for whatever `z` was originally assigned from.
    const source = 'z = 1\nz += 1\n"""Decoy -- not an attribute docstring."""\n';
    const nodes = stringNodes(source);
    const decoy = nodes.find((n) => n.text.includes('Decoy'))!;
    expect(isAttributeDocstringPosition(decoy)).toBe(false);
  });

  it('rejects a string with no preceding statement at all', () => {
    const source = '"""Just a module docstring, not an attribute docstring."""\n';
    const [node] = stringNodes(source);
    expect(isAttributeDocstringPosition(node!)).toBe(false);
  });

  it('rejects a string following a non-assignment statement', () => {
    const source = 'import os\n"""Not an attribute docstring."""\n';
    const nodes = stringNodes(source);
    const decoy = nodes.find((n) => n.text.includes('Not an attribute'))!;
    expect(isAttributeDocstringPosition(decoy)).toBe(false);
  });

  it('rejects a string that is part of a concatenation run following an assignment', () => {
    const source = 'RETRIES = 3\n"a" "b"\n';
    const nodes = stringNodes(source);
    const parts = nodes.filter((n) => n.text === '"a"' || n.text === '"b"');
    expect(parts.every((n) => isAttributeDocstringPosition(n) === false)).toBe(true);
  });
});
