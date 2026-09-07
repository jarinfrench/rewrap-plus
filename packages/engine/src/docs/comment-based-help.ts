import type { Block } from '../types/document.js';
import type { SplitBlocksOptions } from '../segmentation/split-blocks.js';
import { toLines } from '../segmentation/to-lines.js';
import { leadingWhitespaceLength } from '../segmentation/verbatim.js';
import { type DocDialect, type DocEmitContext, reflowDocBlocks, segmentLines } from './dialect.js';

/**
 * PowerShell comment-based help's flush-left `.Tag` keywords -- the fixed
 * vocabulary Microsoft's `about_Comment_Based_Help` defines (`.SYNOPSIS`,
 * `.DESCRIPTION`, `.PARAMETER`, `.EXAMPLE`, `.INPUTS`, `.OUTPUTS`,
 * `.NOTES`, `.LINK`, `.COMPONENT`, `.ROLE`, `.FUNCTIONALITY`,
 * `.FORWARDHELPTARGETNAME`, `.FORWARDHELPCATEGORY`,
 * `.REMOTEHELPRUNSPACE`, `.EXTERNALHELP`). Checked against a fixed set,
 * unlike JSDoc/Doxygen/Javadoc's `@`/`\`-prefixed tags: a leading `.word`
 * has real overlap with ordinary prose (a sentence resuming after a
 * period, `.NET` mentioned inline) in a way an `@`/`\`-prefixed marker
 * essentially never does, so restricting to PowerShell's own real
 * keyword vocabulary is what keeps this from misreading prose as a tag --
 * the same "known vocabulary, not just an unrecognized-shape sentinel"
 * guard `./google.ts`'s `KNOWN_SECTIONS` already uses for the identical
 * reason.
 */
const KNOWN_TAGS = new Set([
  'SYNOPSIS',
  'DESCRIPTION',
  'PARAMETER',
  'EXAMPLE',
  'INPUTS',
  'OUTPUTS',
  'NOTES',
  'LINK',
  'COMPONENT',
  'ROLE',
  'FUNCTIONALITY',
  'FORWARDHELPTARGETNAME',
  'FORWARDHELPCATEGORY',
  'REMOTEHELPRUNSPACE',
  'EXTERNALHELP',
]);

const HELP_TAG = /^\.([A-Za-z]+)\b/;

/**
 * A `.Tag` line: flush left, starting with a recognized dot-tag (`.SYNOPSIS`,
 * `.PARAMETER`, ...). Returns the full original line text unchanged -- a
 * `.PARAMETER Name` line's own parameter name stays part of the header
 * text verbatim rather than being parsed out, the identical "don't
 * hardcode a per-tag argument grammar" call `./jsdoc.ts`'s own doc
 * comment already makes for `@param {Type} name`.
 */
function matchHelpTagLine(line: string): boolean {
  if (leadingWhitespaceLength(line) !== 0) {
    return false;
  }
  const match = HELP_TAG.exec(line);
  if (!match) {
    return false;
  }
  return KNOWN_TAGS.has(match[1]!.toUpperCase());
}

interface HelpSection {
  readonly header: string;
  readonly body: readonly string[];
}

/**
 * Split dissolved comment-based-help text into an optional prose preamble
 * plus a flat run of tag sections -- unlike Javadoc/JSDoc/Doxygen's
 * `groupFieldEntries` shape (a label followed by description on the same
 * line, or on *further-indented* continuation lines), PowerShell's own
 * convention writes a `.Tag` alone on its line and its description as
 * ordinary flush-left prose immediately after, at the *same* indent as
 * the tag itself -- structurally identical to `./google.ts`'s
 * `Args:`/`Returns:` section-header shape, not to a field-entry list, so
 * this reuses that shape (a header line, then body lines until the next
 * recognized header) rather than `groupFieldEntries`, which would
 * misfire here: its own continuation rule requires a description to sit
 * *more* indented than its label, which real comment-based-help text
 * never does.
 */
function splitIntoSections(lines: readonly string[]): {
  preamble: readonly string[];
  sections: readonly HelpSection[];
} {
  const preamble: string[] = [];
  const sections: { header: string; body: string[] }[] = [];
  let current: { header: string; body: string[] } | null = null;

  for (const line of lines) {
    if (matchHelpTagLine(line)) {
      current = { header: line, body: [] };
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
 * PowerShell comment-based help: an optional prose preamble, then a flat
 * run of `.SYNOPSIS`/`.DESCRIPTION`/`.PARAMETER`/... sections, each a
 * header line followed by ordinary reflowed prose. Governs a
 * `'docComment'` region (a `<# ... #>` block, per
 * `../comments/wrap-doc-comment.ts`) for PowerShell -- see
 * `../languages/powershell/adapter.ts`'s own doc comment for how a
 * comment-based-help block is told apart from a plain `<# ... #>`
 * comment in the first place (both share the identical grammar node
 * type; only this dialect's own tag vocabulary distinguishes them, since
 * there's no separate node shape the way Java's `line_comment`/
 * `block_comment` split gives Javadoc for free).
 */
export const commentBasedHelpDialect: DocDialect = {
  id: 'commentBasedHelp',

  /**
   * Confidence rises with the number of recognized tag lines found,
   * saturating quickly -- the identical curve and rationale as
   * `jsdocDialect.detect`/`doxygenDialect.detect`/`javadocDialect.detect`:
   * a single `.PARAMETER` is already strong, distinctive evidence, and
   * `KNOWN_TAGS`'s fixed vocabulary (see its own doc comment) is what
   * keeps a chance `.word` in ordinary prose from scoring at all.
   */
  detect(text: string): number {
    const tagCount = toLines(text).filter((line) => matchHelpTagLine(line)).length;
    return tagCount === 0 ? 0 : Math.min(1, 0.5 + tagCount * 0.2);
  },

  segment(text: string, options: SplitBlocksOptions): Block[] {
    const { preamble, sections } = splitIntoSections(toLines(text));

    const blocks: Block[] = [...segmentLines(preamble, options)];
    for (const section of sections) {
      blocks.push({ type: 'sectionHeader', text: section.header });
      blocks.push(...segmentLines(section.body, options));
    }
    return blocks;
  },

  emit(blocks: readonly Block[], ctx: DocEmitContext): string[] {
    return reflowDocBlocks(blocks, ctx);
  },
};
