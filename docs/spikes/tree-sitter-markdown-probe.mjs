// Throwaway spike script — not part of the build, not linted, not run in
// CI. Its job: verify tree-sitter-markdown (block grammar) node
// names/shapes and the §5.2 geometry assumptions in
// docs/planning/markdown-latex-plan.md before writing the Markdown
// adapter, per this project's "probe before coding, always" rule — don't
// trust memory or type declarations. Findings are written up in
// docs/parsing.md (Finding 7); this file is kept only so the experiment is
// reproducible.
//
// Run from the repo root after `npm ci`, with WASM_PATH pointing at either
// the scratch copy (before vendoring) or the vendored file (after):
//
//   WASM_PATH=/path/to/tree-sitter-markdown.wasm node docs/spikes/tree-sitter-markdown-probe.mjs
//
// Defaults to the vendored location if WASM_PATH is unset.

import { Parser, Language, LANGUAGE_VERSION, MIN_COMPATIBLE_VERSION } from 'web-tree-sitter';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const wasmPath =
  process.env.WASM_PATH ??
  path.join(repoRoot, 'packages', 'engine', 'grammars', 'tree-sitter-markdown.wasm');

await Parser.init();
const language = await Language.load(wasmPath);
console.log('wasm:', wasmPath);
console.log(
  'ABI: language=%d, supported=[%d, %d]',
  language.abiVersion,
  MIN_COMPATIBLE_VERSION,
  LANGUAGE_VERSION,
);

const parser = new Parser();
parser.setLanguage(language);

