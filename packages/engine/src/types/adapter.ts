import type { RegionKind, WrappableRegion } from './region.js';
import type { WrapConfig } from './config.js';
import type { DocDialectId } from './doc-dialect.js';
import type { PositionMapper } from './position-mapper.js';
import type { SyntaxNode, Tree } from './tree-sitter-types.js';

/**
 * Options threaded through region discovery. Defined here, rather than in
 * `../discovery/discover-regions.ts` where it's consumed, so that
 * `LanguageAdapter.discoverProse` below can reference it without that
 * file importing back from this one -- `discover-regions.ts` already
 * imports `LanguageAdapter` from this module, so the reverse import would
 * be circular.
 */
export interface DiscoverRegionsOptions {
  /**
   * Tab width used to compute `WrappableRegion.indentColumn`. Defaults to
   * 4 -- see `../discovery/visual-indent-column.ts` for why a real
   * `WrapConfig.tabSize` isn't threaded through yet.
   */
  readonly tabSize?: number;

  /**
   * An already-built `PositionMapper` for the same `source` text
   * `discoverRegions` is about to run against. Several callers upstream
   * (`../wrap.ts`, and the VSCode extension's cursor/selection/range
   * commands) already need one of these to turn a cursor position or
   * selection into a `SourceSpan` before calling in here -- passing that
   * same instance through lets `discoverRegions` skip building its own
   * second copy of the identical per-line checkpoint table. Falls back to
   * constructing one internally when omitted, so every existing direct
   * caller (this package's own tests, the conformance kit) is unaffected.
   */
  readonly mapper?: PositionMapper;

  /**
   * An already-computed `source.split('\n')` for the same `source` text.
   * `../wrap.ts` already splits `source` once, up front, for its own
   * line-ending detection (see `detectLineEndingNear`'s doc comment on
   * why that split must happen exactly once per call) -- passing the same
   * array through here lets `discoverRegions`'s own per-line indent
   * lookups reuse it instead of re-splitting the same string a second
   * time. Falls back to splitting internally when omitted.
   */
  readonly sourceLines?: readonly string[];
}

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
   * Disables escape processing -- a raw string. Raw strings, like byte
   * strings, are flagged non-reflowable by default.
   */
  readonly raw?: boolean;
  /** Marks a byte string rather than text. Byte strings are rarely prose and are non-reflowable by default. */
  readonly bytes?: boolean;
  /**
   * Marks a formatted/interpolated string (e.g. an f-string); its `{expr}`
   * interpolations become atomic units during segmentation.
   */
  readonly formatted?: boolean;
}

/** A raw-form delimiter pair that is never reflowed, e.g. C++'s `R"(` ... `)"`. */
export interface RawFormSpec {
  readonly open: string;
  readonly close: string;
}

/**
 * Escape sequences recognized inside a language's string literals. Each
 * pattern matches one complete sequence starting at its leading backslash
 * -- the atom segmenter never splits inside a match.
 */
export interface EscapeSpec {
  readonly sequences: readonly RegExp[];
}

