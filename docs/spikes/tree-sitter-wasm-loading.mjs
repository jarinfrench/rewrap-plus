// Throwaway spike script -- not part of the build, not linted, not run in
// CI. Its only job was answering Phase 2 commit 1's question: "does
// tree-sitter-python ship a usable prebuilt .wasm, and does web-tree-sitter
// actually parse with it?" Findings are written up properly in
// ../parsing.md; this file is kept only so the experiment is reproducible.
//
// Run from the repo root after `npm ci`:
//
//   node docs/spikes/tree-sitter-wasm-loading.mjs
//
// It parses hand-written snippets directly (not via ParserManager) and
// dumps raw node fields, specifically to inspect whether `startIndex` /
// `startPosition` are byte- or UTF-16-based -- see finding 3 in
// ../parsing.md. `ParserManager` (src/parser/parser-manager.ts) is the
// real, tested, non-throwaway product of this phase.

import { Parser, Language, LANGUAGE_VERSION, MIN_COMPATIBLE_VERSION } from 'web-tree-sitter';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(
  here,
  '..',
  '..',
  'packages',
  'engine',
  'grammars',
  'tree-sitter-python.wasm',
);

await Parser.init();
const language = await Language.load(wasmPath);
console.log(
  'ABI: language=%d, supported=[%d, %d]',
  language.abiVersion,
  MIN_COMPATIBLE_VERSION,
  LANGUAGE_VERSION,
);

const parser = new Parser();
parser.setLanguage(language);

// Finding 1 + 2: a prebuilt wasm loads and parses without any local build
// step (see PROVENANCE.md for exactly which file this is).
const clean =
  'def greet(name):\n    """Say hello."""\n    # a comment\n    return "hello, " + name\n';
const cleanTree = parser.parse(clean);
console.log('\n--- clean parse ---');
console.log('hasError:', cleanTree.rootNode.hasError);
console.log(cleanTree.rootNode.toString().slice(0, 200));

// Finding 3: non-ASCII offsets. If `startIndex` were a true UTF-8 byte
// offset (as native tree-sitter bindings report, and as Phase 1's
// SourceSpan doc comment assumed), the string content below would span 13
// bytes (4 for the astral emoji + 3 each for the three CJK characters). It
// doesn't -- see the printed values and ../parsing.md finding 3.
const nonAscii = 'x = "\u{1F600}\u65e5\u672c\u8a9e"\n';
const nonAsciiTree = parser.parse(nonAscii);
console.log('\n--- non-ASCII offsets ---');
console.log('source (JS view):', JSON.stringify(nonAscii));
console.log('UTF-16 length of line 1:', nonAscii.split('\n')[0].length);
console.log('UTF-8 byte length of line 1:', Buffer.byteLength(nonAscii.split('\n')[0], 'utf8'));
for (const node of nonAsciiTree.rootNode.descendantsOfType('string_content')) {
  console.log(
    'string_content: startIndex=%d endIndex=%d startPosition=%o endPosition=%o',
    node.startIndex,
    node.endIndex,
    node.startPosition,
    node.endPosition,
  );
}

// Finding 4: error/missing node detection, feeding Phase 2 commit 4
// (`ParseResult`'s `errorSpans`).
const broken = 'def greet(name:\n    return "hi"\n';
const brokenTree = parser.parse(broken);
console.log('\n--- broken parse ---');
console.log('hasError:', brokenTree.rootNode.hasError);
const walk = (node) => {
  if (node.isError || node.isMissing) {
    console.log(
      '  problem node: type=%s isMissing=%s [%d, %d)',
      node.type,
      node.isMissing,
      node.startIndex,
      node.endIndex,
    );
  }
  for (const child of node.children) if (child) walk(child);
};
walk(brokenTree.rootNode);
