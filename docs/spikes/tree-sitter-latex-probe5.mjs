// Throwaway spike script (Write-tool-authored, per this session's
// established discipline). Verifies \label's node type and the exact
// shape of a chained \section{Title}\label{sec:foo} line, before fixing
// the multi-command structural-line gap in
// packages/engine/src/languages/latex/discover-prose.ts.
//
// Run from the repo root after `npm ci`:
//
//   node docs/spikes/tree-sitter-latex-probe5.mjs

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
    `${indent}${node.type} [${node.startPosition.row},${node.startPosition.column}]-[${node.endPosition.row},${node.endPosition.column}] ${JSON.stringify(text.slice(0, 50))}`,
  );
  for (const child of node.children) {
    if (child) dump(child, source, indent + '  ');
  }
}

console.log('=== \\label{sec:foo} alone ===');
{
  const src = '\\label{sec:foo}\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

console.log('\n=== \\section{Title}\\label{sec:foo} chained on one line ===');
{
  const src = '\\section{Title}\\label{sec:foo}\nBody text.\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

console.log('\n=== \\section{Title}\\label{sec:foo} with a space between ===');
{
  const src = '\\section{Title} \\label{sec:foo}\nBody text.\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

console.log('\n=== \\item \\label{item:foo} chained inside enum_item ===');
{
  const src = '\\begin{itemize}\n\\item \\label{item:foo} Item text.\n\\end{itemize}\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}
