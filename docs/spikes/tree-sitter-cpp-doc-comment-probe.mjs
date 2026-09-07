// Throwaway spike script -- not part of the build, not linted, not run in
// CI. Its job: verify how tree-sitter-cpp tokenizes consecutive `///`
// lines and a plain `/* */` block, before writing dissolve/emit code for
// either (this project's "probe before coding, always" rule).
//
// Run from the repo root after `npm ci`:
//
//   node docs/spikes/tree-sitter-cpp-doc-comment-probe.mjs

import { Parser, Language } from 'web-tree-sitter';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const grammarsDir = path.join(here, '..', '..', 'packages', 'engine', 'grammars');

await Parser.init();
const language = await Language.load(path.join(grammarsDir, 'tree-sitter-cpp.wasm'));
const parser = new Parser();
parser.setLanguage(language);

function dump(node, indent = '') {
  console.log(
    `${indent}${node.type} [${node.startIndex}-${node.endIndex}] row=${node.startPosition.row}-${node.endPosition.row} ${JSON.stringify(node.text.slice(0, 60))}`,
  );
  for (const child of node.children) {
    dump(child, indent + '  ');
  }
}

const src1 = `/// Brief description.\n/// More detail here that\n/// continues across lines.\nvoid f();\n`;
console.log('--- consecutive /// lines ---');
dump(parser.parse(src1).rootNode);

const src2 = `/* Plain block comment\n   spanning two lines. */\nvoid g();\n`;
console.log('\n--- plain /* */ block ---');
dump(parser.parse(src2).rootNode);

const src3 = `/// one\nint x;\n/// two, not adjacent to the first\nvoid h();\n`;
console.log('\n--- non-adjacent /// lines (should NOT merge) ---');
dump(parser.parse(src3).rootNode);

const src4 = `x = "abc";\r\n/// crlf doc line\r\nvoid f();\r\n`;
console.log('\n--- /// on CRLF source (check trailing \\r) ---');
dump(parser.parse(src4).rootNode);
