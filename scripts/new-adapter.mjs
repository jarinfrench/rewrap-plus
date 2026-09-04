#!/usr/bin/env node
/**
 * `npm run new-adapter -- <languageId>` — scaffolds the files a new
 * language adapter needs under `packages/engine`: a descriptor stub, an
 * adapter stub, a probe-driven descriptor test stub, a conformance test
 * pre-wired to `runAdapterConformance`, and a fixtures directory
 * placeholder. See `docs/adding-a-language.md` for the full walkthrough
 * this script is one step of.
 *
 * Deliberately generates *stubs*, not a working adapter: every
 * language's actual comment/string syntax, node names, and grammar
 * quirks can only be discovered by probing that language's own vendored
 * grammar directly (`docs/parsing.md`'s "probe before coding" finding,
 * which `docs/adapters.md`'s CRLF-handling and JavaScript-canary
 * sections both independently reconfirmed) — nothing here can safely
 * guess at that. What this script *can* do safely is remove the
 * boilerplate: correct import paths, a descriptor shape that passes
 * `validateDescriptor` on day one (structurally valid placeholder data,
 * matching how `packages/engine/src/languages/javascript/descriptor.ts`
 * keeps its own unused `strings` block real rather than absent), and a
 * conformance test already wired to the new adapter so `npm test` gives
 * concrete failures to work against immediately instead of a blank page.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function main() {
  const languageId = process.argv[2];
  if (!languageId) {
    console.error('Usage: npm run new-adapter -- <languageId>');
    console.error("Example: npm run new-adapter -- ruby");
    process.exitCode = 1;
    return;
  }
  if (!/^[a-z][a-z0-9-]*$/.test(languageId)) {
    console.error(
      `new-adapter: '${languageId}' doesn't look like a VSCode languageId ` +
        '(lowercase letters, digits, hyphens — e.g. "ruby", "typescriptreact").',
    );
    process.exitCode = 1;
    return;
  }

  const pascalName = languageId.replace(/(^|-)([a-z])/g, (_, _sep, c) => c.toUpperCase());
  const languageDir = path.join(repoRoot, 'packages', 'engine', 'src', 'languages', languageId);
  const conformanceDir = path.join(repoRoot, 'packages', 'engine', 'test', 'conformance');
  const fixturesDir = path.join(repoRoot, 'packages', 'engine', 'test', 'fixtures', languageId);

  const targets = [
    [path.join(languageDir, 'descriptor.ts'), descriptorStub(languageId, pascalName)],
    [path.join(languageDir, 'descriptor.test.ts'), descriptorTestStub(languageId, pascalName)],
    [path.join(languageDir, 'adapter.ts'), adapterStub(languageId, pascalName)],
    [
      path.join(conformanceDir, `${languageId}-conformance.test.ts`),
      conformanceTestStub(languageId, pascalName),
    ],
    [path.join(fixturesDir, 'README.md'), fixturesReadmeStub(languageId)],
  ];

  for (const [filePath] of targets) {
    if (fs.existsSync(filePath)) {
      console.error(`new-adapter: refusing to overwrite existing file ${path.relative(repoRoot, filePath)}`);
      process.exitCode = 1;
      return;
    }
  }

  for (const [filePath, contents] of targets) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
    console.log(`created ${path.relative(repoRoot, filePath)}`);
  }

  console.log('');
  console.log('Next steps (see docs/adding-a-language.md for the full walkthrough):');
  console.log(`  1. Obtain a tree-sitter grammar WASM for '${languageId}' and vendor it into`);
  console.log(`     packages/engine/grammars/, recording provenance in that dir's PROVENANCE.md.`);
  console.log(`  2. Probe the grammar directly (docs/parsing.md's approach) to find real node`);
  console.log(`     names/shapes before touching ${path.relative(repoRoot, targets[0][0])}.`);
  console.log(`  3. Fill in the descriptor stub's TODOs, then the adapter stub's if any hooks`);
  console.log(`     are needed (most languages should override nothing).`);
  console.log(`  4. Fill in the conformance test's TODO sources and run:`);
  console.log(`       npm test --workspace=@rewrap-plus/engine`);
  console.log(`     — a passing run with no changes needed under packages/engine/src/core`);
  console.log(`     is the adapter interface holding — the hard gate a new adapter needs to pass.`);
}

function descriptorStub(languageId, pascalName) {
  return `import type { LanguageDescriptor } from '../../types/adapter.js';

/**
 * TODO: replace this file's header comment with a real one once the
 * descriptor below is filled in — see docs/adding-a-language.md.
 *
 * Placeholder descriptor for '${languageId}', scaffolded by
 * \`npm run new-adapter\`. Every value below is a structurally valid
 * stand-in (so this compiles and passes \`validateDescriptor\` as-is),
 * not a real ${pascalName} descriptor — nothing here should be trusted
 * until it's been checked against the vendored grammar directly.
 */
