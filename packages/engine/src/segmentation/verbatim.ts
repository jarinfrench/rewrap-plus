/**
 * A verbatim run recognized starting at some line index.
 */
export interface VerbatimMatch {
  /** The raw lines making up the block, verbatim — unindented copies are
   * never taken here; whatever leading whitespace the source line had is
   * preserved, since a verbatim block passes through untouched. */
  readonly lines: string[];
  /** Index in the caller's line array to resume scanning from. */
  readonly nextIndex: number;
}

function leadingWhitespaceLength(line: string): number {
  return /^[ \t]*/.exec(line)?.[0].length ?? 0;
}

/**
 * Fenced code blocks: ```` ``` ```` or `~~~`, three or more repeats of the
 * same character, optionally followed by an info string (` ```python`).
 *
 * The close fence must use the same character and be at least as long as
 * the open fence (CommonMark's rule) — but per this project's "bias
 * toward verbatim when uncertain," a fence that's never closed still
 * consumes the rest of the text as verbatim rather than falling back to
 * treating an unterminated fence as ordinary prose.
 */
const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})/;

export function matchFencedCode(lines: readonly string[], i: number): VerbatimMatch | null {
  const line = lines[i] ?? '';
  const open = FENCE_OPEN.exec(line);
  if (!open) {
    return null;
  }
  const fenceChar = open[1]!.charAt(0);
  const fenceLen = open[1]!.length;

  const collected = [line];
  let j = i + 1;
  for (; j < lines.length; j++) {
    const candidate = lines[j]!;
    collected.push(candidate);
    const close = /^[ \t]*([`~]{3,})\s*$/.exec(candidate);
    if (close && close[1]!.charAt(0) === fenceChar && close[1]!.length >= fenceLen) {
      j++;
      break;
    }
  }
  return { lines: collected, nextIndex: j };
}

/**
 * Doctest blocks: a `>>>` prompt line, any `...` continuation lines, and
 * any expected-output lines that follow — all the way to the next blank
 * line. Reflowing any of this would change what the doctest asserts, so
 * the whole run is taken verbatim rather than trying to distinguish
 * prompt/continuation/output lines from each other.
 */
const DOCTEST_PROMPT = /^[ \t]*>>>/;

export function matchDoctestBlock(lines: readonly string[], i: number): VerbatimMatch | null {
  const first = lines[i] ?? '';
  if (!DOCTEST_PROMPT.test(first)) {
    return null;
  }
  const collected: string[] = [];
  let j = i;
  for (; j < lines.length; j++) {
    const line = lines[j]!;
    if (line.trim() === '') {
      break;
    }
    collected.push(line);
  }
  return { lines: collected, nextIndex: j };
}

/**
 * Markdown tables: a `|`-delimited row immediately followed by a
 * delimiter row (dashes, optional colons for alignment, e.g.
 * `|---|:--:|`). Requiring the delimiter row before committing avoids
 * misfiring on a single line that merely happens to contain a `|`.
 */
function isTableRow(line: string): boolean {
  return line.trim() !== '' && line.includes('|');
}

function isTableDelimiterRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && trimmed.includes('-') && /^\|?[\s:|-]+\|?$/.test(trimmed);
}

export function matchTableBlock(lines: readonly string[], i: number): VerbatimMatch | null {
  const first = lines[i] ?? '';
  const second = lines[i + 1];
  if (!isTableRow(first) || second === undefined || !isTableDelimiterRow(second)) {
    return null;
  }
  const collected: string[] = [];
  let j = i;
  for (; j < lines.length && isTableRow(lines[j]!); j++) {
    collected.push(lines[j]!);
  }
  return { lines: collected, nextIndex: j };
}

/**
 * A contiguous run of indented and/or blank lines starting at `i`. Returns
 * `null` if `lines[i]` itself isn't already non-blank and indented — the
 * run's first line anchors what counts as "indented" for the rest of it,
 * so it must qualify on its own rather than being pulled in as this
 * function's own leading blank/dedent case.
 *
 * Once started, the run consumes blank lines *within* it (they might be
 * meaningful whitespace inside a code sample) but trims any blank lines
 * off the *end* of the run — those belong to whatever separates this
 * block from what follows, not to the block itself, and leaving them
 * attached would make them vanish as far as `splitBlocks`'s 1:1
 * blank-block accounting is concerned (see `./split-blocks.ts`).
 *
 * Shared by two callers with the same underlying shape but different
 * triggers:
 * - the reST `::` literal-block convention (a paragraph line ending in
 *   `::`, a blank line, then an indented block) — always active,
 *   regardless of `preserveIndentedBlocks`, since it's an explicit
 *   syntactic marker rather than a heuristic;
 * - `WrapConfig.preserveIndentedBlocks`: *any* indented, non-list-marker
 *   line becomes verbatim when the option is on.
 */
export function matchIndentedRun(lines: readonly string[], i: number): VerbatimMatch | null {
  const first = lines[i];
  if (first === undefined || first.trim() === '' || leadingWhitespaceLength(first) === 0) {
    return null;
  }
  let j = i;
  for (; j < lines.length; j++) {
    const line = lines[j]!;
    if (line.trim() === '') {
      continue;
    }
    if (leadingWhitespaceLength(line) === 0) {
      break;
    }
  }
  let end = j;
  while (end > i && lines[end - 1]!.trim() === '') {
    end--;
  }
  if (end === i) {
    return null;
  }
  return { lines: lines.slice(i, end), nextIndex: end };
}

export { leadingWhitespaceLength };
