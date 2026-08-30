import type { SourceSpan } from './span.js';

/**
 * A VSCode-shaped position: `line` is a 0-based line number, `character` is
 * a 0-based UTF-16 code-unit offset into that line. Matches
 * `vscode.Position`'s `line`/`character` shape without this package
 * depending on the `vscode` module itself.
 */
export interface Position {
  readonly line: number;
  readonly character: number;
}

interface LineIndex {
  /** UTF-8 byte offset of this line's first character. */
  readonly startByte: number;
  /** UTF-16 code-unit offset of this line's first character. */
  readonly startUtf16: number;
  /** The line's text, excluding its terminating `\n`, if any. */
  readonly text: string;
  /**
   * Byte/UTF-16 offsets (both relative to this line's own start) recorded
   * every `CHECKPOINT_INTERVAL` UTF-16 units into `text`, always starting
   * with `{ byte: 0, utf16: 0 }` — see `nearestCheckpoint`'s own doc
   * comment for why these exist.
   */
  readonly checkpoints: readonly Checkpoint[];
}

/** One entry of a `LineIndex.checkpoints` table — see that field's doc comment. */
interface Checkpoint {
  readonly utf16: number;
  readonly byte: number;
}

/**
 * How many UTF-16 units apart `LineIndex.checkpoints` entries are spaced.
 * Small enough that the linear scan `positionToByteOffset`/
 * `byteOffsetToPosition` still do *within* a chunk stays cheap, large
 * enough that the checkpoint table itself stays a small fraction of a
 * line's own length.
 */
const CHECKPOINT_INTERVAL = 256;

/** Number of UTF-8 bytes needed to encode a single Unicode code point. */
function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/**
 * Build `lineText`'s checkpoint table: `{ utf16: 0, byte: 0 }` followed by
 * one entry every `CHECKPOINT_INTERVAL` UTF-16 units, in ascending order of
 * both fields (the two axes advance together, one direction is never ahead
 * of the other) — see `nearestCheckpoint`'s doc comment for why.
 */
function buildCheckpoints(lineText: string): Checkpoint[] {
  const checkpoints: Checkpoint[] = [{ utf16: 0, byte: 0 }];
  let utf16Acc = 0;
  let byteAcc = 0;
  let sinceLastCheckpoint = 0;

  for (const ch of lineText) {
    byteAcc += utf8ByteLength(ch.codePointAt(0)!);
    utf16Acc += ch.length;
    sinceLastCheckpoint += ch.length;
    if (sinceLastCheckpoint >= CHECKPOINT_INTERVAL) {
      checkpoints.push({ utf16: utf16Acc, byte: byteAcc });
      sinceLastCheckpoint = 0;
    }
  }

  return checkpoints;
}

/**
 * Greatest checkpoint whose `field` value is `<= target`, via binary
 * search — `checkpoints` is always non-empty (`buildCheckpoints` always
 * emits the `{0, 0}` entry), so this always finds one.
 *
 * The one table built per line serves both lookup directions
 * (`byteOffsetToPosition` searches by `.byte`, `positionToByteOffset` by
 * `.utf16`) because both fields advance together in the same order:
 * a checkpoint's UTF-16 offset is never past another's while its byte
 * offset is behind, so "sorted by utf16" and "sorted by byte" are the
 * same ordering.
 */
function nearestCheckpoint(
  checkpoints: readonly Checkpoint[],
  target: number,
  field: 'utf16' | 'byte',
): Checkpoint {
  let lo = 0;
  let hi = checkpoints.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (checkpoints[mid]![field] <= target) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return checkpoints[lo]!;
}

/**
 * The single place that converts between tree-sitter's UTF-8 byte offsets
 * and VSCode's UTF-16 `Position`s, for one fixed source text (see
 * `./span.ts` for why this split exists — the two schemes agree for ASCII
 * and diverge for everything else).
 *
 * Built once per parse. Every later phase that needs to turn a tree-sitter
 * node into a `SourceSpan`, or translate a position back into a byte
 * offset, goes through an instance of this class rather than re-deriving
 * the conversion.
 *
 * Line endings: a line's `text` includes every character up to (but not
 * including) its terminating `\n` — so for a CRLF file, a trailing `\r` is
 * currently counted as an ordinary character of the line, which overstates
 * `character` by one relative to VSCode's own CRLF column semantics.
 * Detecting and specially handling CRLF (line ending and trailing
 * whitespace preservation) is handled elsewhere; this mapper only
 * commits to the UTF-8/UTF-16 conversion itself.
 */
export class PositionMapper {
  private readonly lines: readonly LineIndex[];

