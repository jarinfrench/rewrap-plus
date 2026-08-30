import { Parser, Language, Query } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateDescriptor } from '../../adapter-registry.js';
import { pythonDescriptor } from './descriptor.js';

const grammarPath = 'grammars/tree-sitter-python.wasm';

let language: Language;

beforeAll(async () => {
  await Parser.init();
  language = await Language.load(grammarPath);
});

describe('pythonDescriptor', () => {
  it('passes structural validation', () => {
    expect(() => validateDescriptor(pythonDescriptor)).not.toThrow();
  });

  it('declares queries that compile against the vendored grammar', () => {
    expect(() => new Query(language, pythonDescriptor.queries.comments)).not.toThrow();
    expect(() => new Query(language, pythonDescriptor.queries.strings)).not.toThrow();
    expect(() => new Query(language, pythonDescriptor.queries.concatenations!)).not.toThrow();
  });

  it('has no block-comment form — Python has none', () => {
    expect(pythonDescriptor.comments.block).toBeUndefined();
  });

  it('declares all four documentation dialects as candidates', () => {
    expect(pythonDescriptor.comments.doc?.dialects).toEqual(['google', 'numpy', 'sphinx', 'plain']);
  });

  it('flags shebangs and common tool directives as never-reflow', () => {
    const patterns = pythonDescriptor.comments.neverReflow;
    const matches = (text: string): boolean => patterns.some((re) => re.test(text));

    expect(matches('#!/usr/bin/env python')).toBe(true);
    expect(matches('# -*- coding: utf-8 -*-')).toBe(true);
    expect(matches('# type: ignore')).toBe(true);
    expect(matches('# noqa: E501')).toBe(true);
    expect(matches('# pylint: disable=no-member')).toBe(true);
    expect(matches('# pragma: no cover')).toBe(true);
    expect(matches('# fmt: off')).toBe(true);
    expect(matches('# just a regular comment')).toBe(false);
  });

  it('flags statement/definition keywords and decorators as code-like', () => {
    const pattern = pythonDescriptor.comments.codeLikeKeywords;
    expect(pattern).toBeDefined();
    const matches = (text: string): boolean => pattern!.test(text);

    expect(matches('def f(x):')).toBe(true);
    expect(matches('class Foo:')).toBe(true);
    expect(matches('import os')).toBe(true);
    expect(matches('@deprecated')).toBe(true);
    expect(matches('return x + 1')).toBe(true);
    expect(matches('This is an ordinary sentence.')).toBe(false);
  });

  it('declares canonical, lowercase prefix forms only', () => {
    const prefixes = pythonDescriptor.strings.prefixes.map((p) => p.prefix);

    expect(prefixes).toEqual(['', 'u', 'r', 'f', 'b', 'rf', 'rb']);
    expect(prefixes.every((p) => p === p.toLowerCase())).toBe(true);
  });

  it('flags exactly the prefixes that are raw or bytes', () => {
    const byPrefix = new Map(pythonDescriptor.strings.prefixes.map((p) => [p.prefix, p]));

    expect(byPrefix.get('r')?.raw).toBe(true);
    expect(byPrefix.get('rb')?.raw).toBe(true);
    expect(byPrefix.get('b')?.bytes).toBe(true);
    expect(byPrefix.get('rb')?.bytes).toBe(true);
    expect(byPrefix.get('f')?.formatted).toBe(true);
    expect(byPrefix.get('')?.raw).toBeUndefined();
    expect(byPrefix.get('')?.bytes).toBeUndefined();
  });

  it('declares no separate raw-form delimiters — Python has none', () => {
    expect(pythonDescriptor.strings.rawForms).toEqual([]);
  });

  it('recognizes every standard Python escape sequence', () => {
    const sequences = pythonDescriptor.strings.escapes.sequences;
    const matches = (text: string): boolean => sequences.some((re) => re.test(text));

    for (const escape of ['\\n', '\\t', '\\\\', "\\'", '\\"', '\\x41', '\\u1234', '\\U0001F600']) {
      expect(matches(escape)).toBe(true);
    }
    expect(matches('\\N{BULLET}')).toBe(true);
    expect(matches('\\012')).toBe(true); // octal
  });

  it('treats format placeholders and %-format specifiers as atomic', () => {
    const placeholders = pythonDescriptor.strings.placeholders;
    const matches = (text: string): boolean => placeholders.some((re) => re.test(text));

    expect(matches('{name!r:>10}')).toBe(true);
    expect(matches('{}')).toBe(true);
    expect(matches('%s')).toBe(true);
    expect(matches('%(key)d')).toBe(true);
  });

  it('defaults to implicit adjacency concatenation with trailing + as the alternative', () => {
    expect(pythonDescriptor.strings.concatenation.style).toBe('implicit');
    expect(pythonDescriptor.strings.concatenation.operator).toBe('+');
    expect(pythonDescriptor.strings.concatenation.requiresGrouping).toBe(true);
  });
});
