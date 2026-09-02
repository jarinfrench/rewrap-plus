import type { Block } from '../types/document.js';
import { atomizeWords } from '../segmentation/atomize-words.js';
import type { SplitBlocksOptions } from '../segmentation/split-blocks.js';
import { toLines } from '../segmentation/to-lines.js';
import { leadingWhitespaceLength } from '../segmentation/verbatim.js';
import { type DocDialect, type DocEmitContext, reflowDocBlocks, segmentLines } from './dialect.js';
import { dedentBody, stripLeadingBlanks } from './field-entries.js';

/**
 * Sections whose body is a list of `name : type` entries, each followed
 * by an indented description on the line(s) *below* it — never on the
 * same physical line, unlike Google/Sphinx. `Returns`/`Yields`/`Warns`
 * entries often omit the name entirely (`bool` alone, no `:`), which is
 * exactly why this dialect recognizes an entry by *position* (indent),
 * not by matching a `name : type` pattern the way Google/Sphinx's shared
 * `groupFieldEntries` does — see `segmentFieldSection` below.
 */
const FIELD_SECTIONS = new Set([
  'Parameters',
  'Returns',
  'Yields',
  'Raises',
  'Warns',
  'Other Parameters',
  'Attributes',
  'Methods',
]);

/** Sections whose body is freeform prose. */
const PROSE_SECTIONS = new Set(['See Also', 'Notes', 'References', 'Examples', 'Warnings']);

const KNOWN_SECTIONS = new Set([...FIELD_SECTIONS, ...PROSE_SECTIONS]);

/**
 * NumPy's distinctive two-line header: a known section name flush left,
 * immediately followed by a line of three or more dashes. This pairing
 * is what makes NumPy detection reliable even from a single match — see
 * `numpyDialect.detect`.
 */
function matchHeaderAt(lines: readonly string[], index: number): string | null {
  const line = lines[index] ?? '';
  if (leadingWhitespaceLength(line) !== 0) {
    return null;
  }
  const name = line.replace(/[ \t]+$/, '');
  if (!KNOWN_SECTIONS.has(name)) {
    return null;
  }
  const underline = (lines[index + 1] ?? '').trim();
  return /^-{3,}$/.test(underline) ? name : null;
}

interface SectionBody {
  readonly name: string;
  readonly body: readonly string[];
}

function splitIntoSections(lines: readonly string[]): {
  preamble: readonly string[];
  sections: readonly SectionBody[];
} {
  const preamble: string[] = [];
  const sections: { name: string; body: string[] }[] = [];
  let current: { name: string; body: string[] } | null = null;

  let i = 0;
  while (i < lines.length) {
    const header = matchHeaderAt(lines, i);
    if (header) {
      current = { name: header, body: [] };
      sections.push(current);
      i += 2; // consume both the header line and its underline
      continue;
    }
    if (current) {
      current.body.push(lines[i]!);
    } else {
      preamble.push(lines[i]!);
    }
    i++;
  }

  return { preamble, sections };
}

/**
 * Parse one field-style section's body by position: the first non-blank
 * line establishes `baseIndent` (every entry's own label sits flush at
 * that column); a line at or above `baseIndent` starts a new entry
 * (`sectionHeader`, since a `name : type` line is never itself reflowed —
 * it's short structural text, not prose); everything more-indented below
 * it is that entry's description, represented as a `fieldEntry` with an
 * *empty* label — `../reflow/decorate-block.ts`'s `markerPrefix('',
 * hangingIndent)` degrades gracefully to a pure `hangingIndent`-wide
 * blank prefix, which is exactly the indentation NumPy's description
 * lines need with no visible marker in front of them, unlike Google's
 * entries where description starts glued to the label on the same line.
 *
 * A description is segmented for real structure the same way
 * `./field-entries.ts`'s `groupFieldEntries` does — look-ahead body
 * collection (`collectDescriptionBody`, below, tolerating a blank line
 * as long as more description follows), `dedentBody`, then
 * `segmentLines`/`splitBlocks` — but as its own, separate implementation
 * (see `groupFieldEntries`'s own doc comment for why): NumPy recognizes
 * an entry's *end* purely by indent depth, with no `matchEntryStart`-style
 * regex or "matched but deeper stays in" nuance to account for, since a
 * `name : type` header is never mistakeable for prose the way a
 * flattened nested bullet's `word:` substring could be.
 */
