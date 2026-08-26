import type { RegionKind, WrappableRegion } from './region.js';
import type { WrapConfig } from './config.js';
import type { DocDialectId } from './doc-dialect.js';
import type { SyntaxNode, Tree } from './tree-sitter-types.js';

/** One recognized quote form, e.g. Python's `'`, `"`, `'''`, `"""`. */
export interface QuoteSpec {
  /** Opening delimiter as it appears in source. */
  readonly delimiter: string;
  /** Closing delimiter, if different from `delimiter`. Defaults to `delimiter` when omitted. */
  readonly closeDelimiter?: string;
  /** Whether this quote form may span multiple lines without an explicit continuation. */
  readonly multiline: boolean;
  /** Whether backslash escape sequences are recognized inside this quote form. */
  readonly escapes: boolean;
}

/** A recognized string-literal prefix, e.g. Python's `r`, `b`, `f`, `rb`. */
export interface PrefixSpec {
  /**
   * The literal prefix text, cased as written in the descriptor. Case
   * normalization (Python allows `R`, `B`, `F`, and mixed-case
   * combinations like `Rb`) is the adapter's concern, not the descriptor's.
   */
  readonly prefix: string;
  /**
   * Disables escape processing — a raw string. Raw strings are flagged
   * non-reflowable by default (Phase 3: "r-strings and b-strings must be
   * flagged as non-reflowable by default").
   */
  readonly raw?: boolean;
  /** Marks a byte string rather than text. Byte strings are rarely prose and are non-reflowable by default. */
  readonly bytes?: boolean;
  /**
   * Marks a formatted/interpolated string (e.g. an f-string); its `{expr}`
   * interpolations become atomic units during segmentation (Phase 6).
   */
  readonly formatted?: boolean;
}

/** A raw-form delimiter pair that is never reflowed, e.g. C++'s `R"(` … `)"`. */
export interface RawFormSpec {
  readonly open: string;
  readonly close: string;
}

/**
 * Escape sequences recognized inside a language's string literals. Each
 * pattern matches one complete sequence starting at its leading backslash
 * — the atom segmenter (Phase 5) never splits inside a match.
 */
export interface EscapeSpec {
  readonly sequences: readonly RegExp[];
}

/**
 * The declarative shape of a language's syntax, independent of any parsing
 * logic.
 *
 * Design rule: anything expressible as a descriptor field must not be a
 * method — that's what keeps "add a language" a configuration task
 * (write a descriptor plus fixtures) rather than a development project.
 */
export interface LanguageDescriptor {
  /** Must match the VSCode languageId, e.g. `'python'`. */
  readonly id: string;

  /**
   * Additional languageIds this descriptor also applies to, e.g.
   * `'typescriptreact'` alongside `'typescript'`, or `'cpp'` vs `'c'`.
   */
  readonly aliases?: readonly string[];

  /**
   * Path or identifier for this language's tree-sitter grammar WASM,
   * resolved lazily by `ParserManager` (Phase 2) — never loaded eagerly.
   */
  readonly grammarWasm: string;

  readonly queries: {
    /** tree-sitter query source matching comment nodes. */
    readonly comments: string;
    /** tree-sitter query source matching string literal nodes. */
    readonly strings: string;
    /** tree-sitter query source matching concatenation constructs, if the language has any beyond bare adjacency. */
    readonly concatenations?: string;
  };

