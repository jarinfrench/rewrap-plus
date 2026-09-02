/**
 * Maps a file's extension to the VSCode-style `languageId` the engine's
 * `AdapterRegistry` keys its adapters by.
 *
 * The extension host has no equivalent of this: `document.languageId` is
 * assigned by VSCode itself (built-in associations plus the user's own
 * `files.associations`), and `../commands/apply-wrap.ts` just reads it.
 * The CLI has no editor in the loop, so it needs its own authority for
 * "what language is this file" — this table is that authority, scoped to
 * exactly the languages this repo actually registers adapters for
 * (`../../vscode-extension/src/engine-host.ts`'s `createRegistry`).
 *
 * Deliberately a plain extension table, not a content-sniffing heuristic
 * (shebang lines, `#!/usr/bin/env python3`, etc.) — extension-based
 * detection is what every comparable tool (Prettier, Black, ESLint) does
 * by default, and content-sniffing is real, separate scope this tool
 * doesn't need to take on.
 */
import { extname } from 'node:path';

const EXTENSION_TO_LANGUAGE: ReadonlyMap<string, string> = new Map([
  ['.py', 'python'],
  ['.pyi', 'python'],

  ['.js', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.jsx', 'javascriptreact'],

  ['.ts', 'typescript'],
  ['.mts', 'typescript'],
  ['.cts', 'typescript'],
  ['.tsx', 'typescriptreact'],

  ['.cpp', 'cpp'],
  ['.cc', 'cpp'],
  ['.cxx', 'cpp'],
  ['.c++', 'cpp'],
  ['.hpp', 'cpp'],
  ['.hh', 'cpp'],
  ['.hxx', 'cpp'],
  ['.h++', 'cpp'],
  // `.h` is genuinely ambiguous between C and C++ — this project has no
  // `c` adapter (`docs/adapters.md`'s C++ section: "a future `c`
  // adapter is separate work, not a same-descriptor alias"), so a plain
  // `.h` file is assumed to be C++ rather than excluded from detection
  // entirely. A real C header run through the `cpp` adapter risks a
  // false-negative `isSafeToWrap` refusal at worst (C's comment/string
  // syntax is a subset of C++'s for everything this adapter wraps), not
  // silent corruption — an acceptable default given `--language` exists
  // to override it per invocation.
  ['.h', 'cpp'],

  ['.java', 'java'],

  // `.mdx`/`.rmd`/`.qmd` are deliberately absent — distinct languageIds
  // with different grammars/semantics, not aliases of plain Markdown
  // (`docs/planning/markdown-latex-plan.md` §7.2), the same "genuinely
  // different, not a same-descriptor alias" distinction `.h`'s own
  // comment above draws for C vs. C++.
  ['.md', 'markdown'],
  ['.markdown', 'markdown'],
]);

/**
 * Detect the languageId for `filePath` from its extension alone (case-
 * insensitively — real filesystems this tool targets are case-
 * insensitive often enough, e.g. `.PY`, that requiring exact-case
 * matching would be a surprising papercut). Returns `undefined` for an
 * extension this table doesn't know, or a path with no extension —
 * callers skip such files rather than guessing.
 *
 * Uses `node:path`'s `extname` (last `.`-segment only) rather than a
 * hand-rolled regex — a first draft tried to special-case `.c++`/`.h++`
 * as "possibly two-part" and, in doing so, made *every* multi-dot
 * filename greedily match its two trailing segments as one extension,
 * silently misdetecting the extremely common `foo.test.ts`/
 * `foo.spec.tsx` naming convention as the unknown extension `.test.ts`
 * instead of `.ts`. `.c++`/`.h++` need no special handling at all:
 * `extname('foo.c++')` already returns `'.c++'` directly, since `+` is
 * just an ordinary character to `extname`, not a delimiter.
 */
export function detectLanguageFromPath(filePath: string): string | undefined {
  const ext = extname(filePath).toLowerCase();
  if (!ext) {
    return undefined;
  }
  return EXTENSION_TO_LANGUAGE.get(ext);
}

/** Every extension this table maps to a language, for file-discovery's default filter (`./file-discovery.ts`). */
export function knownExtensions(): readonly string[] {
  return [...EXTENSION_TO_LANGUAGE.keys()];
}
