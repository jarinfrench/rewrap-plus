import type { Block } from '../types/document.js';

/**
 * Reconstruct a `listItem`'s marker (`'-'`, `'1.'`, ...) or a `fieldEntry`'s
 * label (`':param x:'`, `'param (int):'`, ...) as the literal prefix text
 * for the block's first reflowed line.
 *
 * `reflowBlock` deliberately never does this itself -- its own doc comment
 * states the reason: "that belongs to the region's own dissolve/emit step
 * ... which is the only code that knows the marker's *display* form."
 * Every caller that reflows a `listItem`/`fieldEntry` block is therefore
 * responsible for restoring this prefix, via `decorateFirstLine` below, or
 * the marker/label is silently dropped -- found while building docstring
 * emit's dialect support (which needs this for real, since Google/plain dialect
 * lists are common), and retrofitted into `../comments/emit-line-comments.ts`
 * and `../comments/emit-block-comments.ts` at the same time: those two
 * already reflow `listItem` blocks (a bulleted list inside an ordinary
 * comment is legal input) but never applied this step either, so a comment
 * with `- one\n- two` silently lost both bullets on wrap. No shipped
 * fixture happened to exercise a list inside a comment, so nothing catches
 * this until it's fixed at the one shared spot every caller can use.
 * `./reflow-block.ts` is a caller too, internally: a `fieldEntry`'s own
 * nested `blocks` are never exposed to any of the callers above, so its
 * `reflowFieldEntry` calls this directly on each one, the only place that
 * ever can.
 *
 * The marker/label is placed flush at column 0 of the *dissolved* text's
 * own coordinate space, with exactly one space before content -- which is
 * also where `hangingIndent` says content should start
 * (`hangingIndent = indent.length + marker.length + spacing.length`, see
 * `../segmentation/list-item.ts`). Padding out to `hangingIndent` doesn't
 * just add spacing arbitrarily: since the marker's own leading indent
 * (`indent.length`, for a nested list item) isn't tracked as a separate
 * `Block` field -- only the combined `hangingIndent` is -- reproducing it
 * exactly means computing `hangingIndent - marker.length - 1` as the
 * leading-indent width, i.e. assuming exactly one space originally
 * separated the marker from its content. A source list with unusual
 * multi-space separators (`-   text`) normalizes to one space on wrap;
 * every other list-rendering convention in this space does the same, and
 * it's what nearly every real list already looks like.
 */
export function markerPrefix(marker: string, hangingIndent: number): string {
  if (hangingIndent <= marker.length) {
    // Pathological/hand-built input -- never produced by `matchListMarker`
    // or a real `DocDialect.segment`, where `hangingIndent` always leaves
    // room for at least one separating space after the marker.
    return marker;
  }
  const leadingIndentWidth = hangingIndent - marker.length - 1;
  return ' '.repeat(leadingIndentWidth) + marker + ' ';
}

/**
 * Apply `markerPrefix` to the first line of a `reflowBlock` result for a
 * `listItem`/`fieldEntry` block; every other block type (and every line
 * after the first, already indented by `reflowBlock` itself via
 * `hangingIndent`) passes through unchanged.
 *
 * When `lines[0]` is itself empty -- a `listItem`/`fieldEntry` with no
 * content at all (`greedyFill`/`balancedFill`'s own `atoms.length === 0`
 * case, or `../reflow/reflow-block.ts`'s `reflowFieldEntry` returning
 * `['']` for a `blocks: []` entry) -- `markerPrefix`'s own trailing
 * separating space has nothing to separate the marker *from*, so it's
 * trimmed rather than left dangling. Confirmed as more than cosmetic for
 * `fieldEntry` specifically, not just a stray-whitespace nit: a
 * dangling `'label: '` (real label text, still non-blank) instead of a
 * clean `'label:'` is *indistinguishable on re-dissolve* from "this
 * entry's description genuinely starts with a lone space" -- collectEntryBody
 * (`../docs/field-entries.ts`) sees a non-blank entry-start line either
 * way, so a genuine blank line that followed the label in the source
 * (description arrives after a blank separator, `blocks[0]` a `blank`
 * `Block`) silently stopped round-tripping as a blank line at all,
 * breaking `wrap(wrap(x)) === wrap(x)` for two rounds before happening
 * to stabilize -- caught via `test/wrap/nested-field-entry-idempotency.test.ts`-style
 * stress testing, not any single fixture. Trimming here keeps the
 * marker's own line unambiguously non-blank-but-clean on every pass, so
 * re-dissolve is stable from the very first wrap.
 */
export function decorateFirstLine(block: Block, lines: readonly string[]): string[] {
  if (lines.length === 0) {
    return [...lines];
  }
  const prefix =
    block.type === 'listItem'
      ? markerPrefix(block.marker, block.hangingIndent)
      : block.type === 'fieldEntry'
        ? markerPrefix(block.label, block.hangingIndent)
        : null;
  if (prefix === null) {
    return [...lines];
  }
  const firstLine = lines[0]! === '' ? prefix.trimEnd() : prefix + lines[0]!;
  return [firstLine, ...lines.slice(1)];
}
