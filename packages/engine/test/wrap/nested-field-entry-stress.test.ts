import { beforeAll, describe, it } from 'vitest';
import { createTestParserManager } from '../helpers/create-test-parser-manager.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { pythonAdapter } from '../../src/languages/python/adapter.js';
import { javascriptAdapter } from '../../src/languages/javascript/adapter.js';
import { cppAdapter } from '../../src/languages/cpp/adapter.js';
import { javaAdapter } from '../../src/languages/java/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

/**
 * Adversarial stress coverage for `docs/planning/nested-field-entry-structure-plan.md`'s
 * whole `fieldEntry.blocks` change (steps 1-7) and its regression fixes,
 * written after that plan's own commits landed rather than during any one
 * step -- a deliberate second pass hunting for combinations no single
 * step's own fixtures happened to construct. Every case here is an
 * end-to-end `wrapRegions` round trip, not a unit-level `Block` check:
 * extreme column limits, empty/blank-only descriptions, an unbreakable
 * URL inside a nested list, wide/CJK characters, CRLF source, mixed
 * tabs/spaces, 4-level Markdown nesting, `blocks[0]` as a bare
 * `verbatim`/`listItem`/doctest (no leading prose) for both Google and
 * NumPy, a wide Markdown table, an extremely long field label, all six
 * dialects with mixed nested content, and multiple field entries with
 * distinct nested structure in one docstring.
 *
 * This file directly found and fixed two real bugs no committed fixture
 * had caught (both now covered by dedicated regression tests elsewhere
 * too -- `reflow-block.test.ts`'s own verbatim/blank-line cases and
 * `decorate-block.test.ts`'s "genuinely empty content" case): a blank
 * *line* inside a `verbatim` block's own content picking up
 * `hangingIndent` trailing whitespace, and a `fieldEntry` whose
 * description opens with a blank line before any real content violating
 * `wrap(wrap(x)) === wrap(x)` for a full round before stabilizing. The
 * fix for the second bug (`../../src/reflow/decorate-block.ts`'s
 * `decorateFirstLine`, trimming a dangling separator space when there's
 * no content to separate it from) also happened to fix a third,
 * genuinely *pre-existing* bug found along the way -- a fully empty
 * `fieldEntry` (`blocks: []`, the `only-blanks` case below) had always
 * produced a trailing space after its own label or marker, predating
 * this plan entirely (`greedyFill`/`balancedFill`'s own `atoms.length
 * === 0` case). Kept here as permanent coverage, not deleted once fixed,
 * since the whole point of a stress suite like this is to keep
 * exercising the combinations a normal fixture wouldn't think to
 * construct.
 */

function config(overrides: Partial<WrapConfig> = {}): WrapConfig {
  return {
    columnLimit: 50,
    tabSize: 4,
    wrapComments: true,
    wrapStrings: false,
    stringPolicy: 'off',
    docDialect: 'auto',
    preserveIndentedBlocks: false,
    balancedWrapping: false,
    ...overrides,
  };
}

let parserManager: ParserManager;

beforeAll(async () => {
  parserManager = await createTestParserManager([pythonAdapter, javascriptAdapter, cppAdapter, javaAdapter]);
});

async function stress(
  label: string,
  source: string,
  languageId: string,
  columnLimits: number[],
  modes: boolean[] = [false, true],
) {
  for (const columnLimit of columnLimits) {
    for (const balancedWrapping of modes) {
      const cfg = config({ columnLimit, balancedWrapping });
      let wrapped: string;
      try {
        const first = await wrapRegions(source, languageId, 'all', cfg, parserManager);
        wrapped = applyTextEdits(source, first.edits);
      } catch (e) {
        throw new Error(`[${label}] threw at columnLimit=${columnLimit} balanced=${balancedWrapping}: ${e}`, {
          cause: e,
        });
      }

      // Triple-wrap idempotency chain, not just double.
      const second = await wrapRegions(wrapped, languageId, 'all', cfg, parserManager);
      if (second.edits.length !== 0) {
        throw new Error(
          `[${label}] NOT idempotent at columnLimit=${columnLimit} balanced=${balancedWrapping}\n--- first wrap ---\n${wrapped}\n--- second wrap edits ---\n${JSON.stringify(second.edits, null, 2)}`,
        );
      }
      const rewrapped = applyTextEdits(wrapped, second.edits);
      const third = await wrapRegions(rewrapped, languageId, 'all', cfg, parserManager);
      if (third.edits.length !== 0) {
        throw new Error(`[${label}] NOT stable on third wrap at columnLimit=${columnLimit} balanced=${balancedWrapping}`);
      }

      // No trailing whitespace anywhere in the wrapped output.
      for (const [i, line] of wrapped.split('\n').entries()) {
        if (/[ \t]$/.test(line)) {
          throw new Error(
            `[${label}] trailing whitespace on line ${i + 1} at columnLimit=${columnLimit} balanced=${balancedWrapping}: ${JSON.stringify(line)}`,
          );
        }
      }
    }
  }
}

