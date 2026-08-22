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
}

/** Number of UTF-8 bytes needed to encode a single Unicode code point. */
function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
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
 * Detecting and specially handling CRLF is Phase 10's job ("add line
 * ending and trailing whitespace preservation"); this mapper only commits
 * to the UTF-8/UTF-16 conversion itself.
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
        lines.push({
          startByte: lineStartByte,
          startUtf16: lineStartUtf16,
          text: source.slice(lineStartUtf16, utf16Offset),
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

    lines.push({
      startByte: lineStartByte,
      startUtf16: lineStartUtf16,
      text: source.slice(lineStartUtf16),
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

  /** Convert a tree-sitter UTF-8 byte offset to a VSCode-shaped UTF-16 position. */
  byteOffsetToPosition(byteOffset: number): Position {
    const row = this.rowForByteOffset(byteOffset);
    const line = this.lineAt(row);
    const byteIntoLine = byteOffset - line.startByte;

    let byteAcc = 0;
    let utf16Acc = 0;
    for (const ch of line.text) {
      if (byteAcc >= byteIntoLine) break;
      byteAcc += utf8ByteLength(ch.codePointAt(0)!);
      utf16Acc += ch.length;
    }

    return { line: row, character: utf16Acc };
  }

  /** Convert a VSCode-shaped UTF-16 position back to a tree-sitter UTF-8 byte offset. */
  positionToByteOffset(position: Position): number {
    const line = this.lineAt(position.line);

    let byteAcc = 0;
    let utf16Acc = 0;
    for (const ch of line.text) {
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
