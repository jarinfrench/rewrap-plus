/**
 * Rewrap+ VSCode extension entry point.
 *
 * Phase 0 left this empty. Phase 7 wires up real activation: eagerly
 * warm the engine host (`./engine-host.ts`) so the first wrap command a
 * user runs doesn't pay the grammar-load latency inline, though nothing
 * here blocks on that warm-up completing — `getParserManager()` is
 * awaited again, cheaply, by whichever command actually runs.
 *
 * Commands, configuration, and the range-formatting provider are added
 * in later Phase 7 commits; this commit is deliberately just the
 * manifest plus this warm-up, so activation itself can be verified
 * working before anything is registered against it.
 */
import type * as vscode from 'vscode';
import { getParserManager } from './engine-host.js';

export function activate(_context: vscode.ExtensionContext): void {
  void getParserManager();
}

export function deactivate(): void {}
