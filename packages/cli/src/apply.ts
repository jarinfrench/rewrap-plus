/**
 * Wraps one file: read, resolve config, `wrapRegions`, then either write
 * the result back (`mode: 'write'`, the default) or just report whether
 * it *would* change (`mode: 'check'`, `--check`) without touching disk.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { applyTextEdits, wrapRegions, type ParserManager } from '@rewrap-plus/engine';
import { resolveConfigForFile } from './config/resolve-config.js';
import type { PartialCliConfig } from './config/types.js';
import type { DiscoveredFile } from './file-discovery.js';

export interface FileOutcome {
  readonly path: string;
  readonly languageId: string;
  /** `true` when the file's content differs from what wrapping produces — regardless of `mode`, so `--check` can report it without having written anything. */
  readonly changed: boolean;
  readonly skippedCount: number;
  readonly columnLimit: number;
  readonly rewraprcParseError: string | undefined;
  /** Set when reading, parsing, or wrapping this file threw — one bad file never aborts the rest of the batch (`./run.ts`). */
  readonly error: string | undefined;
}

export async function processFile(
  file: DiscoveredFile,
  parserManager: ParserManager,
  flags: PartialCliConfig,
  mode: 'write' | 'check',
): Promise<FileOutcome> {
  const base = { path: file.path, languageId: file.languageId };

  let resolved;
  try {
    resolved = resolveConfigForFile(file.path, flags);
  } catch (error) {
    return {
      ...base,
      changed: false,
      skippedCount: 0,
      columnLimit: 0,
      rewraprcParseError: undefined,
      error: describeError(error),
    };
  }

  const { wrapConfig, columnLimit, rewraprcParseError } = resolved;

  try {
    const source = readFileSync(file.path, 'utf8');
    const result = await wrapRegions(source, file.languageId, 'all', wrapConfig, parserManager);
    const changed = result.edits.length > 0;

    if (changed && mode === 'write') {
      const newSource = applyTextEdits(source, result.edits);
      writeFileSync(file.path, newSource, 'utf8');
    }

    return {
      ...base,
      changed,
      skippedCount: result.skipped.length,
      columnLimit: columnLimit.value,
      rewraprcParseError,
      error: undefined,
    };
  } catch (error) {
    return {
      ...base,
      changed: false,
      skippedCount: 0,
      columnLimit: columnLimit.value,
      rewraprcParseError,
      error: describeError(error),
    };
  }
}

/**
 * `packages/vscode-extension/src/describe-error.ts` has the identical
 * one-liner, kept as its own separate copy for the same "independent
 * peer packages" reason `packages/cli/src/config/editorconfig.ts`'s own
 * doc comment gives in full.
 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
