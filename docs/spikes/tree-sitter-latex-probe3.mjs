// Throwaway spike script (Write-tool-authored — see probe2.mjs's own header
// comment for why that matters here). Verifies the one remaining unknown
// flagged by markdown-latex-plan.md §6.1 before writing the LaTeX
// descriptor for commit 14: does a `line_comment` node's span include a
// trailing `\r` on a CRLF-terminated line, the same question already
// answered (and found to matter) for Python's `comment` node per
// docs/adapters.md's "CRLF handling" section?
//
// Run from the repo root after `npm ci`:
//
//   node docs/spikes/tree-sitter-latex-probe3.mjs

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

console.log('=== line_comment on CRLF-terminated line ===');
{
  const src = '\\section{Title}\r\n% a comment\r\nmore text\r\n';
  console.log('source bytes around comment:', [...src].map((c) => c.charCodeAt(0)).slice(0, 40));
  const tree = parser.parse(src);
  const [c] = findAll(tree.rootNode, 'line_comment');
  const text = src.slice(c.startIndex, c.endIndex);
  console.log('comment text:', JSON.stringify(text));
  console.log('ends with \\r?', text.endsWith('\r'));
  console.log('endPosition:', c.endPosition);
}

console.log('\n=== trailing % comment after text, CRLF ===');
{
  const src = 'text % note\r\nmore text\r\n';
  const tree = parser.parse(src);
  const [c] = findAll(tree.rootNode, 'line_comment');
  console.log('comment text:', JSON.stringify(src.slice(c.startIndex, c.endIndex)));
}

console.log('\n=== escaped percent \\% is not a comment ===');
{
  const src = 'text \\% not a comment, 100\\% done\n';
  const tree = parser.parse(src);
  const comments = findAll(tree.rootNode, 'line_comment');
  console.log('comment count (expect 0):', comments.length);
  console.log('hasError:', tree.rootNode.hasError);
}

console.log('\n=== codeLikeKeywords candidate text ===');
{
  const src = '% \\section{Old title}\n% This describes what the function does.\n';
  const tree = parser.parse(src);
  const comments = findAll(tree.rootNode, 'line_comment');
  for (const c of comments) console.log('  comment:', JSON.stringify(src.slice(c.startIndex, c.endIndex)));
}