/**
 * The declarative shape of a language's syntax, independent of any parsing
 * logic.
 *
 * Design rule: anything expressible as a descriptor field must not be a
 * method -- that's what keeps "add a language" a configuration task
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
   * resolved lazily by `ParserManager` -- never loaded eagerly.
   */
  readonly grammarWasm: string;

  readonly queries: {
    /**
     * tree-sitter query source matching comment nodes. Optional as of the
     * `'prose'` region kind: a prose language with nothing comment-shaped
     * worth wrapping (e.g.
     * Markdown, which leaves HTML comments verbatim) omits this rather
     * than declaring a query that's structurally present but captures
     * nothing -- the JavaScript canary's own inert-but-valid `strings`
     * block (see `strings` below) was exactly this workaround for
     * `queries.strings`, and this project decided not to repeat the
     * pattern a second time now that there's a real reason not to.
     */
    readonly comments?: string;
    /**
     * tree-sitter query source matching string literal nodes. Optional
     * for the same reason `comments` above is -- a language with no
     * string-literal syntax at all (Markdown, LaTeX) omits it, along with
     * `strings` below.
     */
    readonly strings?: string;
    /** tree-sitter query source matching concatenation constructs, if the language has any beyond bare adjacency. */
    readonly concatenations?: string;
    /**
     * tree-sitter query source matching `'prose'` regions -- one capture
     * per paragraph-shaped unit, e.g. Markdown's `(paragraph) @prose`.
     * Optional even for a prose language: LaTeX has no paragraph node at
     * all (`docs/parsing.md` Finding 8), so its `discoverProse` hook
     * does a masked line scan instead of running a query. When present,
     * `discoverProse` is expected to read it via
     * `../discovery/capture.js`'s `captureNodes`/`captureNodesByName`
     * rather than re-implementing query running -- declaring it as
     * descriptor data (instead of hardcoding the pattern inside the
     * hook) keeps it covered by the conformance kit's "every declared
     * query compiles against the grammar" check.
     */
    readonly prose?: string;
  };

  readonly comments: {
    readonly line?: { readonly marker: string; readonly spaceAfter: boolean };
    /**
     * The open/close/continuation-prefix delimiter for a `'docComment'`
     * region (JSDoc/Doxygen's `/** ... * /` shape) -- reused verbatim by a
     * plain `'blockComment'` region too, unless `plainBlock` below
     * declares a distinct delimiter for that kind. Python has no block
     * comments, so the Python adapter leaves this unset.
     */
    readonly block?: {
      readonly open: string;
      readonly close: string;
      readonly continuationPrefix?: string;
      readonly alignContinuation?: 'open' | 'indent';
    };
    /**
     * A distinct open/close/continuation-prefix delimiter for a plain
     * `'blockComment'` region, when it differs from `block` above -- e.g.
     * C-family languages, where `/* ... * /` (no doc marker) and
     * `/** ... * /` (JSDoc/Doxygen) share a close delimiter but not an
     * open one. Omit when a language's plain and doc-marked block
     * comments share one delimiter, or when the language has no plain
     * block-comment form worth wrapping distinctly from `block`.
     */
    readonly plainBlock?: {
      readonly open: string;
      readonly close: string;
      readonly continuationPrefix?: string;
      readonly alignContinuation?: 'open' | 'indent';
    };
    readonly doc?: {
      readonly markers: readonly string[];
      readonly dialects: readonly DocDialectId[];
      /**
       * Which of `markers` above (if any) uses a repeated-per-line marker
       * convention (e.g. Doxygen's `///`) instead of `block`'s open/close
       * pair -- a genuinely different delimiter *shape*, not just a
       * different marker string. When set, a `'docComment'` region whose
       * text starts with this exact marker dissolves/emits through the
       * same per-line machinery a `'lineComment'` region uses, segmented
       * through a `DocDialect` instead of plain paragraph splitting.
       */
      readonly repeatedMarker?: string;
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
     * prose -- e.g. Python's `def `/`class `/`import `/... . Anchored to
     * the start of an already-trimmed line by convention, though the
     * pattern itself is free to express that however it needs to.
     *
     * Optional: a language that doesn't set this still gets the
     * engine's shared punctuation-density signal (`../comments/looks-like-code.ts`)
     * on its own -- weaker without a keyword list, but never absent
     * outright, so a language can start pure-data and add this later
     * without an engine change. Found to matter when the JavaScript
     * canary adapter was added: an earlier version of this heuristic
     * hardcoded Python's own keyword list directly inside dissolve,
     * which the canary adapter would have needed to either duplicate or
     * fork -- exactly the kind of Python-specific assumption baked into
     * shared code that the canary exists to catch (see
     * `docs/adapters.md`).
     */
    readonly codeLikeKeywords?: RegExp;
  };

  /**
   * String-literal syntax: quote forms, prefixes, raw-form delimiters,
   * escapes, placeholders, and concatenation style. Optional as of the
   * `'prose'` region kind: Markdown and LaTeX have no string-literal
   * concept at all, so this -- and `queries.strings` above -- is simply
   * omitted rather than
   * populated with a structurally-valid-but-meaningless value.
   * `validateDescriptor` (`../adapter-registry.ts`) requires this field
   * and `queries.strings` to be declared together, or not at all.
   */
  readonly strings?: {
    readonly quotes: readonly QuoteSpec[];
    readonly prefixes: readonly PrefixSpec[];
    readonly rawForms: readonly RawFormSpec[];
    readonly escapes: EscapeSpec;
    /** Format placeholder patterns -- `{}`, `%s`, `${}` -- that segmentation treats as atomic units. */
    readonly placeholders: readonly RegExp[];
    readonly concatenation: {
      readonly style: 'implicit' | 'operator';
      readonly operator?: string;
      /** True if a bare multi-part literal is only valid where grouping already exists, e.g. Python needing enclosing parens. */
      readonly requiresGrouping?: boolean;
      readonly operatorPlacement?: 'leading' | 'trailing';
    };
  };

  /**
   * The comment marker `../directives.ts`'s `scanDirectives` should look
   * for when scanning this language's source for `rewrap: off`/`on`/
   * `ignore`/`force` directives, consulted by `../wrap.ts` ahead of
   * `comments.line?.marker`. Most languages leave this unset -- their
   * line-comment marker already *is* the right directive marker, which is
   * what the `comments.line?.marker` fallback covers. It exists
   * separately because a prose language's natural directive marker isn't
   * always its line-comment marker: Markdown has no line comment at all
   * but writes directives as `<!-- rewrap: off -->` (an HTML comment,
   * left verbatim otherwise), so it declares
   * `directives: { marker: '<!--' }`. LaTeX's `%`
   * line-comment marker already doubles as its directive marker, so it
   * needs no override.
   */
  readonly directives?: {
    readonly marker: string;
  };
}

