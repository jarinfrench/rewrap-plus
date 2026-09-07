// Throwaway spike script (Write-tool-authored -- see probe2.mjs's own
// header comment for why). Fills the last gaps before writing commit 15's
// discoverProse masked line scan: exact node type names for every
// standard LaTeX sectioning command (only 'section'/'subsection' were
// directly confirmed so far), and the enum_item label-field shape with an
// optional label present vs absent, on real multi-line input.
//
// Run from the repo root after `npm ci`:
//
//   node docs/spikes/tree-sitter-latex-probe4.mjs

import { Parser, Language } from 'web-tree-sitter';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const grammarsDir = path.join(here, '..', '..', 'packages', 'engine', 'grammars');

await Parser.init();
const language = await Language.load(path.join(grammarsDir, 'tree-sitter-latex.wasm'));
const parser = new Parser();
parser.setLanguage(language);

function findAll(node, type, out = []) {
  if (node.type === type) out.push(node);
  for (const child of node.children) if (child) findAll(child, type, out);
  return out;
}

console.log('=== sectioning command node type names ===');
for (const cmd of ['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph']) {
  const src = `\\${cmd}{Title text}\nBody sentence here.\n`;
  const tree = parser.parse(src);
  const top = tree.rootNode.children[0];
  console.log(`\\${cmd}: top-level node type = ${top?.type}, children = ${top?.children.map((c) => c?.type)}`);
}

console.log('\n=== starred variant: \\section*{Title} ===');
{
  const src = '\\section*{Title text}\nBody.\n';
  const tree = parser.parse(src);
  const top = tree.rootNode.children[0];
  console.log('type:', top?.type, 'children:', top?.children.map((c) => c?.type));
}

console.log('\n=== enum_item: label present vs absent, multi-item list ===');
{
  const src =
    '\\begin{itemize}\n\\item First item text here.\n\\item[custom] Second item with a label.\n\\end{itemize}\n';
  const tree = parser.parse(src);
  const items = findAll(tree.rootNode, 'enum_item');
  for (const item of items) {
    const command = item.childForFieldName('command');
    const label = item.childForFieldName('label');
    console.log(
      `item at row ${item.startPosition.row}: command end=${JSON.stringify(command?.endPosition)}, label=${label ? JSON.stringify({ type: label.type, text: label.text, end: label.endPosition }) : 'none'}`,
    );
  }
}

console.log('\n=== generic_command header shape: \\maketitle alone, \\newpage alone ===');
for (const cmd of ['maketitle', 'newpage', 'clearpage', 'noindent']) {
  const src = `\\${cmd}\nBody.\n`;
  const tree = parser.parse(src);
  const top = tree.rootNode.children[0];
  console.log(`\\${cmd}: type=${top?.type}, end=${JSON.stringify(top?.endPosition)}`);
}

console.log('\n=== nested-brace section title, header end column ===');
{
  const src = '\\section{Title with \\emph{nested} braces}\nBody text.\n';
  const tree = parser.parse(src);
  const [sec] = findAll(tree.rootNode, 'section');
  const titleGroup = sec.children[1];
  console.log('title group type:', titleGroup?.type, 'end:', JSON.stringify(titleGroup?.endPosition));
  console.log('full line length:', src.split('\n')[0].length);
}

console.log('\n=== \\[ ... \\] display math node type and row span ===');
{
  const src = 'Text before.\n\\[\nx = y + z\n\\]\nText after.\n';
  const tree = parser.parse(src);
  const top = tree.rootNode.children.map((c) => c.type);
  console.log('top-level node types:', top);
  const [eq] = findAll(tree.rootNode, 'displayed_equation');
  console.log('displayed_equation rows:', eq?.startPosition.row, '-', eq?.endPosition.row);
}
