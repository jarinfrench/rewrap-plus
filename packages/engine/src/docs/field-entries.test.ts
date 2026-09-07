import { describe, expect, it } from 'vitest';
import type { Block } from '../types/document.js';
import { groupFieldEntries, type EntryStartMatch } from './field-entries.js';

function matchSimple(line: string): EntryStartMatch | null {
  const m = /^[ \t]*([a-z]+):\s?(.*)$/.exec(line);
  if (!m) return null;
  const [, name = '', rest = ''] = m;
  return { label: `${name}:`, rest };
}

/** A `fieldEntry`'s own `blocks[0]`, for the common case where the whole description is one unstructured paragraph. */
function entryAtomTexts(entry: Extract<Block, { type: 'fieldEntry' }>): string[] {
  return paragraphAtomTexts(entry.blocks[0]);
}

/** A single `paragraph` block's atom texts, for asserting one block among a `fieldEntry`'s several nested `blocks`. */
function paragraphAtomTexts(block: Block | undefined): string[] {
  if (block?.type !== 'paragraph') throw new Error(`expected a paragraph, got ${block?.type}`);
  return block.atoms.map((a) => a.text);
}

describe('groupFieldEntries', () => {
  it('groups a single entry with no continuation', () => {
    const blocks = groupFieldEntries(['x: description'], matchSimple);
    expect(blocks).toEqual([
      {
        type: 'fieldEntry',
        label: 'x:',
        hangingIndent: 4, // entry's own indent (0) + the default continuation width (4)
        blocks: [
          { type: 'paragraph', atoms: [{ text: 'description', width: 11, breakBefore: false }] },
        ],
      },
    ]);
  });

  it("folds indented continuation lines into the entry's atoms", () => {
    const blocks = groupFieldEntries(['x: first line', '    continues here'], matchSimple);
    expect(blocks).toHaveLength(1);
    const entry = blocks[0];
    if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
    expect(entryAtomTexts(entry)).toEqual(['first', 'line', 'continues', 'here']);
  });

  it('starts a new entry when a new label line appears, even if indented no further', () => {
    const blocks = groupFieldEntries(['x: one', 'y: two'], matchSimple);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => (b.type === 'fieldEntry' ? b.label : null))).toEqual(['x:', 'y:']);
  });

  it('starts a new entry when a matching line sits at a shallower indent than the current entry', () => {
    const blocks = groupFieldEntries(['    x: one', '    y: two'], matchSimple);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => (b.type === 'fieldEntry' ? b.label : null))).toEqual(['x:', 'y:']);
  });

  it('does not start a new entry when a matching line is indented deeper than the current entry (regression)', () => {
    // A real fix, not just a workaround for one fixture: `groupFieldEntries`
    // used to end continuation on *any* line matching `matchEntryStart`,
    // regardless of its indent. A field entry's flattened description can
    // legitimately contain a `word:` substring (a nested bullet's own
    // "label: description" shape, plain prose with a colon in it), and
    // reflow is free to break a line right before that word on any given
    // wrap -- when it did, the deeper-indented match was misread as a new
    // sibling entry despite sitting at the *continuation* indent, not the
    // entries' own shared indent, breaking `wrap(wrap(x)) === wrap(x)` for
    // `test/fixtures/python/docstrings/012-pathological-google.*` under
    // `test/wrap/idempotency-all-fixtures.test.ts`. A deeper match must
    // stay folded into the entry that's still open.
    const blocks = groupFieldEntries(['x: one', '   y: two'], matchSimple);
    expect(blocks).toHaveLength(1);
    const entry = blocks[0];
    if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
    expect(entry.label).toBe('x:');
    expect(entryAtomTexts(entry)).toEqual(['one', 'y:', 'two']);
  });

  it('emits a blank block for a blank line', () => {
    const blocks = groupFieldEntries(['x: one', '', 'y: two'], matchSimple);
    expect(blocks.map((b) => b.type)).toEqual(['fieldEntry', 'blank', 'fieldEntry']);
  });

  it('folds an unmatched, non-continuation line in as a plain paragraph', () => {
    const blocks = groupFieldEntries(['not an entry at all'], matchSimple);
    expect(blocks).toEqual([
      { type: 'paragraph', atoms: [{ text: 'not', width: 3, breakBefore: false }, { text: 'an', width: 2, breakBefore: false }, { text: 'entry', width: 5, breakBefore: false }, { text: 'at', width: 2, breakBefore: false }, { text: 'all', width: 3, breakBefore: false }] },
    ]);
  });

  it("reflects the entry's own leading indent in hangingIndent", () => {
    const blocks = groupFieldEntries(['    x: description'], matchSimple);
    const entry = blocks[0];
    if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
    // entry's own indent (4) + the default continuation width (4)
    expect(entry.hangingIndent).toBe(8);
  });

  describe('look-ahead body collection (blank lines inside continuation)', () => {
    it('does not end the entry at a blank line followed by more continuation -- and now preserves the paragraph break, rather than losing it', () => {
      const blocks = groupFieldEntries(
        ['x: first', '    continues', '', '    more after blank'],
        matchSimple,
      );
      // A strict per-line "blank always ends continuation" loop would have
      // produced 3 top-level blocks here (fieldEntry, blank, a paragraph
      // for the trailing line, wrongly detached from the entry it was
      // actually written under). One fieldEntry confirms the look-ahead
      // collection (`collectEntryBody`) kept it together; the entry's own
      // *nested* blocks being `[paragraph, blank, paragraph]`, not one
      // flat paragraph, confirms `segmentLines`/`splitBlocks` (wired in
      // for real segmentation, not `atomizeWords`) preserved the blank
      // line as a real paragraph break instead of silently merging both
      // sides into one run of prose.
      expect(blocks).toHaveLength(1);
      const entry = blocks[0];
      if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
      expect(entry.blocks.map((b) => b.type)).toEqual(['paragraph', 'blank', 'paragraph']);
      expect(paragraphAtomTexts(entry.blocks[0])).toEqual(['first', 'continues']);
      expect(paragraphAtomTexts(entry.blocks[2])).toEqual(['more', 'after', 'blank']);
    });

    it('tolerates more than one consecutive blank line inside continuation, one blank block per source line', () => {
      const blocks = groupFieldEntries(
        ['x: first', '    continues', '', '', '    more'],
        matchSimple,
      );
      expect(blocks).toHaveLength(1);
      const entry = blocks[0];
      if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
      // `splitBlocks` never collapses a run of blank lines into one block
      // (see its own doc comment on why) -- two blank source lines here
      // means two `blank` blocks, not one.
      expect(entry.blocks.map((b) => b.type)).toEqual(['paragraph', 'blank', 'blank', 'paragraph']);
      expect(paragraphAtomTexts(entry.blocks[0])).toEqual(['first', 'continues']);
      expect(paragraphAtomTexts(entry.blocks[3])).toEqual(['more']);
    });

    it('still ends the entry at a genuinely trailing blank line (no further continuation)', () => {
      const blocks = groupFieldEntries(['x: first', '    continues', ''], matchSimple);
      expect(blocks.map((b) => b.type)).toEqual(['fieldEntry', 'blank']);
      const entry = blocks[0];
      if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
      expect(entryAtomTexts(entry)).toEqual(['first', 'continues']);
    });

    it('still ends the entry at a blank line followed by a new sibling entry, unchanged from before', () => {
      const blocks = groupFieldEntries(
        ['x: first', '    continues', '', 'y: two'],
        matchSimple,
      );
      expect(blocks.map((b) => b.type)).toEqual(['fieldEntry', 'blank', 'fieldEntry']);
      const first = blocks[0];
      if (first?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
      expect(entryAtomTexts(first)).toEqual(['first', 'continues']);
    });
  });

  describe('nested structure via splitBlocks (no longer flattened)', () => {
    it('recognizes a nested list inside a description with no leading prose', () => {
      // `x:` itself has nothing after the colon -- the description opens
      // directly with a bullet on the very next line. `blocks[0]` being a
      // real `listItem` (not a `paragraph` whose atoms start with a
      // literal `-`) is exactly the shape `../reflow/reflow-block.ts`'s
      // `reflowFieldEntry` has to budget for specially, alongside the
      // entry's own label sharing that same first line.
      const blocks = groupFieldEntries(
        ['x:', '    - first item', '    - second item'],
        matchSimple,
      );
      expect(blocks).toHaveLength(1);
      const entry = blocks[0];
      if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
      expect(entry.blocks.map((b) => b.type)).toEqual(['listItem', 'listItem']);
      const item0 = entry.blocks[0];
      if (item0?.type !== 'listItem') throw new Error('expected a listItem');
      expect(item0.marker).toBe('-');
      expect(item0.atoms.map((a) => a.text)).toEqual(['first', 'item']);
    });

    it("recognizes a nested list with leading prose on the entry's own line", () => {
      const blocks = groupFieldEntries(
        ['x: Options include:', '    - verbose mode', '    - strict mode'],
        matchSimple,
      );
      const entry = blocks[0];
      if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
      expect(entry.blocks.map((b) => b.type)).toEqual(['paragraph', 'listItem', 'listItem']);
      expect(paragraphAtomTexts(entry.blocks[0])).toEqual(['Options', 'include:']);
    });

    it('recognizes a fenced sample inside a description, unbroken (no blank line) -- the 012/014 fixture shape', () => {
      const blocks = groupFieldEntries(
        ['x: See below.', '    ```', '    example()', '    ```'],
        matchSimple,
      );
      const entry = blocks[0];
      if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
      expect(entry.blocks.map((b) => b.type)).toEqual(['paragraph', 'verbatim']);
      const verbatim = entry.blocks[1];
      if (verbatim?.type !== 'verbatim') throw new Error('expected a verbatim block');
      expect(verbatim.lines).toEqual(['```', 'example()', '```']);
    });

    it("dedents nested structure relative to the entry's own continuation, not the raw source column", () => {
      // Same shape as the previous test, just indented one level deeper
      // (as it would be inside a doubly-nested Google section) -- the
      // `listItem`'s own `hangingIndent` must reflect its depth *within
      // the entry* (2, for '- '), not the raw 8-column source indent, or
      // `reflowFieldEntry`'s combined-indent math breaks.
      const blocks = groupFieldEntries(
        ['        x:', '            - first', '            - second'],
        matchSimple,
      );
      const entry = blocks[0];
      if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
      const item0 = entry.blocks[0];
      if (item0?.type !== 'listItem') throw new Error('expected a listItem');
      expect(item0.hangingIndent).toBe(2);
    });

    it('recognizes a doctest block inside a description -- untested until step 5, only list/fenced content had coverage', () => {
      const blocks = groupFieldEntries(
        ['x: See below.', '    >>> f(1)', '    2'],
        matchSimple,
      );
      const entry = blocks[0];
      if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
      expect(entry.blocks.map((b) => b.type)).toEqual(['paragraph', 'verbatim']);
      const verbatim = entry.blocks[1];
      if (verbatim?.type !== 'verbatim') throw new Error('expected a verbatim block');
      expect(verbatim.lines).toEqual(['>>> f(1)', '2']);
    });

    it('recognizes a Markdown table inside a description -- untested until step 5', () => {
      const blocks = groupFieldEntries(
        ['x: See table.', '    | a | b |', '    |---|---|', '    | 1 | 2 |'],
        matchSimple,
      );
      const entry = blocks[0];
      if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
      expect(entry.blocks.map((b) => b.type)).toEqual(['paragraph', 'verbatim']);
      const verbatim = entry.blocks[1];
      if (verbatim?.type !== 'verbatim') throw new Error('expected a verbatim block');
      expect(verbatim.lines).toEqual(['| a | b |', '|---|---|', '| 1 | 2 |']);
    });

    it('a Markdown-indented sub-bullet inside a fieldEntry becomes a sibling listItem at its own deeper hangingIndent, not nested inside the outer one', () => {
      // Answers the plan's own "Open questions" entry, "how deep does
      // nesting go?" -- more favorably than expected: `listItem` was never
      // given `fieldEntry`'s own nested-`blocks` treatment
      // (`../types/document.ts`'s doc comment on `Block`, and this plan's
      // "Scope: what's affected" section, both explicitly defer that as
      // a separate decision), but a further-indented bullet doesn't
      // *flatten* into the outer item's atoms either -- `splitBlocks`'s
      // own `matchListMarker`/`isListContinuation`
      // (`../segmentation/list-item.ts`) recognize it as its *own*,
      // separate `listItem`, at its own deeper `hangingIndent` reflecting
      // exactly how much further-indented it was in the source (pre-
      // existing `splitBlocks` behavior, unrelated to this plan, now
      // exercised inside a `fieldEntry` for the first time). See
      // `../reflow/reflow-block.test.ts`'s companion case for
      // confirmation that this depth *delta* survives reflow as real
      // visual nesting, not just survives segmentation.
      const blocks = groupFieldEntries(
        ['x:', '    - outer item', '        - inner item'],
        matchSimple,
      );
      const entry = blocks[0];
      if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
      expect(entry.blocks.map((b) => b.type)).toEqual(['listItem', 'listItem']);
      const [outer, inner] = entry.blocks;
      if (outer?.type !== 'listItem' || inner?.type !== 'listItem') {
        throw new Error('expected two listItems');
      }
      expect(outer.hangingIndent).toBe(2); // '- ', at the entry's own baseline
      expect(inner.hangingIndent).toBe(6); // '- ', 4 columns deeper -- the source's own indent delta, preserved by dedentBody
      expect(inner.atoms.map((a) => a.text)).toEqual(['inner', 'item']);
    });
  });

  describe('a leading blank line before the description never survives as blocks[0] (regression)', () => {
    it('strips one leading blank line when entry.rest is empty', () => {
      // `x:` has nothing after the colon, and the very next line is
      // blank before the real description starts. Confirmed via
      // `test/wrap/nested-field-entry-stress.test.ts`: leaving that
      // blank as `blocks[0]` cost `wrap(wrap(x)) === wrap(x)` a full
      // round of drift, since `blocks[0]` shares the label's own
      // physical line and a `blank` block there can never round-trip as
      // a real separator once the label glues onto it (see
      // `stripLeadingBlanks`'s own doc comment for the full mechanism).
      const blocks = groupFieldEntries(
        ['x:', '', '    description after a blank line'],
        matchSimple,
      );
      const entry = blocks[0];
      if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
      expect(entry.blocks.map((b) => b.type)).toEqual(['paragraph']);
      expect(paragraphAtomTexts(entry.blocks[0])).toEqual(['description', 'after', 'a', 'blank', 'line']);
    });

    it('strips more than one leading blank line', () => {
      const blocks = groupFieldEntries(
        ['x:', '', '', '    description after two blank lines'],
        matchSimple,
      );
      const entry = blocks[0];
      if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
      expect(entry.blocks.map((b) => b.type)).toEqual(['paragraph']);
    });

    it('strips a leading blank even when the real first block is a listItem, not a paragraph', () => {
      const blocks = groupFieldEntries(['x:', '', '    - first', '    - second'], matchSimple);
      const entry = blocks[0];
      if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
      expect(entry.blocks.map((b) => b.type)).toEqual(['listItem', 'listItem']);
    });

    it('does not strip a blank line that separates two real blocks (only a leading one)', () => {
      const blocks = groupFieldEntries(
        ['x: Opens with prose.', '', '    More after a real blank.'],
        matchSimple,
      );
      const entry = blocks[0];
      if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
      expect(entry.blocks.map((b) => b.type)).toEqual(['paragraph', 'blank', 'paragraph']);
    });
  });
});
