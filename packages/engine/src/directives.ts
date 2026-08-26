/**
 * Answers to "does a directive comment affect the region starting at this
 * row?" — precomputed once per `wrapRegions` call (`./wrap.ts`) by
 * scanning the whole source for `# rewrap: ...`/`# fmt: ...` comments,
 * independent of region discovery. Deliberately engine-level and
 * region-kind-agnostic — Phase 9's plan names this "engine: add directive
 * comment support for opt-in and opt-out," not a Python- or
 * string-specific concern, even though a string's own `stringPolicy:
 * 'prose'` gate (`./wrap.ts`) is the only place `isForcedAt` currently has
 * anything to override.
 */
export interface DirectiveScan {
  /** Is `row` inside a `# rewrap: off` / `# fmt: off` .. `on` range? */
  isDisabledAt(row: number): boolean;
  /** Was `row` immediately preceded (or trailed) by `# rewrap: ignore`? */
  isIgnoredAt(row: number): boolean;
  /** Was `row` immediately preceded (or trailed) by `# rewrap: force`? */
  isForcedAt(row: number): boolean;
}

/**
 * Matches a directive comment anywhere on a line — `rewrap` or `fmt`,
 * `off`/`on`/`ignore`/`force`. `fmt` only ever means `off`/`on` in real
 * usage (Black has no `fmt: ignore`/`fmt: force`); this pattern matches
 * all four actions for either family and `scanDirectives` below simply
 * never produces an ignore/force entry for `fmt`, rather than needing a
 * second, narrower pattern.
 */
const DIRECTIVE_PATTERN = /#\s*(rewrap|fmt)\s*:\s*(off|on|ignore|force)\b/i;

/**
 * Scan `source` once for every directive comment, producing row-indexed
 * answers `wrapRegions` can consult per candidate region.
 *
 * ## Off/on ranges
 *
 * `# rewrap: off` and `# fmt: off` both set the *same* disabled state —
 * "fmt:off/on honored as well, since Black users already have them" reads
 * as treating the two families equivalently, not as two independently
 * tracked toggles a user could get out of sync by mixing (`rewrap: off`
 * .. `fmt: on` closes the very range `rewrap: off` opened). An
 * unterminated `off` (no matching `on` before EOF) disables every
 * following row for the rest of the file — the safer failure mode than
 * silently re-enabling at EOF.
 *
 * ## Attaching `ignore`/`force` to a target row
 *
 * A **trailing** directive (real content precedes the `#` on its own
 * line) targets *that same row* — `x = "foo"  # rewrap: force` forces the
 * region that also starts on that row. A **standalone** directive (a
 * comment alone on its line) targets the *next* row — the common
 * `# rewrap: ignore` / `x = "foo"` pairing. This only looks at the
 * immediately adjacent row in either direction; a blank line or another
 * comment between a standalone directive and its intended target isn't
 * recognized. A known, deliberate simplification (real-world directive
 * comments overwhelmingly sit directly adjacent to what they govern, the
 * same convention `# noqa`/`# type: ignore` already rely on) rather than
 * an attempt to resolve "which region did the user mean" as a general
 * matching problem.
 */
export function scanDirectives(source: string): DirectiveScan {
  const lines = source.split('\n');
  const offRanges: Array<{ start: number; end: number }> = [];
  const ignoredRows = new Set<number>();
  const forcedRows = new Set<number>();

  let disabledSince: number | null = null;

  for (let row = 0; row < lines.length; row++) {
    const line = lines[row]!;
    const match = DIRECTIVE_PATTERN.exec(line);
    if (!match) {
      continue;
    }
    const family = match[1]!.toLowerCase();
    const action = match[2]!.toLowerCase();
    const isTrailing = line.slice(0, match.index).trim().length > 0;
    const targetRow = isTrailing ? row : row + 1;

    if (action === 'off') {
      disabledSince ??= row;
    } else if (action === 'on') {
      if (disabledSince !== null) {
        offRanges.push({ start: disabledSince, end: row });
        disabledSince = null;
      }
    } else if (family === 'rewrap' && action === 'ignore') {
      ignoredRows.add(targetRow);
    } else if (family === 'rewrap' && action === 'force') {
      forcedRows.add(targetRow);
    }
  }
  if (disabledSince !== null) {
    offRanges.push({ start: disabledSince, end: Infinity });
  }

  return {
    isDisabledAt: (row) => offRanges.some((range) => row >= range.start && row < range.end),
    isIgnoredAt: (row) => ignoredRows.has(row),
    isForcedAt: (row) => forcedRows.has(row),
  };
}
