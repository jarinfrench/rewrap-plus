// Throwaway spike script -- not part of the build, not linted, not run in
// CI. Its job: confirm, before writing any test assertions about it,
// whether the "long chain of concatenated string literals blows the JS
// call stack" pathology (`../../packages/engine/test/hardening/
// pathological-input.test.ts`'s own doc comment has the full history)
// reproduces the same way across every registered adapter's grammar, or
// only for the `'operator'`-style (`+`-joined) languages. Per this
// project's "probe before coding, always" rule -- don't assume a finding
// probed for one grammar (or, historically, only ever probed for Python)
// generalizes to another without checking.
//
// Finding: a 2,000-part chain builds a `binary_operator`/
// `binary_expression` tree ~2,000 nodes deep for Java and JavaScript
// (both `'operator'`-style, like Python's `+` form) -- the same shape that
// caused the original stack-overflow bug this test guards against. C++'s
// `'implicit'`-only concatenation (bare adjacency, no operator) is
// structurally immune: the identical 2,000-part chain produces a tree
// only 8 nodes deep, because `tree-sitter-cpp`'s `concatenated_string`
// node holds every adjacent literal as a flat list of children, not a
// recursive binary tree. See `pathological-input.test.ts`'s own doc
// comment for how this shaped that suite's C++ variant.
//
// Run from the repo root after `npm ci`:
//
//   node docs/spikes/probe-concat-depth.mjs

import { Parser, Language } from 'web-tree-sitter';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const grammarsDir = path.join(here, '..', '..', 'packages', 'engine', 'grammars');

await Parser.init();

async function probe(wasmName, source, langLabel) {
  const language = await Language.load(path.join(grammarsDir, wasmName));
  const parser = new Parser();
  parser.setLanguage(language);
  const t0 = Date.now();
  const tree = parser.parse(source);
  const dt = Date.now() - t0;
  console.log(
    `${langLabel}: parse ${source.length} chars in ${dt}ms, rootHasError=${tree.rootNode.hasError}`,
  );

  function maxDepth(node) {
    if (node.childCount === 0) return 1;
    let m = 0;
    for (const c of node.children) m = Math.max(m, maxDepth(c));
    return m + 1;
  }
  console.log(`${langLabel}: tree maxDepth=${maxDepth(tree.rootNode)}`);
}

const n = 2000;
const parts = Array.from(
  { length: n },
  (_, i) => `"part number ${i} of a long prose message that keeps going"`,
);

await probe(
  'tree-sitter-cpp.wasm',
  `void f() {\n  const char* x = ${parts.join(' ')};\n}\n`,
  'cpp-implicit',
);
await probe(
  'tree-sitter-java.wasm',
  `class C {\n  String x = ${parts.join(' + ')};\n}\n`,
  'java-operator',
);
await probe('tree-sitter-javascript.wasm', `const x = ${parts.join(' + ')};\n`, 'js-operator');
