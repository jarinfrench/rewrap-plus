/**
 * Expands the CLI's positional path arguments (files and/or directories)
 * into a concrete list of files to wrap, each paired with its detected
 * `languageId` (`./language-detection.ts`).
 */
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { detectLanguageFromPath } from './language-detection.js';

export interface DiscoveredFile {
  readonly path: string;
  readonly languageId: string;
}

export interface DiscoveryResult {
  readonly files: readonly DiscoveredFile[];
  /** Explicit file arguments whose extension this tool doesn't recognize, and no `--language` override applied. Directory-walk discoveries with an unrecognized extension are silently skipped instead — see `walkDirectory`'s own comment. */
  readonly unrecognized: readonly string[];
  /** Positional arguments that don't exist on disk at all. */
  readonly missing: readonly string[];
}

/**
 * Directory names skipped during a recursive walk, regardless of depth —
 * the same "don't touch generated/vendored/VCS content by default" set
 * every comparable batch tool (Prettier, ESLint) applies out of the box.
 * Not `.gitignore`-aware beyond this fixed list; see this module's own
 * "Known limitations" note at the bottom.
 */
const DEFAULT_IGNORED_DIR_NAMES = new Set(['node_modules', 'dist', 'out', 'coverage']);

function isIgnoredDir(name: string): boolean {
  return name.startsWith('.') || DEFAULT_IGNORED_DIR_NAMES.has(name);
}

/**
 * `languageOverride` (`--language`, from `./args.ts`) applies only to
 * explicit file arguments, never to files found by walking a directory
 * argument — forcing every file under a directory tree to one language
 * regardless of its own extension is exactly the kind of blast-radius
 * surprise a batch tool should require one file at a time, not a whole
 * subtree, to opt into.
 */
export function discoverFiles(
  targets: readonly string[],
  opts: { readonly languageOverride?: string | undefined } = {},
): DiscoveryResult {
  const files: DiscoveredFile[] = [];
  const unrecognized: string[] = [];
  const missing: string[] = [];

  for (const target of targets) {
    const absolute = resolve(target);
    let stat;
    try {
      stat = statSync(absolute);
    } catch {
      missing.push(target);
      continue;
    }

    if (stat.isDirectory()) {
      walkDirectory(absolute, files);
      continue;
    }

    const languageId = opts.languageOverride ?? detectLanguageFromPath(absolute);
    if (languageId) {
      files.push({ path: absolute, languageId });
    } else {
      unrecognized.push(target);
    }
  }

  return { files, unrecognized, missing };
}

function walkDirectory(dir: string, out: DiscoveredFile[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!isIgnoredDir(entry.name)) {
        walkDirectory(join(dir, entry.name), out);
      }
      continue;
    }
    if (!entry.isFile()) {
      continue; // symlinks, sockets, etc. — not a file this tool can wrap
    }
    const path = join(dir, entry.name);
    // Unlike an explicit file argument (which reports back as
    // "unrecognized" so the caller can warn), a directory walk silently
    // skips files it doesn't know how to wrap — a `node_modules`-free
    // source tree still has `README.md`, `package.json`, and similar in
    // it, and warning about every one of them would be pure noise for
    // the overwhelmingly common case of pointing this tool at a whole
    // project directory.
    const languageId = detectLanguageFromPath(path);
    if (languageId) {
      out.push({ path, languageId });
    }
  }
}

// Known limitations:
// - Not `.gitignore`-aware: a project-specific ignore rule beyond the
//   fixed `DEFAULT_IGNORED_DIR_NAMES` set above isn't consulted. Real,
//   separate scope (a `.gitignore` parser is a project of its own) that
//   this tool doesn't need to take on.
// - Symlinked directories are not followed (`readdirSync`'s own default
//   behavior) — avoids an unbounded/cyclic walk from a symlink loop.
