#!/usr/bin/env node
/**
 * Bundles the extension to a single `dist/extension.js` via esbuild, then
 * copies the runtime assets a bundle can't safely absorb: grammar WASM and
 * `web-tree-sitter` itself. Replaces `tsc -b` as this package's `build`
 * script (`typecheck` keeps using `tsc -b` for actual type checking —
 * esbuild only transpiles, it never checks types).
 *
 * ## Why `web-tree-sitter` is aliased to a loader, not just `external`
 *
 * The obvious approach — bundle everything reachable from `extension.ts`
 * into one file — silently breaks `web-tree-sitter`'s own WASM loading.
 * Probed directly (not trusted from the shorthand "mark `vscode`
 * external" advice; this is a second, unwritten landmine the same
 * principle applies to): `web-tree-sitter`'s package `exports` map resolves a bare
 * `import { Parser } from 'web-tree-sitter'` to its ESM build, whose
 * Emscripten-generated bootstrap locates its own `web-tree-sitter.wasm`
 * via `new URL('web-tree-sitter.wasm', import.meta.url)`. esbuild cannot
 * synthesize a real `import.meta.url` when the output format is `cjs` (a
 * documented esbuild limitation, not a bug to work around) — it stubs
 * `import.meta` to `{}`, so the bootstrap fails with `TypeError
 * [ERR_INVALID_ARG_VALUE]` inside `createRequire(undefined)`. Confirmed
 * by bundling a throwaway probe and running it from a directory with no
 * relationship to this repo's `node_modules` — the exact shape a
 * packaged `.vsix` has.
 *
 * The first fix tried (commit 1) was marking `web-tree-sitter`
 * `external`: esbuild then downlevels the bundled `import` to a plain
 * `require('web-tree-sitter')`, resolving via the package's `"require"`
 * export condition — the `.cjs` build, which locates its WASM via
 * `__dirname` and sidesteps the landmine above. That much is correct and
 * still true. But `require('web-tree-sitter')` needs a real
 * `node_modules/web-tree-sitter` reachable from `dist/extension.js`, and
 * wiring up actual packaging (commit 2) surfaced a *second* landmine on
 * top of it: `vsce`'s own file-collection walk hardcodes
 * `ignore: 'node_modules/**'` for this package's own directory,
 * unconditionally — no `.vscodeignore` negation overrides it, so a local
 * `node_modules/web-tree-sitter` copy could never actually ship that
 * way. The only alternative `vsce` offers — its own dependency-resolution
 * walk, the default unless `--no-dependencies` is passed — shells out to
 * `npm list --production`, which in this npm-workspaces monorepo reports
 * the *workspace root* as a "dependency directory" too: confirmed
 * directly, `vsce ls` from this package without `--no-dependencies`
 * listed `../../.git/**` and every unrelated doc in the repo.
 *
 * The fix that clears both landmines at once: don't let `web-tree-sitter`
 * resolve as a package at all. `alias` below redirects the bare
 * specifier to `../src/web-tree-sitter-runtime.ts` (see that file's own,
 * fuller doc comment), which loads the real `.cjs` build via a
 * *computed* `require()` path esbuild can't statically resolve, reading
 * from `dist/web-tree-sitter-runtime/` — an ordinary subdirectory name,
 * not `node_modules`, so `vsce`'s hardcoded ignore doesn't apply and
 * packaging never needs its dependency walk (`package.json`'s `package`
 * script always passes `--no-dependencies`).
 *
 * `@rewrap-plus/engine` itself is deliberately bundled directly (not
 * aliased or external) — nothing in its own source touches
 * `import.meta.url`, so neither landmine applies to it, and bundling its
 * compiled output avoids shipping a second workspace package's
 * node_modules entry.
 */
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.dirname(scriptsDir);
const repoRoot = path.dirname(path.dirname(packageRoot));
const outdir = path.join(packageRoot, 'dist');

