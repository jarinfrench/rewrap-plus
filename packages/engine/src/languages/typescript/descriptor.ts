import type { LanguageDescriptor } from '../../types/adapter.js';

/**
 * TypeScript's `LanguageDescriptor`, plus TSX's — Phase 12b's second and
 * third ECMAScript-family adapters, alongside the extended
 * `../javascript/` one.
 *
 * ## Why TSX is a separate descriptor, not an alias
 *
 * `LanguageDescriptor.aliases` (see `../javascript/descriptor.ts`'s own
 * `javascriptreact` alias) names additional VSCode languageIds that share
 * *one* descriptor's `grammarWasm` — correct for `javascriptreact`, which
 * really does parse through the exact same `tree-sitter-javascript.wasm`
 * as `javascript`. TSX cannot work that way: `tree-sitter-typescript` the
 * npm package ships *two* separate grammar binaries,
 * `tree-sitter-typescript.wasm` and `tree-sitter-tsx.wasm` — genuinely
 * different grammars (a `<T>` type assertion and a JSX element are
 * ambiguous under one grammar; upstream resolves the ambiguity by
 * building two), not a superset flag on one. So `typescriptreact` gets
 * its own full `LanguageDescriptor`/`id`/registration, pointing at its
 * own vendored `.wasm` (`packages/engine/grammars/PROVENANCE.md`) — the
 * plan's own note ("TSX is a *separate* grammar from TS") named this
 * distinction explicitly.
 *
 * Everything *else* is identical between the two — verified directly by
 * probing both vendored grammars in the same session
 * (`docs/spikes/tree-sitter-typescript-probe.mjs`; write-up in
 * `docs/adapters.md`'s Phase 12b section and `docs/parsing.md`'s Finding
 * 5): one `comment` node type for all three comment forms, a `string`
 * node with no prefix complexity, `binary_expression` with
 * `left`/`operator`/`right` fields for `+`-concatenation. `buildDescriptor`
 * below is the one shared shape both `id`s use, differing only in `id`
 * and `grammarWasm` — data-level sharing, not a second copy to keep in
 * sync by hand.
 */
function buildDescriptor(id: 'typescript' | 'typescriptreact', grammarWasm: string): LanguageDescriptor {
  return {
    id,
    grammarWasm,

    queries: {
      comments: '(comment) @comment',
      strings: '(string) @string',
      // No implicit (bare-adjacency) concatenation in TypeScript/TSX,
      // same as JavaScript — only `+`.
      concatenations: '(binary_expression operator: "+") @concat.operator',
    },

    comments: {
      line: { marker: '//', spaceAfter: true },
      block: { open: '/**', close: '*/', continuationPrefix: '*', alignContinuation: 'open' },
      doc: { markers: ['/**'], dialects: ['jsdoc', 'plain'] },
      neverReflow: [
        /^\/\/\s*eslint-disable/,
        /^\/\/\s*@ts-(expect-error|ignore|nocheck)\b/,
        /^\/\/\s*prettier-ignore\b/,
        /^\/\/\s*istanbul\s+ignore\b/,
      ],
    },

    strings: {
      quotes: [
        { delimiter: '"', multiline: false, escapes: true },
        { delimiter: "'", multiline: false, escapes: true },
      ],
      prefixes: [],
      rawForms: [],
      escapes: {
        sequences: [
          /^\\\r?\n/,
          /^\\\\/,
          /^\\'/,
          /^\\"/,
          /^\\`/,
          /^\\0/,
          /^\\b/,
          /^\\f/,
          /^\\n/,
          /^\\r/,
          /^\\t/,
          /^\\v/,
          /^\\x[0-9a-fA-F]{2}/,
          /^\\u\{[0-9a-fA-F]+\}/,
          /^\\u[0-9a-fA-F]{4}/,
        ],
      },
      // Template literals (`${}` interpolation) are a separate
      // `template_string` node, deliberately never captured by
      // `queries.strings` — see `../javascript/descriptor.ts`'s own doc
      // comment for the full rationale (the same deferral applies here
      // unchanged).
      placeholders: [],
      concatenation: { style: 'operator', operator: '+', operatorPlacement: 'trailing' },
    },
  };
}

export const typescriptDescriptor: LanguageDescriptor = buildDescriptor(
  'typescript',
  'grammars/tree-sitter-typescript.wasm',
);

export const typescriptReactDescriptor: LanguageDescriptor = buildDescriptor(
  'typescriptreact',
  'grammars/tree-sitter-tsx.wasm',
);
