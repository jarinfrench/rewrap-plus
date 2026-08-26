// Throwaway spike script — not part of the build, not linted, not run in
// CI. Its job: verify tree-sitter-typescript/tsx node names/shapes before
// writing Phase 12b's descriptor, per this project's "probe before coding,
// always" rule — don't trust memory or type declarations, don't repeat
// Phase 2's spike from scratch, just point the same technique at a new
// grammar. Findings are written up in docs/adapters.md; this file is kept
// only so the experiment is reproducible.
//
// Run from the repo root after `npm ci`:
//
//   node docs/spikes/tree-sitter-typescript-probe.mjs

import { Parser, Language, LANGUAGE_VERSION, MIN_COMPATIBLE_VERSION } from 'web-tree-sitter';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const grammarsDir = path.join(here, '..', '..', 'packages', 'engine', 'grammars');

await Parser.init();

async function probeGrammar(name, wasmFile) {
  console.log(`\n=== ${name} ===`);
  const language = await Language.load(path.join(grammarsDir, wasmFile));
  console.log(
    'ABI: language=%d, supported=[%d, %d]',
    language.abiVersion,
    MIN_COMPATIBLE_VERSION,
    LANGUAGE_VERSION,
  );
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

function dump(node, indent = '') {
  console.log(
    `${indent}${node.type} [${node.startIndex}-${node.endIndex}] ${JSON.stringify(node.text.slice(0, 40))}`,
  );
  for (const child of node.children) {
    dump(child, indent + '  ');
  }
}

const ts = await probeGrammar('typescript', 'tree-sitter-typescript.wasm');
const tsx = await probeGrammar('tsx', 'tree-sitter-tsx.wasm');

console.log('\n--- comment forms ---');
const comments = ts.parse(
  ['// line comment', '/* plain block */', '/**', ' * jsdoc block', ' */', 'const x = 1;'].join(
    '\n',
  ),
);
dump(comments.rootNode);

console.log('\n--- string + template literal + operator concat ---');
const strings = ts.parse(
  [
    'const a = "double";',
    "const b = 'single';",
    'const c = `template ${expr} literal`;',
    'const d = "foo" + "bar" + name;',
    'const e = "foo" + "bar";',
  ].join('\n'),
);
dump(strings.rootNode);

console.log('\n--- binary_expression field names for + chain ---');
const plus = ts.parse('const x = "a" + "b" + "c";');
function findBinary(node) {
  if (node.type === 'binary_expression') {
    console.log('binary_expression fields:');
    console.log('  left:', node.childForFieldName('left')?.type);
    console.log('  operator field:', node.childForFieldName('operator')?.type);
    console.log('  right:', node.childForFieldName('right')?.type);
    // also check named children directly in case 'operator' isn't a field
    console.log(
      '  children:',
      node.children.map((c) => c.type),
    );
  }
  for (const child of node.children) findBinary(child);
}
findBinary(plus.rootNode);

console.log('\n--- JSDoc-shaped block comment with @param/@returns ---');
const jsdoc = ts.parse(
  [
    '/**',
    ' * Summary line.',
    ' *',
    ' * @param name the name to greet',
    ' * @returns a greeting',
    ' */',
    'function greet(name) {}',
  ].join('\n'),
);
const jsdocComment = jsdoc.rootNode.children.find((c) => c.type === 'comment');
console.log('jsdoc comment text:\n' + jsdocComment.text);

console.log('\n--- CRLF trailing \\r check ---');
const crlf = ts.parse('// a comment\r\nconst x = "hi";\r\n');
const crlfComment = crlf.rootNode.children.find((c) => c.type === 'comment');
console.log('comment node text:', JSON.stringify(crlfComment.text));
console.log('ends with \\r:', crlfComment.text.endsWith('\r'));

const crlfString = crlf.rootNode.descendantsOfType
  ? null
  : null; // placeholder, walk manually below
function findFirst(node, type) {
  if (node.type === type) return node;
  for (const child of node.children) {
    const found = findFirst(child, type);
    if (found) return found;
  }
  return null;
}
const strNode = findFirst(crlf.rootNode, 'string');
console.log('string node text:', JSON.stringify(strNode?.text));

console.log('\n--- TSX: jsx + typescript together ---');
const tsxParser = tsx;
const tsxTree = tsxParser.parse(
  'const el = <div className="hi">{"a" + "b"}</div>;\n// a comment\n',
);
dump(tsxTree.rootNode);

console.log('\n--- template_string node shape ---');
const tmpl = ts.parse('const t = `hello ${name} world ${other}`;');
const tmplNode = findFirst(tmpl.rootNode, 'template_string');
console.log('template_string children:');
for (const c of tmplNode.children) {
  console.log(' ', c.type, JSON.stringify(c.text.slice(0, 30)));
}

console.log('\n--- no-substitution template ---');
const noSub = ts.parse('const t = `plain template no interpolation`;');
const noSubNode = findFirst(noSub.rootNode, 'template_string');
console.log('no-sub template_string children:');
for (const c of noSubNode.children) {
  console.log(' ', c.type, JSON.stringify(c.text.slice(0, 30)));
}
