// Throwaway spike script (Write-tool-authored, not a bash heredoc -- see
// the commit message this feeds for why that distinction matters here:
// the Bash tool's own command-string escaping was found to silently
// mangle literal backslashes in heredoc-authored probe scripts, corrupting
// LaTeX source strings before they ever reached the parser). Continues
// docs/spikes/tree-sitter-latex-probe.mjs's own investigation for Phase D
// (LaTeX adapter) commits 14-17 -- masks, structural anchors, magic
// comments, sectioning header extents.
//
// Run from the repo root after `npm ci`:
//
//   node docs/spikes/tree-sitter-latex-probe2.mjs

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
    `${indent}${node.type} [${node.startIndex}-${node.endIndex}] row[${node.startPosition.row},${node.startPosition.column}]-[${node.endPosition.row},${node.endPosition.column}] ${JSON.stringify(text.slice(0, 60))}`,
  );
  for (const child of node.children) {
    if (child) dump(child, source, indent + '  ');
  }
}
function findAll(node, type, out = []) {
  if (node.type === type) out.push(node);
  for (const child of node.children) if (child) findAll(child, type, out);
  return out;
}

console.log('=== sanity check: real backslash survives ===');
{
  const src = '\\begin{verbatim}\nbody\n\\end{verbatim}\n';
  console.log('charCodes of first 8 chars:', [...src.slice(0, 8)].map((c) => c.charCodeAt(0)));
  const tree = parser.parse(src);
  console.log('top-level types:', tree.rootNode.children.map((c) => c.type));
}

console.log('\n=== environment classification, full list ===');
for (const name of [
  'listing',
  'minted',
  'comment',
  'verbatim',
  'lstlisting',
  'Verbatim',
  'BVerbatim',
  'alltt',
  'tikzpicture',
  'tabular',
  'tabular*',
  'tabularx',
  'array',
  'itemize',
  'abstract',
]) {
  const src = `\\begin{${name}}\nbody content\n\\end{${name}}\n`;
  const tree = parser.parse(src);
  const top = tree.rootNode.children.find((c) => c && c.type.endsWith('environment'));
  console.log(`${name}: top-level = ${top?.type ?? '(none -- see dump below)'}`);
  if (!top) dump(tree.rootNode, src);
}

console.log('\n=== magic comment %!TEX ===');
{
  const src = '%!TEX root = main.tex\ntext\n';
  const tree = parser.parse(src);
  const [c] = findAll(tree.rootNode, 'line_comment');
  console.log('comment text:', JSON.stringify(src.slice(c.startIndex, c.endIndex)));
}

console.log('\n=== %% banner comment (several %) ===');
{
  const src = '%%%%%%%%%%%%%%%%\n% Section banner\n%%%%%%%%%%%%%%%%\ntext\n';
  const tree = parser.parse(src);
  console.log('hasError:', tree.rootNode.hasError);
  const comments = findAll(tree.rootNode, 'line_comment');
  for (const c of comments) console.log('  comment:', JSON.stringify(src.slice(c.startIndex, c.endIndex)));
}

console.log('\n=== sectioning header field access ===');
{
  const src = '\\section{Title Text}\nBody paragraph one.\n\nBody paragraph two.\n';
  const tree = parser.parse(src);
  const [sec] = findAll(tree.rootNode, 'section');
  console.log('section children:', sec.children.map((c) => c?.type));
  console.log('command field:', sec.childForFieldName('command')?.type, JSON.stringify(sec.childForFieldName('command')?.text));
  for (const c of sec.children) {
    console.log('  child:', c.type, JSON.stringify(src.slice(c.startIndex, c.endIndex)).slice(0, 50));
  }
}

console.log('\n=== subsection nested inside section? ===');
{
  const src = '\\section{A}\ntext a\n\\subsection{B}\ntext b\n\\section{C}\ntext c\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

console.log('\n=== enum_item command field node type ===');
{
  const src = '\\begin{itemize}\n\\item first item\n\\item[label] second item\n\\end{itemize}\n';
  const tree = parser.parse(src);
  const items = findAll(tree.rootNode, 'enum_item');
  for (const item of items) {
    const cmd = item.childForFieldName('command');
    console.log('command field node type:', cmd?.type, 'text:', JSON.stringify(cmd?.text));
  }
}

console.log('\n=== \\newtheorem shape ===');
{
  const src = '\\newtheorem{thm}{Theorem}\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

console.log('\n=== commandRegex vs nested braces: \\newtheorem{name}[counter]{text} whole-line ===');
{
  const src = '\\newtheorem{name}[counter]{text}\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}