function segmentFieldSection(body: readonly string[], options: SplitBlocksOptions): Block[] {
  const firstContent = body.find((line) => line.trim() !== '');
  if (firstContent === undefined) {
    return body.map((): Block => ({ type: 'blank' }));
  }

  const baseIndent = leadingWhitespaceLength(firstContent);
  const descriptionIndent = baseIndent + 4;

  const blocks: Block[] = [];
  let i = 0;
  while (i < body.length) {
    const line = body[i]!;
    if (line.trim() === '') {
      blocks.push({ type: 'blank' });
      i++;
      continue;
    }
    if (leadingWhitespaceLength(line) > baseIndent) {
      // Deeper-indented line with no preceding label — malformed/hand-
      // edited input; fold it in as an ordinary paragraph rather than
      // dropping it, matching `../field-entries.ts`'s own fallback.
      blocks.push({ type: 'paragraph', atoms: atomizeWords(line) });
      i++;
      continue;
    }

    blocks.push({ type: 'sectionHeader', text: line.replace(/[ \t]+$/, '') });
    i++;
    const { body: descriptionLines, nextIndex } = collectDescriptionBody(body, i, baseIndent);
    i = nextIndex;
    if (descriptionLines.length > 0) {
      // `stripLeadingBlanks` (`./field-entries.ts` — its own doc comment
      // has the full "why," confirmed via stress testing, not
      // hypothetical): NumPy's label is *always* empty, so this applies
      // unconditionally here, not gated on anything the way
      // `groupFieldEntries`'s own equivalent is gated on `entry.rest`.
      blocks.push({
        type: 'fieldEntry',
        label: '',
        hangingIndent: descriptionIndent,
        blocks: segmentLines(stripLeadingBlanks(dedentBody(descriptionLines)), options),
      });
    }
  }

  return blocks;
}

/**
 * Collect one entry's description lines starting at `start`, look-ahead
 * style — mirroring `./field-entries.ts`'s `collectEntryBody` (see that
 * function's own doc comment for the "blank lines inside are fine,
 * trailing blanks aren't" rationale, shared verbatim here): a blank line
 * is tentatively included, but only actually kept if some later line is
 * still deeper than `baseIndent`. NumPy's own stop condition is simpler
 * than `field-entries.ts`'s `isEntryContinuation` — no
 * `matchEntryStart`/sibling-entry check, since a `name : type` header
 * line is recognized purely by sitting at `baseIndent` or shallower, not
 * by matching any particular shape.
 */
function collectDescriptionBody(
  body: readonly string[],
  start: number,
  baseIndent: number,
): { body: readonly string[]; nextIndex: number } {
  let end = start;
  for (; end < body.length; end++) {
    const line = body[end]!;
    if (line.trim() === '') {
      continue; // tentatively included; trimmed below if trailing
    }
    if (leadingWhitespaceLength(line) <= baseIndent) {
      break;
    }
  }
  let trimmedEnd = end;
  while (trimmedEnd > start && body[trimmedEnd - 1]!.trim() === '') {
    trimmedEnd--;
  }
  return { body: body.slice(start, trimmedEnd), nextIndex: trimmedEnd };
}

/**
 * NumPy-style docstrings: a summary/description, then
 * `Parameters`/`Returns`/`Raises`/... sections, each headed by a name
 * immediately underlined with dashes.
 */
export const numpyDialect: DocDialect = {
  id: 'numpy',

  /**
   * Confidence is driven almost entirely by whether the distinctive
   * header-plus-underline pairing appears at all — a single match is
   * already strong evidence (the two-line shape is hard to produce by
   * accident, unlike a lone Google-style `Name:` line), so the curve
   * saturates fast.
   */
  detect(text: string): number {
    const lines = toLines(text);
    let headerCount = 0;
    for (let i = 0; i < lines.length; i++) {
      if (matchHeaderAt(lines, i)) {
        headerCount++;
      }
    }
    return headerCount === 0 ? 0 : Math.min(1, 0.6 + headerCount * 0.2);
  },

  segment(text: string, options: SplitBlocksOptions): Block[] {
    const { preamble, sections } = splitIntoSections(toLines(text));

    const blocks: Block[] = [...segmentLines(preamble, options)];

    for (const section of sections) {
      blocks.push({ type: 'sectionHeader', text: section.name });
      blocks.push({ type: 'sectionHeader', text: '-'.repeat(section.name.length) });
      blocks.push(
        ...(FIELD_SECTIONS.has(section.name)
          ? segmentFieldSection(section.body, options)
          : segmentLines(section.body, options)),
      );
    }

    return blocks;
  },

  emit(blocks: readonly Block[], ctx: DocEmitContext): string[] {
    return reflowDocBlocks(blocks, ctx);
  },
};