function dump(node, source, indent = '') {
  const text = source.slice(node.startIndex, node.endIndex);
  console.log(
    `${indent}${node.type} [${node.startIndex}-${node.endIndex}] row[${node.startPosition.row},${node.startPosition.column}]-[${node.endPosition.row},${node.endPosition.column}] ${JSON.stringify(text.slice(0, 40))}`,
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

// --- 1. Basic paragraph geometry: startPosition relative to container markers ---
console.log('\n=== 1. plain paragraph, no container ===');
{
  const src = 'hello world\nsecond line\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

console.log('\n=== 2. paragraph inside a block quote (single "> ") ===');
{
  const src = '> hello world\n> second line\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
  const para = findAll(tree.rootNode, 'paragraph')[0];
  console.log('paragraph.startPosition:', para.startPosition, 'text at that col:', JSON.stringify(src.slice(para.startIndex, para.startIndex + 5)));
}

console.log('\n=== 3. nested block quote ">> " ===');
{
  const src = '>> hello world\n>> second line\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

console.log('\n=== 4. paragraph inside a list item (hanging indent) ===');
{
  const src = '- hello world\n  second line\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

console.log('\n=== 5. ordered list item ===');
{
  const src = '1. hello world\n   second line\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

console.log('\n=== 6. task list item ===');
{
  const src = '- [ ] hello world\n  second line\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

console.log('\n=== 7. list-in-quote and quote-in-list ===');
{
  const src = '- > quoted in list\n  > second\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}
{
  const src = '> - item in quote\n>   second\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

console.log('\n=== 8. lazy continuation line (no "> " on line 2) ===');
{
  const src = '> hello world\nsecond line lazily continues\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

// --- 2. block_continuation shape ---
console.log('\n=== 9. block_continuation nodes for a 3-line nested quote paragraph ===');
{
  const src = '>> line one\n>> line two\n>> line three\n';
  const tree = parser.parse(src);
  const conts = findAll(tree.rootNode, 'block_continuation');
  for (const c of conts) {
    console.log('block_continuation:', JSON.stringify(src.slice(c.startIndex, c.endIndex)), 'row', c.startPosition.row);
  }
}

// --- 3. CRLF handling on every line, not just the last ---
console.log('\n=== 10. CRLF: paragraph spanning 3 lines, every \\r\\n ===');
{
  const src = 'line one\r\nline two\r\nline three\r\n';
  const tree = parser.parse(src);
  const para = findAll(tree.rootNode, 'paragraph')[0];
  console.log('paragraph text:', JSON.stringify(src.slice(para.startIndex, para.endIndex)));
  console.log('paragraph endIndex includes trailing content up to:', JSON.stringify(src.slice(para.endIndex - 3, para.endIndex + 3)));
  const inline = findAll(para, 'inline')[0];
  if (inline) console.log('inline text:', JSON.stringify(src.slice(inline.startIndex, inline.endIndex)));
}
console.log('\n=== 11. CRLF inside a block quote ===');
{
  const src = '> line one\r\n> line two\r\n> line three\r\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

// --- 4. Tabs in container prefixes ---
console.log('\n=== 12. tab after list marker ===');
{
  const src = '-\thello world\n\tsecond line\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}
console.log('\n=== 13. tab after block quote marker ===');
{
  const src = '>\thello world\n>\tsecond line\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

// --- 5. Compile-time extension defaults: GFM pipe tables + task lists + strikethrough, front matter ---
console.log('\n=== 14. pipe table (EXTENSION_GFM) ===');
{
  const src = '| a | b |\n|---|---|\n| 1 | 2 |\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
  console.log('has pipe_table node:', findAll(tree.rootNode, 'pipe_table').length > 0);
}
console.log('\n=== 15. strikethrough (EXTENSION_GFM, needs inline grammar to fully resolve, but check block doesn\'t choke) ===');
{
  const src = '~~strike~~ text\n';
  const tree = parser.parse(src);
  console.log('hasError:', tree.rootNode.hasError);
}
console.log('\n=== 16. YAML front matter (EXTENSION_MINUS_METADATA) ===');
{
  const src = '---\ntitle: Test\n---\n\nBody paragraph.\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
  console.log('has minus_metadata node:', findAll(tree.rootNode, 'minus_metadata').length > 0);
}
console.log('\n=== 17. TOML front matter (EXTENSION_PLUS_METADATA) ===');
{
  const src = '+++\ntitle = "Test"\n+++\n\nBody paragraph.\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
  console.log('has plus_metadata node:', findAll(tree.rootNode, 'plus_metadata').length > 0);
}

// --- 6. Setext heading: paragraph as a child, per §3.3 item 3 exclusion ---
console.log('\n=== 18. setext heading: is heading_content a paragraph child of setext_heading? ===');
{
  const src = 'Heading Text\n============\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
  const setext = findAll(tree.rootNode, 'setext_heading')[0];
  console.log('setext_heading children:', setext?.children.map((c) => c?.type));
  const innerPara = findAll(setext ?? tree.rootNode, 'paragraph');
  console.log('paragraph(s) under setext_heading:', innerPara.length, innerPara[0]?.parent?.type);
}

// --- 7. Terminators: does a table/list/heading interrupt an in-progress paragraph? ---
console.log('\n=== 19. table interrupting a paragraph ===');
{
  const src = 'some text\n| a | b |\n|---|---|\n';
  const tree = parser.parse(src);
  dump(tree.rootNode, src);
}

// --- 8. ERROR-node overlap on this repo's own docs/*.md ---
console.log('\n=== 20. ERROR-node overlap on this repo\'s docs/*.md ===');
{
  const docsDir = path.join(repoRoot, 'docs');
  function walkDir(dir) {
    let out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out = out.concat(walkDir(full));
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
    }
    return out;
  }
  const files = walkDir(docsDir);
  let totalParagraphs = 0;
  let errorOverlapParagraphs = 0;
  let filesWithErrors = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const tree = parser.parse(source);
    const paragraphs = findAll(tree.rootNode, 'paragraph');
    totalParagraphs += paragraphs.length;
    let fileHadError = false;
    for (const p of paragraphs) {
      if (p.hasError) {
        errorOverlapParagraphs++;
        fileHadError = true;
      }
    }
    if (fileHadError) filesWithErrors++;
  }
  console.log(`files scanned: ${files.length}`);
  console.log(`total paragraphs: ${totalParagraphs}`);
  console.log(`paragraphs overlapping an ERROR node: ${errorOverlapParagraphs}`);
  console.log(`files with at least one such paragraph: ${filesWithErrors}`);
  console.log(`rate: ${totalParagraphs > 0 ? ((errorOverlapParagraphs / totalParagraphs) * 100).toFixed(2) : 0}%`);
}

// --- 9. escaped trailing backslash: literal \\ at end of line is NOT a hard break ---
console.log('\n=== 21. escaped backslash at line end (should NOT be a hard break per CommonMark) ===');
{
  const src = 'line ending in escaped backslash\\\\\nnext line\n';
  const tree = parser.parse(src);
  const para = findAll(tree.rootNode, 'paragraph')[0];
  console.log('paragraph text:', JSON.stringify(src.slice(para.startIndex, para.endIndex)));
  dump(para, src);
}
console.log('\n=== 22. single trailing backslash (IS a hard break) ===');
{
  const src = 'line ending in one backslash\\\nnext line\n';
  const tree = parser.parse(src);
  const para = findAll(tree.rootNode, 'paragraph')[0];
  dump(para, src);
}
