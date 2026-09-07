// Throwaway spike script -- not part of the build, not linted, not run in
// CI. Its job: verify the LaTeX grammar's node names/shapes (built from
// @pfoerster/tree-sitter-latex@0.6.0 per Sec. 3.1 of
// docs/planning/markdown-latex-plan.md) and the Sec. 6.1/Sec. 6.2 assumptions
// before writing the LaTeX adapter, per this project's "probe before
// coding, always" rule. Findings are written up in docs/parsing.md
// (Finding 8); this file is kept only so the experiment is reproducible.
//
// Run from the repo root after `npm ci`, with WASM_PATH pointing at either
// the scratch-built copy or the vendored file:
//
//   WASM_PATH=/path/to/tree-sitter-latex.wasm node docs/spikes/tree-sitter-latex-probe.mjs
//
// Defaults to the vendored location if WASM_PATH is unset.

import { Parser, Language, LANGUAGE_VERSION, MIN_COMPATIBLE_VERSION } from 'web-tree-sitter';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const wasmPath =
  process.env.WASM_PATH ??
  path.join(repoRoot, 'packages', 'engine', 'grammars', 'tree-sitter-latex.wasm');

await Parser.init();

const loadStart = performance.now();
const language = await Language.load(wasmPath);
const loadMs = performance.now() - loadStart;
console.log('wasm:', wasmPath);
console.log(
  'ABI: language=%d, supported=[%d, %d]',
  language.abiVersion,
  MIN_COMPATIBLE_VERSION,
  LANGUAGE_VERSION,
);
console.log('Language.load latency: %dms', loadMs.toFixed(1));

const parser = new Parser();
parser.setLanguage(language);

