// Throwaway spike script -- not part of the build, not linted, not run in
// CI. Its job: verify the five comment-only-batch grammars (TOML, Bash,
// CSS, SCSS, PowerShell) load with this project's pinned
// web-tree-sitter@0.26.13 and parse a representative snippet, per this
// project's "probe before coding, always" rule -- don't trust memory or
// type declarations. Findings feed the descriptors under
// packages/engine/src/languages/{toml,shellscript,css,scss,powershell}/.
// Reads WASM straight from a scratch extraction dir (not yet vendored at
// the time this script was first run) rather than packages/engine/grammars/
// -- update WASM_DIR below once files are copied into that directory, or
// just re-run against the vendored copies to reproduce.
//
// Run from the repo root after `npm ci`:
//
//   node docs/spikes/tree-sitter-comment-langs-batch-probe.mjs

import { Parser, Language, LANGUAGE_VERSION, MIN_COMPATIBLE_VERSION } from 'web-tree-sitter';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const WASM_DIR = path.join(here, '..', '..', 'packages', 'engine', 'grammars');

await Parser.init();

function dump(node, indent = '') {
  console.log(
    `${indent}${node.type} [${node.startIndex}-${node.endIndex}] ${JSON.stringify(node.text.slice(0, 60))}`,
  );
  for (const child of node.children) dump(child, indent + '  ');
}

async function probe(name, wasmFile, snippet) {
  console.log(`\n===== ${name} =====`);
  const language = await Language.load(path.join(WASM_DIR, wasmFile));
  console.log(
    'ABI: language=%d, supported=[%d, %d]',
    language.abiVersion,
    MIN_COMPATIBLE_VERSION,
    LANGUAGE_VERSION,
  );
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(snippet);
  console.log('hasError:', tree.rootNode.hasError);
  dump(tree.rootNode);
}

await probe(
  'TOML',
  'tree-sitter-toml.wasm',
  '# a toml comment\nkey = "value" # trailing comment\n[table]\nother = 1\n',
);

await probe(
  'Bash',
  'tree-sitter-bash.wasm',
  '#!/bin/bash\n# a comment\necho "hi" # trailing\n',
);

await probe(
  'CSS',
  'tree-sitter-css.wasm',
  '/* a css comment */\n.foo {\n  color: red; /* trailing */\n}\n',
);

await probe(
  'SCSS',
  'tree-sitter-scss.wasm',
  '// a line comment\n/* a block comment */\n.foo {\n  color: red; // trailing\n}\n',
);

await probe(
  'PowerShell',
  'tree-sitter-powershell.wasm',
  '# a line comment\n<#\n.SYNOPSIS\nDoes a thing.\n.DESCRIPTION\nDoes a longer thing.\n.PARAMETER Name\nThe name.\n#>\nfunction Foo {\n  <# plain block #>\n  Write-Host "hi"\n}\n',
);