export const ${languageId.replace(/-/g, '_')}Descriptor: LanguageDescriptor = {
  id: '${languageId}',
  // TODO: point at the real vendored grammar once it's added to
  // packages/engine/grammars/ — see that directory's PROVENANCE.md for
  // the vendoring steps.
  grammarWasm: 'grammars/tree-sitter-${languageId}.wasm',

  queries: {
    // TODO: replace with the real tree-sitter query source for this
    // grammar's comment/string node types, verified by probing the
    // grammar directly (docs/parsing.md) — don't trust these names.
    comments: '(comment) @comment',
    strings: '(string) @string',
  },

  comments: {
    // TODO: fill in whichever of line/block/doc this language actually
    // has, and drop the ones it doesn't (all three are optional).
    line: { marker: '//', spaceAfter: true },
    neverReflow: [],
  },

  strings: {
    // TODO: real quote/prefix/escape/placeholder/concatenation shapes.
    // \`validateDescriptor\` requires at least one entry in \`quotes\`
    // even for a comments-only adapter — see
    // packages/engine/src/languages/javascript/descriptor.ts's own doc
    // comment for why that adapter keeps this block real rather than
    // absent.
    quotes: [{ delimiter: '"', multiline: false, escapes: true }],
    prefixes: [],
    rawForms: [],
    escapes: { sequences: [] },
    placeholders: [],
    concatenation: { style: 'operator', operator: '+', operatorPlacement: 'trailing' },
  },
};
`;
}

function descriptorTestStub(languageId, pascalName) {
  return `import { Parser, Language, Query } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { ${languageId.replace(/-/g, '_')}Descriptor } from './descriptor.js';

/**
 * TODO: this is a scaffold, not a real test suite yet. Probe the
 * vendored grammar directly before writing real assertions — see
 * docs/parsing.md and docs/adapters.md's "JavaScript canary — grammar
 * findings" section for the shape this investigation should take (node
 * names, CRLF handling, anything the grammar does that surprises you).
 */
describe('${pascalName} descriptor', () => {
  beforeAll(async () => {
    await Parser.init();
  });

  it('grammar loads and queries compile', async () => {
    const language = await Language.load(\`grammars/tree-sitter-${languageId}.wasm\`);
    expect(() => new Query(language, ${languageId.replace(/-/g, '_')}Descriptor.queries.comments)).not.toThrow();
    expect(() => new Query(language, ${languageId.replace(/-/g, '_')}Descriptor.queries.strings)).not.toThrow();
  });

  // TODO: real node-name/shape assertions, probed directly — don't
  // trust the placeholder query source in ./descriptor.ts until this
  // test proves it against the real grammar.
});
`;
}

function adapterStub(languageId, pascalName) {
  const constName = languageId.replace(/-/g, '_');
  return `import type { LanguageAdapter } from '../../types/adapter.js';
import { ${constName}Descriptor } from './descriptor.js';

/**
 * TODO: ${pascalName}'s \`LanguageAdapter\`, scaffolded by
 * \`npm run new-adapter\`. Every hook (\`classify\`, \`groupRegions\`,
 * \`isSafeToWrap\`, \`proseText\`) is optional — the engine's default,
 * descriptor-driven behavior applies to any hook left unset. Most
 * languages should override nothing; only add a hook once a specific,
 * probed grammar behavior actually needs one (see
 * packages/engine/src/languages/javascript/adapter.ts for a real
 * minimal example, or python/ for one that overrides more).
 */
export const ${constName}Adapter: LanguageAdapter = {
  descriptor: ${constName}Descriptor,
};
`;
}

function conformanceTestStub(languageId, pascalName) {
  const constName = languageId.replace(/-/g, '_');
  return `import { ${constName}Adapter } from '../../src/languages/${languageId}/adapter.js';
import { runAdapterConformance } from '../../src/conformance/run-adapter-conformance.js';

/**
 * TODO: replace CRLF_SOURCE below with a real ${pascalName} snippet
 * containing at least one line-comment block long enough to overflow
 * COLUMN_LIMIT — see
 * packages/engine/test/conformance/javascript-conformance.test.ts for a
 * worked example, including why both a CRLF and an LF variant of the
 * same source matter (the line-ending-preservation invariant needs
 * both). The hard gate here: if getting this suite green
 * requires a change under packages/engine/src/core, stop and fix the
 * abstraction there instead of working around it here.
 */
const COLUMN_LIMIT = 40;

const CRLF_SOURCE = 'TODO: replace with real ${languageId} source\\r\\n';
const LF_SOURCE = CRLF_SOURCE.replace(/\\r\\n/g, '\\n');

runAdapterConformance(${constName}Adapter, {
  wasmDir: '.',
  columnLimit: COLUMN_LIMIT,
  sources: [CRLF_SOURCE, LF_SOURCE],
});
`;
}

function fixturesReadmeStub(languageId) {
  return `# ${languageId} fixtures

Placeholder, scaffolded by \`npm run new-adapter\`. Populate this
directory with gold-file fixtures (\`.in\`/\`.out\` pairs, or whatever
directory-walking shape this project's existing fixture-driven tests
use — see \`packages/engine/test/fixtures/python/\` for the established
convention) once this adapter grows past what
\`test/conformance/${languageId}-conformance.test.ts\`'s inline
\`sources\` alone can cover. Not required for the conformance suite
itself, which is deliberately fixture-file-free (see that test's own
comments).
`;
}

main();