  readonly comments: {
    readonly line?: { readonly marker: string; readonly spaceAfter: boolean };
    readonly block?: {
      readonly open: string;
      readonly close: string;
      /**
       * Per-line continuation marker, e.g. JSDoc/Doxygen's leading `*`.
       * Python has no block comments, so the v1 Python adapter leaves
       * this unset (Phase 6b introduces the first adapter that does).
       */
      readonly continuationPrefix?: string;
      readonly alignContinuation?: 'open' | 'indent';
    };
    readonly doc?: {
      readonly markers: readonly string[];
      readonly dialects: readonly DocDialectId[];
    };
    /**
     * Patterns that must never be reflowed regardless of policy, e.g.
     * `# noqa`, `// eslint-disable`, pragmas. Moving one of these to a
     * different line can change program behavior.
     */
    readonly neverReflow: readonly RegExp[];
    /**
     * Pattern matching a leading keyword/decorator/shebang strong enough,
     * on its own, to call a dissolved comment line code-like rather than
     * prose — e.g. Python's `def `/`class `/`import `/... . Anchored to
     * the start of an already-trimmed line by convention, though the
     * pattern itself is free to express that however it needs to.
     *
     * Optional: a language that doesn't set this still gets the
     * engine's shared punctuation-density signal (`../comments/looks-like-code.ts`)
     * on its own — weaker without a keyword list, but never absent
     * outright, so a language can start pure-data and add this later
     * without an engine change. Found to matter in Phase 6b: an earlier
     * version of this heuristic hardcoded Python's own keyword list
     * directly inside dissolve, which the JavaScript canary adapter
     * would have needed to either duplicate or fork — exactly the kind
     * of Python-specific assumption baked into shared code that the
     * canary exists to catch (see `docs/adapters.md`).
     */
    readonly codeLikeKeywords?: RegExp;
  };

  readonly strings: {
    readonly quotes: readonly QuoteSpec[];
    readonly prefixes: readonly PrefixSpec[];
    readonly rawForms: readonly RawFormSpec[];
    readonly escapes: EscapeSpec;
    /** Format placeholder patterns — `{}`, `%s`, `${}` — that segmentation treats as atomic units. */
    readonly placeholders: readonly RegExp[];
    readonly concatenation: {
      readonly style: 'implicit' | 'operator';
      readonly operator?: string;
      /** True if a bare multi-part literal is only valid where grouping already exists, e.g. Python needing enclosing parens. */
      readonly requiresGrouping?: boolean;
      readonly operatorPlacement?: 'leading' | 'trailing';
    };
  };
}

/**
 * Context threaded from an adapter's `emitContext` hook into the emit step.
 * Refined once emit is implemented (Phase 9) — for now this is a small,
 * intentionally open bag of adapter-specific data, e.g. Python's "does
 * this concatenation run already sit inside a grouping construct" check,
 * which decides whether parentheses must be inserted on emit.
 */
export interface EmitContext {
  readonly [key: string]: unknown;
}

/**
 * Escape hatches for behavior a descriptor can't express as data. All
 * optional — a language needing none of them is pure data. The engine
 * provides a default implementation of each, driven entirely by the
 * descriptor; Python (Phase 3+) overrides `classify` (docstring-by-
 * position) and, later, `emitContext` (paren insertion). Most languages
 * are expected to override nothing.
 */
export interface LanguageAdapter {
  readonly descriptor: LanguageDescriptor;

  /**
   * Override region classification for a matched node, e.g. distinguishing
   * a docstring from an ordinary string literal by its syntactic position.
   * Returning `null` excludes the node from discovery.
   */
  classify?(node: SyntaxNode, source: string): RegionKind | null;

  /**
   * Override how discovered regions are grouped, e.g. merging an implicit-
   * concatenation run into a single multi-part region.
   */
  groupRegions?(regions: readonly WrappableRegion[]): WrappableRegion[];

  /**
   * Override eligibility beyond the shared prose heuristic — e.g. refusing
   * raw strings, byte strings, or mixed-prefix concatenation runs. A hard
   * gate: `false` here means "would be wrong to attempt," checked
   * regardless of `WrapConfig.stringPolicy`.
   */
  isSafeToWrap?(region: WrappableRegion, source: string): boolean;

  /**
   * Override string-wrap eligibility beyond `../prose-heuristic.ts`'s
   * shared, text-only `looksLikeProse` — for context that heuristic can't
   * see from text alone, e.g. a dict literal's key (the plan's own named
   * "context signal": "string is a dict key → skip"). A soft gate,
   * consulted only when `WrapConfig.stringPolicy` is `'prose'` — `'all'`
   * bypasses both this and the shared heuristic, `'off'` never reaches
   * either. Receives `tree` (unlike `isSafeToWrap`) because context
   * signals like this one are exactly the kind of question only real
   * syntax-tree access can answer correctly; see
   * `../languages/python/emit-context.ts`'s own doc comment for why a
   * text-only proxy for "is this a dict key" risks false positives
   * `isSafeToWrap`'s text-only checks don't have to worry about.
   */
  isProseEligible?(region: WrappableRegion, source: string, tree: Tree, cfg: WrapConfig): boolean;

