import type { LanguageDescriptor } from '../../types/adapter.js';

/**
 * Markdown's `LanguageDescriptor` — the first `'prose'`-only descriptor
 * in this project (`docs/planning/markdown-latex-plan.md` §5.1). Unlike
 * every comment/string language before it, Markdown declares none of
 * `queries.comments`, `queries.strings`, or `strings`: the document *is*
 * the prose, not something living inside comments or string literals, so
 * there is nothing comment- or string-shaped to query for at all (§1's
 * "why prose is a different shape" — see `docs/adapters.md`'s own
 * "Markdown and LaTeX — prose languages" section for the engine-level
 * leaks this shape found).
 *
 * `queries.prose: '(paragraph) @prose'` is intentionally the *only*
 * discovery mechanism this descriptor needs: the block grammar
 * (`tree-sitter-markdown.wasm`, vendored per `../../grammars/PROVENANCE.md`)
 * already resolves paragraph/list/quote/table structure, so
 * `languages/markdown/adapter.ts`'s `discoverProse` can be a thin capture
 * plus exclusion pass over this one query rather than the masked
 * line-scan LaTeX's own `discoverProse` will need (no paragraph node
 * exists in that grammar at all — §3.2/§6.2).
 *
 * `grammarWasm` and `queries.prose`'s exact capture shape are both
 * confirmed directly against the vendored WASM, not assumed — see
 * `docs/spikes/tree-sitter-markdown-probe.mjs` and `docs/parsing.md`
 * Finding 7 for the probe this descriptor is built from.
 */
export const markdownDescriptor: LanguageDescriptor = {
  id: 'markdown',

  grammarWasm: 'grammars/tree-sitter-markdown.wasm',

  queries: {
    prose: '(paragraph) @prose',
  },

  /**
   * No line/block/doc comment forms at all — Markdown's HTML comments
   * (`<!-- ... -->`) are left verbatim (`html_block` is never a region,
   * §5.6), matching Rewrap's own behavior ("detected but wrapping their
   * contents is not yet supported"). `neverReflow` stays required (an
   * empty array, never omitted) because `dissolveLineComments` reads it
   * unconditionally — cheaper to keep this one field real than to make
   * it optional for the one descriptor that never reaches that code path
   * at all (`docs/planning/markdown-latex-plan.md` §5.1's own note).
   */
  comments: {
    neverReflow: [],
  },

  /**
   * Markdown has no line-comment marker for `../../directives.ts`'s
   * `scanDirectives` to fall back to (`comments.line` is unset above),
   * but still needs a directive syntax — the natural one is an HTML
   * comment, `<!-- rewrap: off -->`, left verbatim otherwise (the same
   * `html_block` exclusion above is exactly where it lives).
   * `buildDirectivePattern` regex-escapes this before splicing it in, so
   * the trailing `-->` and a multi-line HTML comment both just work
   * against it without any special-casing here.
   */
  directives: {
    marker: '<!--',
  },
};