/**
 * Escape hatches for behavior a descriptor can't express as data. All
 * optional -- a language needing none of them is pure data. The engine
 * provides a default implementation of each, driven entirely by the
 * descriptor; Python overrides `classify` (docstring-by-position), among
 * others. Most languages are expected to override nothing.
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
   * Override eligibility beyond both the shared prose heuristic *and* the
   * engine's own unconditional baseline (`../strings/is-string-safe-to-wrap-baseline.js`
   * -- line-continuation escapes, irregular whitespace) that `../wrap.js`
   * applies to every `'stringLiteral'` region before ever consulting this
   * hook, hook present or not. Use this for further, language-specific
   * refusals the baseline can't know about -- e.g. refusing raw strings,
   * byte strings, or mixed-prefix concatenation runs. A hard gate: `false`
   * here means "would be wrong to attempt," checked regardless of
   * `WrapConfig.stringPolicy`, and *in addition to* the baseline (AND --
   * both must return `true`, and neither can waive the other). Omitting
   * this hook no longer means "every region is safe" on its own; it means
   * "no further refusals beyond the baseline" -- the baseline alone is
   * enough for a language with no string-shape hazards of its own (see
   * `../languages/java/adapter.js`, `../languages/ecmascript/adapter-support.js`,
   * neither of which declares this hook at all).
   */
  isSafeToWrap?(region: WrappableRegion, source: string): boolean;

  /**
   * Override string-wrap eligibility beyond `../prose-heuristic.ts`'s
   * shared, text-only `looksLikeProse` -- for context that heuristic can't
   * see from text alone, e.g. a dict literal's key (a named context
   * signal: "string is a dict key -> skip"). A soft gate,
   * consulted only when `WrapConfig.stringPolicy` is `'prose'` -- `'all'`
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
   * scores for a region. Defaults to `dissolveString`'s own logical text
   * (`../strings/dissolve-string.ts`'s `text` -- quote delimiters and
   * prefix letters stripped) when this hook is absent, since every
   * `'stringLiteral'` region this default is ever consulted for comes
   * from a language that declares `LanguageDescriptor.strings` in the
   * first place -- there is no `'stringLiteral'` region kind without one.
   *
   * The raw source slice this default used to fall back to
   * (`sliceSpanText(source, region.span)`) is wrong for a language whose
   * string syntax has real quote/prefix characters at the edges: a
   * `looksLikeProse` check that anchors to the *whole* trimmed text (e.g.
   * "is this a single dotted identifier, start to end") is defeated by a
   * literal `"`/`'` sitting right at each end, since the anchored pattern
   * no longer matches across the whole string. Found via a dict/i18n-key
   * gold fixture: `"errors.validation.some_key"` (with its quotes) scored
   * as prose -- the identifier-shape check's `^...$` anchors couldn't
   * match through the surrounding quote characters -- while the same text
   * with its quotes stripped correctly scored as not-prose. Every
   * adapter with string support needed the identical fix (Python's own
   * `proseText` override predates this default; C++/Java/JavaScript/
   * TypeScript no longer need one at all now that the engine's own
   * default does the same `dissolveString` lookup), which is why this is
   * the engine's default rather than a per-adapter override: overriding
   * this hook is now needed only for a region kind `dissolveString`
   * doesn't handle (Python's `'docstring'`, which needs its own
   * triple-quote-aware dissolve -- see `../languages/python/adapter.ts`).
   */
  proseText?(region: WrappableRegion, source: string): string;

  /**
   * Dissolve, dialect-segment, reflow, and emit one `'docstring'` region,
   * returning its replacement source text -- or `undefined` if this
   * adapter doesn't support docstrings at all (the default: most
   * languages have no string-literal-as-documentation convention to
   * support).
   *
   * Deliberately a whole-pipeline hook rather than several smaller ones
   * (unlike `classify`/`groupRegions`/`isSafeToWrap`, each a narrow
   * override of one default behavior): a docstring's own delimiter
   * syntax (Python's triple-quoted string literal) is inherently
   * language-specific in a way line/block comment syntax isn't -- see
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
   * returning its replacement source text -- or `undefined` if this
   * adapter doesn't support string-literal wrapping at all.
   *
   * A whole-pipeline hook for the same reason `wrapDocstring` is one: a
   * string's own concatenation syntax and paren-insertion rules are
   * inherently language-specific, not expressible as `comments.line`/
   * `comments.block`-style descriptor data. Unlike `wrapDocstring`, this
   * also receives the parsed `Tree` -- paren insertion needs real syntax
   * context (is this concatenation already inside a call's argument list,
   * a list literal, ...?) that `region`/`source` alone can't answer; see
   * `../languages/python/emit-context.ts`'s own doc comment for what that
   * lookup actually does.
   */
  wrapString?(region: WrappableRegion, source: string, cfg: WrapConfig, tree: Tree): string;

  /**
   * Produce every `'prose'` region in `tree` -- one paragraph-shaped unit
   * per region, `parts` = the region's physical lines with their
   * container prefix (block-quote marker, list hanging indent, ...)
   * excluded from each part's span, the same per-line contract
   * `'lineComment'` regions already follow.
   *
   * A whole-pipeline discovery hook rather than descriptor query data
   * alone, for the same reason `wrapDocstring`/`wrapString` are
   * whole-pipeline *wrap* hooks: Markdown's discovery is expressible as a
   * `queries.prose` capture plus straightforward exclusion logic, but
   * LaTeX's isn't -- there's no paragraph node in that grammar at all, so
   * its prose regions come from a line scan masked by other tree spans
   * (`docs/parsing.md` Finding 8). One mechanism that covers both shapes
   * beats a query-only mechanism that only covers one.
   *
   * `discoverRegions` (`../discovery/discover-regions.ts`) calls this
   * *in addition to* its own query-driven comment/string discovery -- an
   * adapter can (and Markdown does) still omit `queries.comments`/
   * `queries.strings` entirely and rely on this alone.
   *
   * Returns `[]` (the default when this hook is absent) for a language
   * with no prose to discover, e.g. every existing comment/string
   * language -- none of them override this.
   */
  discoverProse?(
    tree: Tree,
    source: string,
    languageId: string,
    options: DiscoverRegionsOptions,
  ): WrappableRegion[];

  /**
   * Dissolve, reflow, and emit one `'prose'` region, returning its
   * replacement source text -- or `undefined` if this adapter doesn't
   * support `'prose'` regions at all (the default: every comment/string
   * language, which never produces one via `discoverProse` in the first
   * place).
   *
   * A whole-pipeline hook, like `wrapDocstring`/`wrapString`: a prose
   * region's continuation prefix is derived from its container ancestry
   * (a block quote's `>`, a list item's hanging indent, ...), which needs
   * real tree access the same way a string's paren-insertion rules do --
   * hence the `tree` parameter, unlike the generic `'lineComment'`/
   * `'blockComment'` dissolve/emit pair `../wrap.ts` drives itself from
   * `LanguageDescriptor` data alone. See `../prose/` for the shared
   * dissolve/emit machinery this is built on.
   */
  wrapProse?(region: WrappableRegion, source: string, cfg: WrapConfig, tree: Tree): string;
}