  /**
   * Override the text `../prose-heuristic.ts`'s shared `looksLikeProse`
   * scores for a region. Defaults to the region's own raw source text
   * (`sliceSpanText(source, region.span)` — quote delimiters, prefix
   * letters, and all) when this hook is absent.
   *
   * That default is wrong for a language whose string syntax has real
   * quote/prefix characters at the edges: a `looksLikeProse` check that
   * anchors to the *whole* trimmed text (e.g. "is this a single dotted
   * identifier, start to end") is defeated by a literal `"`/`'` sitting
   * right at each end, since the anchored pattern no longer matches
   * across the whole string. Found via this phase's own dict/i18n-key
   * gold fixture: `"errors.validation.some_key"` (with its quotes)
   * scored as prose — the identifier-shape check's `^...$` anchors
   * couldn't match through the surrounding quote characters — while the
   * same text with its quotes stripped correctly scored as not-prose.
   * Python's implementation returns `dissolveString`'s own logical text
   * (`../languages/python/dissolve-string.ts`) for exactly this reason.
   */
  proseText?(region: WrappableRegion, source: string): string;

  /**
   * Compute emit-time context for a region, e.g. whether enclosing
   * grouping already exists and parentheses must be added.
   *
   * Takes `cfg` alongside `region`/`tree` — refined here in Phase 9 from
   * the two-argument shape earlier phases anticipated, since resolving
   * Python's own concatenation style needs `cfg.concatStyle` (an adapter-
   * interpreted override, per that field's own doc comment on
   * `./config.ts`) alongside the syntax-tree lookup
   * (`../languages/python/emit-context.ts`).
   */
  emitContext?(region: WrappableRegion, tree: Tree, cfg: WrapConfig): EmitContext;

  /**
   * Dissolve, dialect-segment, reflow, and emit one `'docstring'` region,
   * returning its replacement source text — or `undefined` if this
   * adapter doesn't support docstrings at all (the default: most
   * languages have no string-literal-as-documentation convention to
   * support).
   *
   * Deliberately a whole-pipeline hook rather than several smaller ones
   * (unlike `classify`/`groupRegions`/`isSafeToWrap`, each a narrow
   * override of one default behavior): a docstring's own delimiter
   * syntax (Python's triple-quoted string literal) is inherently
   * language-specific in a way line/block comment syntax isn't — see
   * `../languages/python/dissolve-docstring.ts`'s own doc comment for
   * why this can't be expressed as descriptor data the same way
   * `comments.line`/`comments.block` are, and so can't be dispatched
   * generically from `../wrap.ts` the way `'lineComment'`/`'blockComment'`
   * regions are. `RegionKind`'s separate `'docComment'` variant is
   * reserved for a *different*, more comment-shaped documentation
   * convention (JSDoc, Doxygen) that a future adapter is expected to
   * dispatch through the existing block-comment machinery instead, once
   * it exists.
   */
  wrapDocstring?(region: WrappableRegion, source: string, cfg: WrapConfig): string;

  /**
   * Dissolve, resolve emit context, and emit one `'stringLiteral'` region,
   * returning its replacement source text — or `undefined` if this
   * adapter doesn't support string-literal wrapping at all.
   *
   * A whole-pipeline hook for the same reason `wrapDocstring` is one: a
   * string's own concatenation syntax and paren-insertion rules (Phase 9)
   * are inherently language-specific, not expressible as `comments.line`/
   * `comments.block`-style descriptor data. Unlike `wrapDocstring`, this
   * also receives the parsed `Tree` — paren insertion needs real syntax
   * context (is this concatenation already inside a call's argument list,
   * a list literal, ...?) that `region`/`source` alone can't answer; see
   * `../languages/python/emit-context.ts`'s own doc comment for what that
   * lookup actually does.
   */
  wrapString?(region: WrappableRegion, source: string, cfg: WrapConfig, tree: Tree): string;
}