function dump(node, source, indent = '') {
  const text = source.slice(node.startIndex, node.endIndex);
  console.log(
    `${indent}${node.type} [${node.startIndex}-${node.endIndex}] row[${node.startPosition.row},${node.startPosition.column}]-[${node.endPosition.row},${node.endPosition.column}] ${JSON.stringify(text.slice(0, 50))}`,
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

// --- first-parse latency, on a small then a larger doc ---
console.log('\n=== 1. first-parse latency ===');
{
  const small = '\\section{Intro}\nSome text here.\n';
  const t0 = performance.now();
  parser.parse(small);
  console.log('first parse (33 bytes): %dms', (performance.now() - t0).toFixed(1));

  const t1 = performance.now();
  parser.parse(small);
  console.log('second parse, same content (33 bytes): %dms', (performance.now() - t1).toFixed(1));
}

// --- 2. `\\` -- generic_command with command '\\', or a dedicated node? ---
console.log('\n=== 2. \\\\ (line break command) node shape ===');
{
  const src = 'first line \\\\\nsecond line\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

// --- 3. generic_command basic shape ---
console.log('\n=== 3. generic_command with one arg ===');
{
  const src = '\\textbf{bold text}\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
  const cmd = findAll(tree.rootNode, 'generic_command')[0];
  console.log('command field:', cmd?.childForFieldName('command')?.type, cmd?.childForFieldName('command')?.text);
}

// --- 4. environments: which arrive as math_environment vs generic_environment ---
console.log('\n=== 4. environment classification ===');
for (const envName of ['align', 'equation', 'gather', 'multline', 'displaymath', 'math', 'alltt', 'verbatim', 'tabular', 'tikzpicture', 'abstract', 'itemize']) {
  const src = `\\begin{${envName}}\nbody\n\\end{${envName}}\n`;
  const tree = parser.parse(src);
  const top = tree.rootNode.children.find((c) => c && c.type.endsWith('environment'));
  console.log(`${envName}: top-level node type = ${top?.type ?? '(none found -- dumping)'}`);
  if (!top) dump(tree.rootNode, src);
}

// --- 5. generic_environment begin/end field shape ---
console.log('\n=== 5. generic_environment begin/end fields ===');
{
  const src = '\\begin{myenv}[opt]{lang}\nbody text\n\\end{myenv}\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
  const env = findAll(tree.rootNode, 'generic_environment')[0];
  const begin = env?.childForFieldName('begin');
  console.log('begin node type:', begin?.type);
  if (begin) {
    console.log('begin children:', begin.children.map((c) => c?.type));
    console.log('begin.command:', begin.childForFieldName('command')?.text);
    console.log('begin.name:', begin.childForFieldName('name')?.text);
    console.log('begin.options:', begin.childForFieldName('options')?.text);
  }
}

// --- 6. line_comment on CRLF ---
console.log('\n=== 6. line_comment CRLF handling ===');
{
  const src = '% a comment\r\ntext after\r\n';
  const tree = parser.parse(src);
  const comment = findAll(tree.rootNode, 'line_comment')[0];
  const commentText = comment ? src.slice(comment.startIndex, comment.endIndex) : undefined;
  console.log('line_comment text:', JSON.stringify(commentText));
  console.log('ends with \\r:', (commentText ?? '').endsWith('\r'));
}
console.log('\n=== 6b. line_comment on multiple CRLF lines (not just last) ===');
{
  const src = '% first\r\n% second\r\ntext\r\n';
  const tree = parser.parse(src);
  const comments = findAll(tree.rootNode, 'line_comment');
  for (const c of comments) {
    const text = src.slice(c.startIndex, c.endIndex);
    console.log('line_comment:', JSON.stringify(text), 'endsWithCR:', text.endsWith('\r'));
  }
}

// --- 7. enum_item command/label fields ---
console.log('\n=== 7. enum_item shape ===');
{
  const src = '\\begin{itemize}\n\\item first item\n\\item[label] second item\n\\end{itemize}\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
  const items = findAll(tree.rootNode, 'enum_item');
  for (const item of items) {
    console.log('enum_item:', JSON.stringify(src.slice(item.startIndex, item.endIndex)));
    console.log('  command field:', item.childForFieldName('command')?.text);
    console.log('  label field:', item.childForFieldName('label')?.text ?? '(none)');
  }
}

// --- 8. sectioning node extent: does body live inside the section node? ---
console.log('\n=== 8. sectioning node extent ===');
{
  const src = '\\section{Title}\nBody paragraph one.\n\nBody paragraph two.\n\\section{Next}\nMore.\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
  const sections = findAll(tree.rootNode, 'section');
  console.log('section count:', sections.length);
  if (sections[0]) {
    console.log('section[0] span:', JSON.stringify(src.slice(sections[0].startIndex, sections[0].endIndex)));
  }
}

// --- 9. text/word fragmentation ---
console.log('\n=== 9. word node fragmentation on punctuation ===');
{
  const src = 'a-word, another(paren) and#hash\n';
  const tree = parser.parse(src);
  const words = findAll(tree.rootNode, 'word');
  console.log('word count:', words.length);
  for (const w of words) console.log('  word:', JSON.stringify(src.slice(w.startIndex, w.endIndex)));
}

// --- 10. whole-line command regex vs tree: nested braces ---
console.log('\n=== 10. whole-line command with nested braces ===');
{
  const src = '\\newtheorem{name}[counter]{text}\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}
{
  const src = '\\section{Title with \\emph{nested} braces}\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

// --- 11. block_comment (\iffalse ... \fi) ---
console.log('\n=== 11. block_comment shape ===');
{
  const src = '\\iffalse\nhidden text\n\\fi\nvisible\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

// --- 12. displayed_equation / inline_formula ---
console.log('\n=== 12. displayed_equation and inline_formula ===');
{
  const src = 'Some inline $a^2+b^2=c^2$ math.\n\n\\[\ndisplayed\n\\]\n\n$$\nalso displayed\n$$\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

// --- 13. \verb and \lstinline unbreakable spans ---
console.log('\n=== 13. \\verb shape ===');
{
  const src = '\\verb|some code here|\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

// --- 14. \par as structural line ---
console.log('\n=== 14. \\par alone on a line ===');
{
  const src = 'text before\n\\par\ntext after\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

// --- 15. trailing % comment after text on the same line ---
console.log('\n=== 15. trailing % comment after text ===');
{
  const src = 'aaa bbb % note\nmore text\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}
console.log('\n=== 15b. escaped \\% is not a comment ===');
{
  const src = 'a cost of \\%50 percent\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
  console.log('has line_comment:', findAll(tree.rootNode, 'line_comment').length);
}
