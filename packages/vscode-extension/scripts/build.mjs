#!/usr/bin/env node
/**
 * Bundles the extension to a single `dist/extension.js` via esbuild, then
 * copies the runtime assets a bundle can't safely absorb: grammar WASM and
 * `web-tree-sitter` itself. Replaces `tsc -b` as this package's `build`
 * script (`typecheck` keeps using `tsc -b` for actual type checking —
 * esbuild only transpiles, it never checks types).
 *
 * ## Why `web-tree-sitter` is `external`, not bundled
 *
 * The obvious approach — bundle everything reachable from `extension.ts`,
 * including `@rewrap-plus/engine` and its `web-tree-sitter` dependency,
 * into one file — silently breaks `web-tree-sitter`'s own WASM loading.
 * Probed directly (not trusted from the plan's shorthand "mark `vscode`
 * external"; this is a second, unwritten landmine the same principle
 * applies to): `web-tree-sitter`'s package `exports` map resolves a bare
 * `import { Parser } from 'web-tree-sitter'` to its ESM build, whose
 * Emscripten-generated bootstrap locates its own `web-tree-sitter.wasm`
 * via `new URL('web-tree-sitter.wasm', import.meta.url)`. esbuild cannot
 * synthesize a real `import.meta.url` when the output format is `cjs` (a
 * documented esbuild limitation, not a bug to work around) — it stubs
 * `import.meta` to `{}`, so `import.meta.url` is `undefined` and the
 * bootstrap fails with `TypeError [ERR_INVALID_ARG_VALUE]` inside
 * `createRequire(undefined)`. Confirmed by bundling a throwaway probe
 * script and running it from a directory with no relationship to this
 * repo's `node_modules` — the exact shape a packaged `.vsix` has.
 *
 * Marking `web-tree-sitter` external sidesteps the ESM build entirely:
 * esbuild downlevels the bundled code's `import` of it to a plain
 * `require('web-tree-sitter')`, which is a genuine CJS `require()` at
 * runtime and therefore resolves via the package's `"require"` export
 * condition instead — the `.cjs` build, which locates its WASM via
 * `__dirname` (a real Node global, unaffected by any of the above).
 * Verified the same way: bundle, copy a real `node_modules/web-tree-sitter`
 * next to the bundle, run from an unrelated directory — succeeds.
 *
 * That "real `node_modules/web-tree-sitter` next to the bundle" is exactly
 * what this script's `copyWebTreeSitter()` step produces, deliberately
 * local to this package rather than relying on the monorepo's hoisted
 * root `node_modules`: `vsce package` only packages this package's own
 * directory, and npm workspaces hoists `web-tree-sitter` to the repo
 * root, not here — so without this copy, `require('web-tree-sitter')`
 * would resolve fine in every dev/test run (root `node_modules` is a real
 * ancestor directory then) and only fail once actually packaged, the
 * worst possible time to discover it.
 *
 * `@rewrap-plus/engine` itself is deliberately *not* external — bundling
 * its compiled output directly avoids needing to ship a second workspace
 * package's node_modules entry, and nothing in its own source touches
 * `import.meta.url` the way `web-tree-sitter`'s ESM build does, so the
 * landmine above doesn't apply to it.
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
    // real package. `web-tree-sitter` is external for the reason in this
    // file's own doc comment above.
    external: ['vscode', 'web-tree-sitter'],
    logLevel: 'info',
  });

  copyGrammars();
  copyWebTreeSitter();
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
 * `node_modules` into this package's own `node_modules/web-tree-sitter` —
 * see this file's top doc comment for why a local copy is required at all.
 */
function copyWebTreeSitter() {
  const srcDir = path.join(repoRoot, 'node_modules', 'web-tree-sitter');
  const destDir = path.join(packageRoot, 'node_modules', 'web-tree-sitter');
  if (!fs.existsSync(srcDir)) {
    throw new Error(`build: expected web-tree-sitter at ${srcDir} — run npm ci first.`);
  }
  fs.rmSync(destDir, { recursive: true, force: true });
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
