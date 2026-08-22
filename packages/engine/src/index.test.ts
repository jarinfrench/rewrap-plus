import { describe, expect, it } from 'vitest';

// Phase 0 smoke test: proves the Vitest harness (config, TS transform,
// coverage instrumentation) is wired up correctly. Real engine behavior
// starts in Phase 1.
describe('vitest harness', () => {
  it('runs TypeScript tests', () => {
    expect(1 + 1).toBe(2);
  });
});
