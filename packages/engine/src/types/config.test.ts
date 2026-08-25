import { describe, expect, it } from 'vitest';
import type { WrapConfig } from './config.js';

describe('WrapConfig', () => {
  it('is constructible as plain data, with concatStyle optional', () => {
    const config: WrapConfig = {
      columnLimit: 88,
      tabSize: 4,
      wrapComments: true,
      wrapStrings: true,
      stringPolicy: 'prose',
      docDialect: 'auto',
      preserveIndentedBlocks: true,
      balancedWrapping: false,
    };

    expect(config.columnLimit).toBe(88);
    expect(config.concatStyle).toBeUndefined();
  });

  it('accepts every documented stringPolicy and docDialect value', () => {
    const stringPolicies: readonly WrapConfig['stringPolicy'][] = ['off', 'prose', 'all'];
    const docDialects: readonly WrapConfig['docDialect'][] = [
      'auto',
      'google',
      'numpy',
      'sphinx',
      'plain',
    ];

    for (const stringPolicy of stringPolicies) {
      for (const docDialect of docDialects) {
        const config: WrapConfig = {
          columnLimit: 80,
          tabSize: 4,
          wrapComments: true,
          wrapStrings: true,
          stringPolicy,
          docDialect,
          preserveIndentedBlocks: false,
          balancedWrapping: false,
          concatStyle: 'plusOperator',
        };

        expect(config.stringPolicy).toBe(stringPolicy);
        expect(config.docDialect).toBe(docDialect);
      }
    }
  });
});
