// Throwaway spike script (Write-tool-authored). Verifies the exact
// escaping rule for a trailing `%` comment before implementing commit
// 17's trailing-comment safety in the LaTeX adapter -- specifically,
// whether `\\%` (an escaped backslash followed by an unescaped %) really
// does start a real comment, the same parity question Markdown's own
// hard-break backslash detection needed (../markdown/hard-break.ts).
//
// Run from the repo root after `npm ci`:
//
//   node docs/spikes/tree-sitter-latex-probe6.mjs

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

function report(label, src) {
  const tree = parser.parse(src);
  const comments = findAll(tree.rootNode, 'line_comment');
  console.log(`${label}: source=${JSON.stringify(src)}`);
  console.log(
    `  comments found: ${comments.length}`,
    comments.map((c) => JSON.stringify(src.slice(c.startIndex, c.endIndex))),
  );
  console.log(`  hasError: ${tree.rootNode.hasError}`);
}

// 0 backslashes before % (bare %): real comment.
report('bare %', 'text % note\n');
// 1 backslash: \% escaped percent, no comment.
report('1 backslash (\\%)', 'text \\% not a comment\n');
// 2 backslashes: \\ is a complete line-break command; % after it should be a REAL comment.
report('2 backslashes (\\\\%)', 'text \\\\% real comment after linebreak\n');
// 3 backslashes: \\ (linebreak) + \% (escaped) -- no comment.
report('3 backslashes (\\\\\\%)', 'text \\\\\\% not a comment\n');
// 4 backslashes: \\ \\ (two linebreaks) + real comment.
report('4 backslashes (\\\\\\\\%)', 'text \\\\\\\\% real comment\n');
// Two % on one line: first escaped, second real.
report('escaped then real', 'text \\% percent sign, then % a real comment\n');