async function main() {
  fs.rmSync(outdir, { recursive: true, force: true });

  await esbuild.build({
    entryPoints: [path.join(packageRoot, 'src', 'extension.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: path.join(outdir, 'extension.js'),
    sourcemap: true,
    // `vscode` is injected by the extension host, never resolvable as a
    // real package. `web-tree-sitter` is aliased to a local loader
    // rather than bundled or marked external — see this file's own top
    // doc comment for why either of those simpler options breaks.
    external: ['vscode'],
    alias: {
      'web-tree-sitter': path.join(packageRoot, 'src', 'web-tree-sitter-runtime.ts'),
    },
    logLevel: 'info',
  });

  copyGrammars();
  copyWebTreeSitter();
  copyLicense();
}

/**
 * Copies the engine's vendored grammar `.wasm` files to `<packageRoot>/
 * grammars/`, a sibling of `dist/` — matching where `engine-host.ts`'s
 * `initEngineHost` points `ParserManager`'s `wasmDir` (the extension's own
 * `context.extensionUri`), since every `LanguageDescriptor.grammarWasm`
 * value already embeds the `grammars/` path segment itself. A build
 * artifact, not a second vendored copy: `packages/engine/grammars/
 * PROVENANCE.md` remains the one source of truth, and this directory is
 * gitignored the same way `dist/` is.
 */
function copyGrammars() {
  const srcDir = path.join(packageRoot, '..', 'engine', 'grammars');
  const destDir = path.join(packageRoot, 'grammars');
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });

  for (const entry of fs.readdirSync(srcDir)) {
    if (entry.endsWith('.wasm')) {
      fs.copyFileSync(path.join(srcDir, entry), path.join(destDir, entry));
    }
  }
}

/**
 * Copies just the files `web-tree-sitter`'s own `package.json` "files"
 * list ships (its `.cjs`/`.js`/`.wasm`/`.d.ts` runtime plus `LICENSE`),
 * skipping devDependency-only clutter, from the monorepo's hoisted root
 * `node_modules` to `dist/web-tree-sitter-runtime/` — read by
 * `src/web-tree-sitter-runtime.ts` at runtime via a path relative to its
 * own bundled `__dirname`. See that file's doc comment for why this
 * directory is deliberately not named `node_modules`.
 */
function copyWebTreeSitter() {
  const srcDir = path.join(repoRoot, 'node_modules', 'web-tree-sitter');
  const destDir = path.join(outdir, 'web-tree-sitter-runtime');
  if (!fs.existsSync(srcDir)) {
    throw new Error(`build: expected web-tree-sitter at ${srcDir} — run npm ci first.`);
  }
  fs.mkdirSync(destDir, { recursive: true });

  for (const entry of fs.readdirSync(srcDir)) {
    // Skip nested directories (e.g. a possible `node_modules/.bin`-style
    // artifact) — web-tree-sitter has zero runtime dependencies of its
    // own, so every file this package actually needs sits flat at its
    // package root.
    const srcPath = path.join(srcDir, entry);
    if (fs.statSync(srcPath).isFile()) {
      fs.copyFileSync(srcPath, path.join(destDir, entry));
    }
  }
}

/**
 * Copies the repo-root `LICENSE` and `THIRD-PARTY-NOTICES.md` into
 * `<packageRoot>/` — build artifacts, not a second source of truth, the
 * same as `copyGrammars()`. `vsce package` warns (correctly) when a
 * packaged extension has no `LICENSE`/`LICENSE.md`/`LICENSE.txt` of its
 * own; a monorepo subpackage has no reason to duplicate the root file by
 * hand just to silence that. `web-tree-sitter`'s own `package.json` does
 * the identical `"prepack": "cp ../../LICENSE ."` for the identical
 * reason.
 */
function copyLicense() {
  fs.copyFileSync(path.join(repoRoot, 'LICENSE'), path.join(packageRoot, 'LICENSE'));
  // Same build-artifact pattern, for the same reason: a packaged
  // extension that bundles web-tree-sitter and vendored tree-sitter
  // grammars (see copyWebTreeSitter()/copyGrammars() above) should carry
  // their notices with it, not just link to them from the repo README.
  fs.copyFileSync(
    path.join(repoRoot, 'THIRD-PARTY-NOTICES.md'),
    path.join(packageRoot, 'THIRD-PARTY-NOTICES.md'),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
