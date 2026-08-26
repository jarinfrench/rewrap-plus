import { describe, expect, it } from 'vitest';
import { looksLikeProse } from './prose-heuristic.js';

describe('looksLikeProse', () => {
  it('is empty-text-safe', () => {
    expect(looksLikeProse('')).toBe(false);
    expect(looksLikeProse('   ')).toBe(false);
  });

  describe('positive cases (the plan\'s own examples)', () => {
    it('accepts a long prose message', () => {
      expect(
        looksLikeProse(
          'This message is intentionally long so that it exceeds the configured column limit and must be wrapped.',
        ),
      ).toBe(true);
    });

    it('accepts f-string prose with interpolations', () => {
      expect(
        looksLikeProse(
          'Processing {count} items for user {name}, please wait while we finish.',
        ),
      ).toBe(true);
    });

    it('accepts a plain sentence needing parens on split', () => {
      expect(
        looksLikeProse(
          'The calculated total exceeds the maximum allowed value for this account tier.',
        ),
      ).toBe(true);
    });
  });

  describe('negative cases (the plan\'s own examples)', () => {
    it('rejects a SQL query', () => {
      expect(looksLikeProse('SELECT id, name FROM users WHERE active = 1')).toBe(false);
    });

    it('rejects a non-raw regex pattern', () => {
      expect(looksLikeProse('^[a-zA-Z0-9_]+@[a-zA-Z0-9_]+\\.[a-zA-Z]{2,}$')).toBe(false);
    });

    it('rejects a URL', () => {
      expect(looksLikeProse('https://example.com/docs/api/v2/reference?query=value')).toBe(false);
    });

    it('rejects a dotted i18n-style key', () => {
      expect(looksLikeProse('errors.validation.required_field')).toBe(false);
    });

    it('rejects a snake_case identifier key', () => {
      expect(looksLikeProse('user_display_name')).toBe(false);
    });

    it('rejects a Windows path literal', () => {
      expect(looksLikeProse('C:\\\\Users\\\\name\\\\file.txt')).toBe(false);
    });

    it('rejects a POSIX path literal', () => {
      expect(looksLikeProse('/var/log/app/output.log')).toBe(false);
    });

    it('rejects a logging format string dominated by placeholders', () => {
      expect(looksLikeProse('%s failed')).toBe(false);
    });

    it('rejects a str.format placeholder-dominated key', () => {
      expect(looksLikeProse('{0}:{1}')).toBe(false);
    });

    it('rejects a SQL query with its surrounding quote characters included', () => {
      // Regression: `wrap.ts` scores whatever text an adapter's
      // `proseText` hook returns, which for a language with no such hook
      // (or a hook that doesn't strip quotes) could include the literal
      // delimiter characters. A weight of -3 here once let this exact
      // query flip from correctly-rejected to incorrectly-accepted purely
      // because the leading `"` defeated the dictionary-word-shape check
      // on the first token — see the categorical negative signals' own
      // comment in prose-heuristic.ts for the full story.
      const query = `"SELECT id, name FROM users WHERE active = 1 AND created_at > '2020-01-01'"`;
      expect(looksLikeProse(query)).toBe(false);
    });
  });
});