describe('stress: nested field-entry structure -- adversarial inputs beyond the committed suite', () => {
  it('extreme narrow column limits do not crash or corrupt (Google, mixed nested content)', async () => {
    const source = `def f(target):
    """Summary.

    Args:
        target: Options include:

            - verbose: a very long description that will need wrapping across several lines no matter what
            - strict mode

            Example:

            \`\`\`
            f(1)
            \`\`\`
    """
    pass
`;
    await stress('extreme-narrow', source, 'python', [1, 2, 3, 5, 8]);
  }, 30000);

  it('an entry description that is ONLY blank lines after the label degrades gracefully', async () => {
    const source = `def f(target):
    """Summary.

    Args:
        target:


    Returns:
        None.
    """
    pass
`;
    // A genuinely-empty fieldEntry (blocks: []) used to produce a
    // trailing space after the label -- a real, pre-existing bug
    // (predating this plan entirely: `greedyFill`'s own `atoms.length
    // === 0` case glued straight into `markerPrefix`'s unconditional
    // separating space) fixed as a side effect of
    // `decorate-block.ts`'s own trailing-whitespace fix for the
    // `blocks[0]`-is-blank regression, below -- confirmed here with no
    // exception needed.
    await stress('only-blanks', source, 'python', [30, 50]);
  }, 30000);

  it('a very long unbreakable token (URL) inside a nested list item survives the overflow rule', async () => {
    const source = `def f(target):
    """Summary.

    Args:
        target: See below.

            - reference: https://example.com/a/very/long/path/that/cannot/be/broken/anywhere/at/all
            - other: short
    """
    pass
`;
    await stress('long-url-in-list', source, 'python', [20, 40, 50]);
  }, 30000);

  it('unicode/wide characters in nested list content (ASCII label -- non-ASCII identifiers in the label itself are a separate, pre-existing FIELD_ENTRY_LINE regex limitation, not this diff)', async () => {
    const source = `def f(target):
    """Summary.

    Args:
        target: Options include:

            - 详细模式: 打印每个步骤 as it executes with wide characters 你好世界
            - strict: abort early
    """
    pass
`;
    await stress('unicode', source, 'python', [30, 50]);
  }, 30000);

  it('CRLF line endings in the source round-trip correctly', async () => {
    const source = [
      'def f(target):',
      '    """Summary.',
      '',
      '    Args:',
      '        target: Options include:',
      '',
      '            - verbose mode here',
      '            - strict mode here',
      '    """',
      '    pass',
      '',
    ].join('\r\n');
    await stress('crlf', source, 'python', [50]);
  }, 30000);

  it('tabs mixed with spaces in indentation do not crash', async () => {
    const source = `def f(target):
    """Summary.

    Args:
        target: Options include:

            - verbose mode
\t\t\t- strict mode with a tab-indented marker
    """
    pass
`;
    await stress('tabs', source, 'python', [50]);
  }, 30000);

  it('deeply Markdown-nested list (4 levels) preserves depth deltas and stays idempotent', async () => {
    const source = `def f(target):
    """Summary.

    Args:
        target: Options include:
            - level one
                - level two
                    - level three
                        - level four, quite deeply nested indeed
    """
    pass
`;
    await stress('deep-nesting', source, 'python', [40, 50, 80]);
  }, 30000);

  it('description opens directly with verbatim (blocks[0] is a fence, no leading prose) -- Google', async () => {
    const source = `def f(target):
    """Summary.

    Args:
        target:
            \`\`\`
            example_code_here()
            more_code_here()
            \`\`\`
    """
    pass
`;
    await stress('blocks0-verbatim-google', source, 'python', [30, 50, 80]);
  }, 30000);

  it('description opens directly with a bullet (blocks[0] is a listItem, no leading prose) -- Google, multi-line item', async () => {
    const source = `def f(target):
    """Summary.

    Args:
        target:
            - a first item whose text is long enough that it must wrap across multiple lines by itself
            - second item
    """
    pass
`;
    await stress('blocks0-listitem-google', source, 'python', [25, 30, 50]);
  }, 30000);

  it('NumPy: description opens directly with verbatim, no leading prose', async () => {
    const source = `def f(target):
    """Summary.

    Parameters
    ----------
    x : int
        \`\`\`
        example_code_here()
        more_code_here()
        \`\`\`
    """
    pass
`;
    await stress('blocks0-verbatim-numpy', source, 'python', [30, 50, 80]);
  }, 30000);

  it('NumPy: description opens directly with a bullet, multi-line item', async () => {
    const source = `def f(target):
    """Summary.

    Parameters
    ----------
    x : int
        - a first item whose text is long enough that it must wrap across multiple lines by itself
        - second item
    """
    pass
`;
    await stress('blocks0-listitem-numpy', source, 'python', [25, 30, 50]);
  }, 30000);

  it('a table with very wide cells stays verbatim and never gets mangled', async () => {
    const source = `def f(target):
    """Summary.

    Args:
        target: See table.

            | column one | column two is quite a bit wider than the first |
            |---|---|
            | a | this cell has a lot of text in it that would normally need wrapping |
    """
    pass
`;
    await stress('wide-table', source, 'python', [30, 50]);
  }, 30000);

  it('a doctest block sharing blocks[0] with the label, multi-line', async () => {
    const source = `def f(target):
    """Summary.

    Args:
        target:
            >>> f(1)
            2
            >>> f(2)
            4
    """
    pass
`;
    await stress('blocks0-doctest', source, 'python', [30, 50]);
  }, 30000);

  it('an extremely long field label combined with blocks[0] as a listItem', async () => {
    const source = `def f(really_long_parameter_name_here_that_is_quite_verbose):
    """Summary.

    Args:
        really_long_parameter_name_here_that_is_quite_verbose:
            - option a
            - option b
    """
    pass
`;
    await stress('long-label-listitem', source, 'python', [30, 50, 80]);
  }, 30000);

  it('mixed content in a Sphinx :param: entry (shared groupFieldEntries path)', async () => {
    const source = `def f(target):
    """Summary.

    :param x: Options include:

        - verbose: print steps
        - strict: abort early

        Example:

        \`\`\`
        f(1)
        \`\`\`
    """
    pass
`;
    await stress('sphinx-mixed', source, 'python', [30, 50]);
  }, 30000);

  it('mixed content in a JSDoc @param entry', async () => {
    const source = `/**
 * Summary.
 * @param x Options include:
 *
 *   - verbose: print steps
 *   - strict: abort early
 */
function f(x) {}
`;
    await stress('jsdoc-mixed', source, 'javascript', [30, 50]);
  }, 30000);

  it('mixed content in a Doxygen \\param entry', async () => {
    const source = `/// Summary.
/// \\param x Options include:
///
///   - verbose: print steps
///   - strict: abort early
void f(int x);
`;
    await stress('doxygen-mixed', source, 'cpp', [30, 50]);
  }, 30000);

  it('mixed content in a Javadoc @param entry', async () => {
    const source = `/**
 * Summary.
 * @param x Options include:
 *
 *   - verbose: print steps
 *   - strict: abort early
 */
void f(int x) {}
`;
    await stress('javadoc-mixed', source, 'java', [30, 50]);
  }, 30000);

  it('multiple field entries each with their own nested structure in one docstring', async () => {
    const source = `def f(target, second, third):
    """Summary.

    Args:
        target: Options include:
            - verbose mode
            - strict mode
        second: See below.

            \`\`\`
            example()
            \`\`\`
        third: A table:

            | a | b |
            |---|---|
            | 1 | 2 |
    """
    pass
`;
    await stress('multi-entry-mixed', source, 'python', [30, 50, 80]);
  }, 30000);
});
