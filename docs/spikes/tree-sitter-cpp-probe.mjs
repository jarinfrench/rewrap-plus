// Throwaway spike script — not part of the build, not linted, not run in
// CI. Its job: verify tree-sitter-cpp node names/shapes before writing
// Phase 12c's descriptor, per this project's "probe before coding,
// always" rule — don't trust memory or type declarations. Findings are
// written up in docs/adapters.md; this file is kept only so the
// experiment is reproducible.
//
// Run from the repo root after `npm ci`:
//
//   node docs/spikes/tree-sitter-cpp-probe.mjs

import { Parser, Language, LANGUAGE_VERSION, MIN_COMPATIBLE_VERSION } from 'web-tree-sitter';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const grammarsDir = path.join(here, '..', '..', 'packages', 'engine', 'grammars');

await Parser.init();

const language = await Language.load(path.join(grammarsDir, 'tree-sitter-cpp.wasm'));
console.log(
  'ABI: language=%d, supported=[%d, %d]',
  language.abiVersion,
  MIN_COMPATIBLE_VERSION,
  LANGUAGE_VERSION,
);
const parser = new Parser();
parser.setLanguage(language);

function dump(node, indent = '') {
  console.log(
    `${indent}${node.type} [${node.startIndex}-${node.endIndex}] ${JSON.stringify(node.text.slice(0, 50))}`,
  );
  for (const child of node.children) {
    dump(child, indent + '  ');
  }
}

function findFirst(node, type) {
  if (node.type === type) return node;
  for (const child of node.children) {
    const found = findFirst(child, type);
    if (found) return found;
  }
  return null;
}

function findAll(node, type, out = []) {
  if (node.type === type) out.push(node);
  for (const child of node.children) findAll(child, type, out);
  return out;
}

console.log('\n--- comment forms: line, plain block, doxygen /** and /// ---');
const comments = parser.parse(
  [
    '// line comment',
    '/* plain block */',
    '/**',
    ' * doxygen block',
    ' * @param x the x',
    ' */',
    '/// doxygen triple-slash line',
    'int x = 1;',
  ].join('\n'),
);
dump(comments.rootNode);

console.log('\n--- ordinary strings, adjacent (implicit) concat, wide/UTF prefixes ---');
const strings = parser.parse(
  [
    'const char* a = "double";',
    "const char c = 'x';",
    'const char* implicit = "foo" "bar";',
    'const char* plus = "foo" + std::string("bar");',
    'const wchar_t* w = L"wide";',
    'const char16_t* u16 = u"utf16";',
    'const char32_t* u32 = U"utf32";',
    'const char* u8s = u8"utf8";',
  ].join('\n'),
);
dump(strings.rootNode);

console.log('\n--- raw string R"(...)" and custom delimiter R"delim(...)delim" ---');
const raw = parser.parse(
  [
    'const char* r1 = R"(hello "world")";',
    'const char* r2 = R"delim(has ) paren)delim";',
    'const char* rw = LR"(wide raw)";',
  ].join('\n'),
);
dump(raw.rootNode);

console.log('\n--- adjacent string_literal siblings: what is the parent node? ---');
const adjacent = parser.parse('const char* implicit = "foo" "bar" "baz";');
const decl = findFirst(adjacent.rootNode, 'declaration');
console.log('declaration children:', decl?.children.map((c) => c.type));
const initDeclarator = findFirst(adjacent.rootNode, 'init_declarator');
console.log('init_declarator children:', initDeclarator?.children.map((c) => c.type));
const stringLits = findAll(adjacent.rootNode, 'string_literal');
console.log(
  'string_literal nodes:',
  stringLits.map((n) => [n.type, n.text, n.parent?.type]),
);
console.log(
  'string_literal parent field name check (concatenated_string?):',
  findFirst(adjacent.rootNode, 'concatenated_string') ? 'exists' : 'NOT FOUND',
);

console.log('\n--- string_literal node internal children (prefix/quote/content) ---');
const one = parser.parse('const char* a = "hello\\nworld";');
const oneLit = findFirst(one.rootNode, 'string_literal');
console.log('string_literal children:');
for (const c of oneLit.children) {
  console.log(' ', c.type, JSON.stringify(c.text));
}

console.log('\n--- wide prefix string_literal children ---');
const wideOne = parser.parse('const wchar_t* w = L"wide value";');
const wideLit = findFirst(wideOne.rootNode, 'string_literal');
console.log('wide string_literal children:');
for (const c of wideLit.children) {
  console.log(' ', c.type, JSON.stringify(c.text));
}

console.log('\n--- raw_string_literal node shape ---');
const rawOne = parser.parse('const char* r = R"(hello "world")";');
const rawLit = findFirst(rawOne.rootNode, 'raw_string_literal');
console.log('raw_string_literal type:', rawLit?.type);
console.log('raw_string_literal children:');
if (rawLit) {
  for (const c of rawLit.children) {
    console.log(' ', c.type, JSON.stringify(c.text));
  }
}

console.log('\n--- binary_expression field names for + chain ---');
const plus = parser.parse('auto x = std::string("a") + "b" + "c";');
function findBinary(node) {
  if (node.type === 'binary_expression') {
    console.log('binary_expression fields:');
    console.log('  left:', node.childForFieldName('left')?.type, node.childForFieldName('left')?.text);
    console.log('  operator field:', node.childForFieldName('operator')?.type);
    console.log('  right:', node.childForFieldName('right')?.type, node.childForFieldName('right')?.text);
    console.log(
      '  children:',
      node.children.map((c) => c.type),
    );
  }
  for (const child of node.children) findBinary(child);
}
findBinary(plus.rootNode);

console.log('\n--- CRLF trailing \\r check: comment and string ---');
const crlf = parser.parse('// a comment\r\nconst char* x = "hi";\r\n');
const crlfComment = crlf.rootNode.children.find((c) => c.type === 'comment');
console.log('comment node text:', JSON.stringify(crlfComment.text));
console.log('comment ends with \\r:', crlfComment.text.endsWith('\r'));
const crlfString = findFirst(crlf.rootNode, 'string_literal');
console.log('string_literal node text:', JSON.stringify(crlfString?.text));

console.log('\n--- preprocessor macro with backslash line continuation ---');
const macro = parser.parse(
  ['#define LONG_MACRO(x) \\', '  do_something(x); \\', '  const char* s = "in macro";', 'int y = 2;'].join(
    '\n',
  ),
);
dump(macro.rootNode);

console.log('\n--- doxygen backslash-style tags: \\param \\return ---');
const doxyBackslash = parser.parse(
  ['/**', ' * Summary.', ' * \\param x the x', ' * \\return a value', ' */', 'int f(int x);'].join('\n'),
);
const doxyComment = doxyBackslash.rootNode.children.find((c) => c.type === 'comment');
console.log('doxygen backslash comment text:\n' + doxyComment.text);
