// Throwaway spike script (Write-tool-authored). Investigates why an
// unterminated \begin{verbatim} produces a real parse ERROR in this
// grammar, unlike tree-sitter-markdown's own graceful "extend the fence
// to end of file" recovery for an unterminated code fence — found while
// writing commit 18's hardening test for exactly this shape of input.
//
// Run from the repo root after `npm ci`:
//
//   node docs/spikes/tree-sitter-latex-probe7.mjs

import { Parser, Language } from 'web-tree-sitter';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const grammarsDir = path.join(here, '..', '..', 'packages', 'engine', 'grammars');

await Parser.init();
const language = await Language.load(path.join(grammarsDir, 'tree-sitter-latex.wasm'));
const parser = new Parser();
parser.setLanguage(language);

function dump(node, source, indent = '') {
  const text = source.slice(node.startIndex, node.endIndex);
  console.log(
    `${indent}${node.type}${node.isError ? ' [ERROR]' : ''} [${node.startPosition.row},${node.startPosition.column}]-[${node.endPosition.row},${node.endPosition.column}] ${JSON.stringify(text.slice(0, 40))}`,
  );
  for (const child of node.children) {
    if (child) dump(child, source, indent + '  ');
  }
}

console.log('=== unterminated \\begin{verbatim} ===');
{
  const src = '\\begin{verbatim}\nsome code\n\nSome text after that never closes the environment.\n';
  const tree = parser.parse(src);
  console.log('hasError:', tree.rootNode.hasError);
  dump(tree.rootNode, src);
}

console.log('\n=== unterminated \\begin{itemize} (ordinary environment, not raw-content) ===');
{
  const src = '\\begin{itemize}\n\\item first item\n';
  const tree = parser.parse(src);
  console.log('hasError:', tree.rootNode.hasError);
  dump(tree.rootNode, src);
}

console.log('\n=== unterminated \\section{ (unclosed brace) ===');
{
  const src = '\\section{Unclosed title\nBody text follows.\n';
  const tree = parser.parse(src);
  console.log('hasError:', tree.rootNode.hasError);
  dump(tree.rootNode, src);
}
