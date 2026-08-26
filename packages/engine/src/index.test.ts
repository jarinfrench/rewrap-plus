import { describe, expect, it } from 'vitest';

// Smoke test: proves the Vitest harness (config, TS transform, coverage
// instrumentation) is wired up correctly, independent of any real
// engine behavior.
describe('vitest harness', () => {
  it('runs TypeScript tests', () => {
    expect(1 + 1).toBe(2);
  });
});
