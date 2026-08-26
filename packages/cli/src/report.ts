/**
 * Pure formatting for the CLI's console output — split out from
 * `./run.ts` so the actual message text is unit-testable without
 * capturing `console.log`.
 */
import type { FileOutcome } from './apply.js';

export type RunMode = 'write' | 'check';

export function formatFileLine(outcome: FileOutcome, mode: RunMode): string | undefined {
  if (outcome.error) {
    return `error   ${outcome.path}: ${outcome.error}`;
  }
  if (!outcome.changed) {
    return undefined; // unchanged files are silent, matching Prettier/Black's own --check/--write conventions
  }
  const verb = mode === 'check' ? 'would rewrap' : 'rewrapped';
  return `${verb.padEnd(12)}${outcome.path} (column limit ${outcome.columnLimit})`;
}

export function formatRewraprcWarning(outcome: FileOutcome): string | undefined {
  if (!outcome.rewraprcParseError) {
    return undefined;
  }
  return `warning ${outcome.path}: nearest .rewraprc failed to parse (${outcome.rewraprcParseError}) — falling back to lower-precedence config`;
}

export interface Summary {
  readonly total: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly errored: number;
}

export function summarize(outcomes: readonly FileOutcome[]): Summary {
  let changed = 0;
  let errored = 0;
  for (const outcome of outcomes) {
    if (outcome.error) {
      errored++;
    } else if (outcome.changed) {
      changed++;
    }
  }
  return {
    total: outcomes.length,
    changed,
    unchanged: outcomes.length - changed - errored,
    errored,
  };
}

export function formatSummaryLine(summary: Summary, mode: RunMode): string {
  if (summary.total === 0) {
    return 'No files matched.';
  }
  const verb = mode === 'check' ? 'would be rewrapped' : 'rewrapped';
  const parts = [
    `${summary.total} file${summary.total === 1 ? '' : 's'} checked`,
    `${summary.changed} ${verb}`,
  ];
  if (summary.errored > 0) {
    parts.push(`${summary.errored} errored`);
  }
  return parts.join(', ') + '.';
}
