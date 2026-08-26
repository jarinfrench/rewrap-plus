import { describe, expect, it } from 'vitest';
import type { FileOutcome } from './apply.js';
import { formatFileLine, formatRewraprcWarning, formatSummaryLine, summarize } from './report.js';

function outcome(overrides: Partial<FileOutcome> = {}): FileOutcome {
  return {
    path: '/repo/a.py',
    languageId: 'python',
    changed: false,
    skippedCount: 0,
    columnLimit: 80,
    rewraprcParseError: undefined,
    error: undefined,
    ...overrides,
  };
}

describe('formatFileLine', () => {
  it('returns undefined for an unchanged, error-free file', () => {
    expect(formatFileLine(outcome(), 'write')).toBeUndefined();
  });

  it('reports "rewrapped" in write mode', () => {
    expect(formatFileLine(outcome({ changed: true }), 'write')).toBe(
      'rewrapped   /repo/a.py (column limit 80)',
    );
  });

  it('reports "would rewrap" in check mode', () => {
    expect(formatFileLine(outcome({ changed: true }), 'check')).toBe(
      'would rewrap/repo/a.py (column limit 80)',
    );
  });

  it('reports an error regardless of mode', () => {
    expect(formatFileLine(outcome({ error: 'boom' }), 'write')).toBe('error   /repo/a.py: boom');
  });
});

describe('formatRewraprcWarning', () => {
  it('returns undefined when there is no parse error', () => {
    expect(formatRewraprcWarning(outcome())).toBeUndefined();
  });

  it('formats a parse-error warning', () => {
    const warning = formatRewraprcWarning(outcome({ rewraprcParseError: 'Unexpected token' }));
    expect(warning).toContain('/repo/a.py');
    expect(warning).toContain('Unexpected token');
  });
});

describe('summarize', () => {
  it('counts changed, unchanged, and errored files separately', () => {
    const summary = summarize([
      outcome({ changed: true }),
      outcome({ changed: false }),
      outcome({ error: 'boom' }),
    ]);
    expect(summary).toEqual({ total: 3, changed: 1, unchanged: 1, errored: 1 });
  });
});

describe('formatSummaryLine', () => {
  it('reports "No files matched." for an empty run', () => {
    expect(formatSummaryLine({ total: 0, changed: 0, unchanged: 0, errored: 0 }, 'write')).toBe(
      'No files matched.',
    );
  });

  it('uses "rewrapped" in write mode and "would be rewrapped" in check mode', () => {
    const summary = { total: 2, changed: 1, unchanged: 1, errored: 0 };
    expect(formatSummaryLine(summary, 'write')).toBe('2 files checked, 1 rewrapped.');
    expect(formatSummaryLine(summary, 'check')).toBe('2 files checked, 1 would be rewrapped.');
  });

  it('mentions errored files when present', () => {
    const summary = { total: 3, changed: 1, unchanged: 1, errored: 1 };
    expect(formatSummaryLine(summary, 'write')).toBe('3 files checked, 1 rewrapped, 1 errored.');
  });

  it('uses singular "file" for a single-file run', () => {
    expect(formatSummaryLine({ total: 1, changed: 0, unchanged: 1, errored: 0 }, 'write')).toBe(
      '1 file checked, 0 rewrapped.',
    );
  });
});
