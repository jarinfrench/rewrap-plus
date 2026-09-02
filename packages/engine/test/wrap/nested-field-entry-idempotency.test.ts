import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { pythonAdapter } from '../../src/languages/python/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

/**
 * Step 5 of docs/planning/nested-field-entry-structure-plan.md's
 * "Suggested execution order": an idempotency pass across content the
 * existing gold fixtures (`012`/`013`/`014-pathological-*`) don't
 * exercise. Those three cover one nested list plus one fenced sample
 * each, at one column limit, deliberately narrow per their own scope —
 * this file probes the *other* structured content `splitBlocks`
 * recognizes (a doctest block, a Markdown table) once nested inside a
 * field entry, plus a Markdown-indented sub-bullet (a deeper-nested
 * `listItem`, not itself given `fieldEntry`'s own nested-`blocks`
 * treatment — see `../../src/docs/field-entries.test.ts`'s own
 * "Markdown-indented sub-bullet" case for why that's fine, not a gap),
 * across several column limits and both reflow modes.
 *
 * Deliberately *not* a new gold-fixture pair (that's step 6's job, and
 * hand-authoring an exact expected `.out.py` for content this varied
 * would just reconstruct the same scratch-generation workaround used to
 * update `012`-`014`): this file only asserts the idempotency
 * *property* (`wrap(wrap(x)) === wrap(x)`), not any particular exact
 * output, mirroring how `idempotency-all-fixtures.test.ts` itself never
 * asserts exact text either — only that a *second* wrap changes nothing
 * further.
 */
const SOURCE = `def deploy(target, mode):
    """Deploy to the given target.

    Args:
        target: Options include:
            - verbose mode
                - extra verbose sub-mode, indented one level deeper still
            - strict mode

        mode: See the example below.

            >>> deploy("prod", "strict")
            True

            | mode    | verbose |
            |---------|---------|
            | strict  | no      |
            | verbose | yes     |

    Returns:
        None: Nothing is returned.
    """
    return _do_deploy(target, mode)
`;

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

// `.` resolves against Vitest's cwd (this package's root) — see
// `../../src/parser/parser-manager.test.ts` for the same pattern.
const engineRoot = '.';

let parserManager: ParserManager;

beforeAll(async () => {
  const registry = new AdapterRegistry();
  registry.register(pythonAdapter);
  parserManager = await ParserManager.create({ wasmDir: engineRoot, registry });
});

describe('idempotency for nested field-entry content beyond the 012-014 fixtures (step 5)', () => {
  describe.each([
    ['greedy', false],
    ['balanced', true],
  ] as const)('%s mode', (_mode, balancedWrapping) => {
    // A range wide enough to force very different wrap points (30: nearly
    // everything wraps hard) through comfortably wide (100: almost
    // nothing needs to), plus the fixture suite's own conventional 50 —
    // the plan's own "at more than one column limit" callout.
    it.each([30, 40, 50, 60, 80, 100])('wrap(wrap(x)) === wrap(x) at columnLimit %i', async (columnLimit) => {
      const cfg = config({ columnLimit, balancedWrapping });

      const first = await wrapRegions(SOURCE, 'python', 'all', cfg, parserManager);
      const wrapped = applyTextEdits(SOURCE, first.edits);

      const second = await wrapRegions(wrapped, 'python', 'all', cfg, parserManager);
      expect(second.edits).toEqual([]);
    });
  });

  it('preserves the nested list, doctest, and table structurally through a wrap — not just producing zero further edits by accident', async () => {
    // A wrap that happened to produce a stable-but-wrong result (say,
    // every structural marker flattened to prose on the *first* wrap,
    // which would then trivially be "idempotent" against itself) would
    // still pass every check above. Confirm the *first* wrap's own
    // output still has real structure, not just stability.
    const result = await wrapRegions(SOURCE, 'python', 'all', config(), parserManager);
    const wrapped = applyTextEdits(SOURCE, result.edits);

    expect(wrapped).toContain('- verbose mode');
    expect(wrapped).toContain('- extra verbose sub-mode');
    expect(wrapped).toContain('- strict mode');
    expect(wrapped).toContain('>>> deploy("prod", "strict")');
    expect(wrapped).toContain('| mode');
    expect(wrapped).toContain('|---------|---------|');

    // The deeper sub-bullet must still visually sit to the right of its
    // parent — the depth delta `dedentBody` preserves through
    // segmentation (`../../src/docs/field-entries.test.ts`) and
    // `reflowFieldEntry` preserves through reflow
    // (`../../src/reflow/reflow-block.test.ts`) must survive the *whole*
    // pipeline end to end, not just each half in isolation.
    const lines = wrapped.split('\n');
    const outerLine = lines.find((l) => l.includes('- verbose mode'));
    const innerLine = lines.find((l) => l.includes('- extra verbose'));
    if (!outerLine || !innerLine) throw new Error('expected both bullet lines to survive the wrap');
    expect(innerLine.indexOf('-')).toBeGreaterThan(outerLine.indexOf('-'));
  });
});