  constructor(source: string) {
    this.lines = PositionMapper.buildLineIndex(source);
  }

  private static buildLineIndex(source: string): LineIndex[] {
    const lines: LineIndex[] = [];

    let byteOffset = 0;
    let utf16Offset = 0;
    let lineStartByte = 0;
    let lineStartUtf16 = 0;

    for (const ch of source) {
      // Iterating a string with for-of yields whole code points, one per
      // step — a surrogate pair (astral character, e.g. an emoji) is never
      // split across iterations, so codePointAt(0) below is always the
      // full code point.
      const codePoint = ch.codePointAt(0)!;

      if (ch === '\n') {
        const text = source.slice(lineStartUtf16, utf16Offset);
        lines.push({
          startByte: lineStartByte,
          startUtf16: lineStartUtf16,
          text,
          checkpoints: buildCheckpoints(text),
        });
        byteOffset += utf8ByteLength(codePoint);
        utf16Offset += ch.length;
        lineStartByte = byteOffset;
        lineStartUtf16 = utf16Offset;
        continue;
      }

      byteOffset += utf8ByteLength(codePoint);
      utf16Offset += ch.length;
    }

    const lastText = source.slice(lineStartUtf16);
    lines.push({
      startByte: lineStartByte,
      startUtf16: lineStartUtf16,
      text: lastText,
      checkpoints: buildCheckpoints(lastText),
    });

    return lines;
  }

  private lineAt(row: number): LineIndex {
    const line = this.lines[row];
    if (!line) {
      throw new RangeError(
        `PositionMapper: row ${row} is out of range (document has ${this.lines.length} lines)`,
      );
    }
    return line;
  }

  /** Greatest line index whose start byte offset is <= `byteOffset`. */
  private rowForByteOffset(byteOffset: number): number {
    let lo = 0;
    let hi = this.lines.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.lines[mid]!.startByte <= byteOffset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }

  /**
   * Convert a tree-sitter UTF-8 byte offset to a VSCode-shaped UTF-16
   * position.
   *
   * Scans forward from the nearest checkpoint at or before `byteIntoLine`,
   * not from the line's own start — a plain start-of-line scan made this
   * method (and its counterpart below) cost `O(line length)` *per call*,
   * which every node-span computation in `discoverRegions` pays at least
   * once. For a single pathologically long line (a long `+`-chained
   * concatenation, or one huge string literal, is exactly this named
   * risk shape), that turned "discover every region in the file"
   * quadratic in that line's length — confirmed by direct timing (a
   * 20,000-operand concatenation on one line took over two minutes) before
   * this fix. `CHECKPOINT_INTERVAL`-bounded scans make each call's cost
   * independent of line length again.
   */
  byteOffsetToPosition(byteOffset: number): Position {
    const row = this.rowForByteOffset(byteOffset);
    const line = this.lineAt(row);
    const byteIntoLine = byteOffset - line.startByte;

    const checkpoint = nearestCheckpoint(line.checkpoints, byteIntoLine, 'byte');
    let byteAcc = checkpoint.byte;
    let utf16Acc = checkpoint.utf16;
    for (const ch of line.text.slice(checkpoint.utf16)) {
      if (byteAcc >= byteIntoLine) break;
      byteAcc += utf8ByteLength(ch.codePointAt(0)!);
      utf16Acc += ch.length;
    }

    return { line: row, character: utf16Acc };
  }

  /**
   * Convert a VSCode-shaped UTF-16 position back to a tree-sitter UTF-8
   * byte offset. See `byteOffsetToPosition`'s doc comment for why this
   * scans forward from a nearby checkpoint rather than the line's start.
   */
  positionToByteOffset(position: Position): number {
    const line = this.lineAt(position.line);

    const checkpoint = nearestCheckpoint(line.checkpoints, position.character, 'utf16');
    let byteAcc = checkpoint.byte;
    let utf16Acc = checkpoint.utf16;
    for (const ch of line.text.slice(checkpoint.utf16)) {
      if (utf16Acc >= position.character) break;
      byteAcc += utf8ByteLength(ch.codePointAt(0)!);
      utf16Acc += ch.length;
    }

    return line.startByte + byteAcc;
  }

  /**
   * Build a full `SourceSpan` from a tree-sitter node's raw byte range,
   * filling in UTF-16 row/column on both ends via this mapper.
   */
  spanFromByteRange(startByte: number, endByte: number): SourceSpan {
    const start = this.byteOffsetToPosition(startByte);
    const end = this.byteOffsetToPosition(endByte);

    return {
      startByte,
      endByte,
      startRow: start.line,
      startColumn: start.character,
      endRow: end.line,
      endColumn: end.character,
    };
  }
}
