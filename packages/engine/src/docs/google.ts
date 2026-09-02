import type { Block } from '../types/document.js';
import type { SplitBlocksOptions } from '../segmentation/split-blocks.js';
import { toLines } from '../segmentation/to-lines.js';
import { leadingWhitespaceLength } from '../segmentation/verbatim.js';
import { type DocDialect, type DocEmitContext, reflowDocBlocks, segmentLines } from './dialect.js';
import { groupFieldEntries, type EntryStartMatch } from './field-entries.js';

/**
 * Sections whose body is a list of named entries — `param (type):
 * description` — parsed via `groupFieldEntries`. `Returns`/`Yields` are
 * included even though Google style also allows a bare, nameless
 * description there (`segment` below falls back to plain prose for a
 * section where nothing actually matched an entry).
 */
const FIELD_SECTIONS = new Set([
  'Args',
  'Arguments',
  'Keyword Args',
  'Other Parameters',
  'Attributes',
  'Raises',
  'Returns',
  'Yields',
]);

/** Sections whose body is freeform prose — reflowed as ordinary paragraphs/lists/verbatim, no entry parsing. */
const PROSE_SECTIONS = new Set([
  'Note',
  'Notes',
  'Example',
  'Examples',
  'Warning',
  'Warnings',
  'See Also',
  'Todo',
  'References',
]);

const KNOWN_SECTIONS = new Set([...FIELD_SECTIONS, ...PROSE_SECTIONS]);

/**
 * A section header line: a known section name, alone on its own line,
 * flush left (no indent) — the universal Google/napoleon convention.
 * Anything else ending in `:` (a field entry's own `name:`, an inline
 * `Note: ...` with content after the colon) is deliberately *not* a
 * header — only the fixed, known vocabulary and "alone on the line"
 * shape qualify, so a line that merely resembles one in passing prose
 * doesn't get misread as starting a section.
 */
const SECTION_HEADER = /^([A-Za-z][A-Za-z ]*):$/;

function matchSectionHeader(line: string): string | null {
  if (leadingWhitespaceLength(line) !== 0) {
    return null;
  }
  const trimmed = line.replace(/[ \t]+$/, '');
  const match = SECTION_HEADER.exec(trimmed);
  if (!match) {
    return null;
  }
  const name = match[1]!;
  return KNOWN_SECTIONS.has(name) ? name : null;
}

/**
 * An entry's own label: a name (optionally `*`/`**`-prefixed for
 * `*args`/`**kwargs`, dotted for something like `self.attr`), an optional
 * parenthesized type/annotation, then a colon. Multi-space separators
 * after the colon normalize to one, matching
 * `../reflow/decorate-block.ts`'s `markerPrefix` convention for list
 * markers.
 */
const FIELD_ENTRY_LINE = /^[ \t]*(\*{0,2}[A-Za-z_][\w.]*(?:\s*\([^()]*\))?)\s*:\s?(.*)$/;

/**
 * This regex is applied per *physical* line of already-dissolved text,
 * with no notion of "this line used to be the middle of a reflowed
 * paragraph" — so a field entry's flattened description containing a
 * `word:` substring (a nested bullet's own "label: description" shape,
 * or just a sentence with a colon in it) could, before the fix
 * described in `./field-entries.ts`'s `isEntryContinuation`, be misread
 * as a brand-new entry if a later re-wrap happened to break a line
 * right before that word. See that function's own doc comment for the
 * fix and the confirmed idempotency bug it closes.
 */

function matchGoogleEntry(line: string): EntryStartMatch | null {
  const match = FIELD_ENTRY_LINE.exec(line);
  if (!match) {
    return null;
  }
  const [, name = '', rest = ''] = match;
  return { label: `${name}:`, rest };
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

  for (const line of lines) {
    const header = matchSectionHeader(line);
    if (header) {
      current = { name: header, body: [] };
      sections.push(current);
      continue;
    }
    if (current) {
      current.body.push(line);
    } else {
      preamble.push(line);
    }
  }

  return { preamble, sections };
}

/**
 * Google-style (napoleon) docstrings: a summary/description, then
 * `Args:`/`Returns:`/`Raises:`/... sections, each either a list of named
 * entries or freeform prose depending on which section it is.
 */
export const googleDialect: DocDialect = {
  id: 'google',

  /**
   * Confidence rises with the number of recognized section headers
   * found — a single `Returns:` is a real (if weak) signal on its own,
   * and several distinct headers make misidentification very unlikely.
   * Zero headers found means zero confidence outright: unlike NumPy's
   * two-line header+underline (a strong, hard-to-fake signal even from
   * one match), a lone Google-style header alone on a line has enough
   * overlap with an ordinary "Label:" prose line that requiring at least
   * one *known* name (already enforced by `matchSectionHeader`) is doing
   * the real disambiguating work here, not the count.
   */
  detect(text: string): number {
    const headerCount = toLines(text).filter((line) => matchSectionHeader(line) !== null).length;
    return headerCount === 0 ? 0 : Math.min(1, 0.5 + headerCount * 0.25);
  },

  segment(text: string, options: SplitBlocksOptions): Block[] {
    const { preamble, sections } = splitIntoSections(toLines(text));

    const blocks: Block[] = [...segmentLines(preamble, options)];

    for (const section of sections) {
      blocks.push({ type: 'sectionHeader', text: `${section.name}:` });

      if (!FIELD_SECTIONS.has(section.name)) {
        blocks.push(...segmentLines(section.body, options));
        continue;
      }

      const fieldBlocks = groupFieldEntries(section.body, matchGoogleEntry, options);
      // `Returns`/`Yields` (and, rarely, hand-written `Args`) may carry
      // no recognizable `name:`/`type:` entry at all — legitimate bare
      // prose under Google style. `groupFieldEntries` already falls back
      // to one `paragraph` block *per line* for input it can't parse as
      // an entry, which would wrongly keep an ordinary multi-line
      // description from merging into a single reflowable paragraph;
      // re-running the section body through the ordinary prose path
      // instead, whenever nothing in it matched as a real entry, avoids
      // that.
      const matchedAnyEntry = fieldBlocks.some((block) => block.type === 'fieldEntry');
      blocks.push(...(matchedAnyEntry ? fieldBlocks : segmentLines(section.body, options)));
    }

    return blocks;
  },

  emit(blocks: readonly Block[], ctx: DocEmitContext): string[] {
    return reflowDocBlocks(blocks, ctx);
  },
};
