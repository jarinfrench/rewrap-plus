import { describe, expect, it } from 'vitest';
import { looksLikeProse } from './prose-heuristic.js';

describe('looksLikeProse', () => {
  it('is empty-text-safe', () => {
    expect(looksLikeProse('')).toBe(false);
    expect(looksLikeProse('   ')).toBe(false);
  });

  describe('positive cases (representative real examples)', () => {
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

  describe('negative cases (representative real examples)', () => {
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

    it('rejects a multi-line SQL query with no surrounding quotes at all', () => {
      expect(looksLikeProse('\nSELECT id, name\nFROM users\nWHERE active = 1')).toBe(false);
    });
  });

  describe('SQL-keyword false positives on ordinary English (regression)', () => {
    // Found while building the triple-quoted-string gold fixtures:
    // `FROM`/`WHERE`/`JOIN`/`VALUES` are common English words in their own
    // right, and the
    // original flat `SQL_KEYWORDS` regex matched any one of them alone —
    // enough by itself to flip an otherwise clearly-prose paragraph to
    // ineligible. See prose-heuristic.ts's own `SQL_STRONG_KEYWORDS`/
    // `SQL_WEAK_KEYWORDS` doc comment for the fix (a lone weak keyword no
    // longer counts; two distinct ones co-occurring still does).
    it('accepts prose containing the ordinary word "from"', () => {
      expect(
        looksLikeProse(
          'This second paragraph is separated from the first by a blank line and is reflowed independently.',
        ),
      ).toBe(true);
    });

    it('accepts prose containing the ordinary word "where"', () => {
      expect(
        looksLikeProse(
          'This is the section where the tool explains what it does in enough detail to be useful.',
        ),
      ).toBe(true);
    });

    it('still rejects a real query built only from weak keywords co-occurring', () => {
      expect(looksLikeProse('name, email FROM subscribers WHERE active = 1 AND JOIN campaigns')).toBe(
        false,
      );
    });

    it('still rejects every strong SQL keyword alone, with no other keyword present', () => {
      expect(looksLikeProse('INSERT INTO logs (message) VALUES (?)')).toBe(false);
      expect(looksLikeProse('UPDATE accounts SET balance = balance - 1')).toBe(false);
      expect(looksLikeProse('CREATE TABLE users (id INTEGER PRIMARY KEY)')).toBe(false);
      expect(looksLikeProse('DROP TABLE temp_import_staging')).toBe(false);
    });
  });
});
