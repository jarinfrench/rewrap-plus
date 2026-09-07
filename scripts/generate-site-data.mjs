#!/usr/bin/env node
/**
 * Generates `site/data/languages.json`, the language-coverage table data
 * for the GitHub Pages project site (`site/index.html`, deployed by the
 * `pages` job in `.github/workflows/ci.yml`).
 *
 * The whole point of this script is that the table can't silently drift
 * from what's actually shipped: every fact below is read directly off
 * `packages/engine`'s own `LanguageDescriptor`s (via `allAdapters`,
 * `packages/engine/src/all-adapters.ts` -- the same single source of
 * truth `packages/vscode-extension/src/engine-host.ts` and
 * `packages/cli/src/engine-host.ts` now both register from), never from
 * a hand-maintained list living in this script or in `site/index.html`
 * itself. Output is deliberately never committed (`site/data/` is
 * `.gitignore`d) -- a generated file checked into git is a second stale
 * source of truth waiting to happen, the exact failure mode this script
 * exists to prevent.
 *
 * ## Capability classification
 *
 * Each language is classified into exactly one of three buckets, derived
 * purely from its descriptor/adapter shape (see `classifyCapability`
 * below) -- never from a hardcoded per-language list, so a future
 * language lands in the right bucket automatically:
 *
 * - `'strings'` -- declares `descriptor.strings` (implies
 *   `queries.strings`, enforced together by the engine's own
 *   `validateDescriptor`). Every adapter in this bucket also wraps
 *   comments/docstrings; today: Python, JavaScript, TypeScript, TSX,
 *   C++, Java.
 * - `'prose'` -- implements `LanguageAdapter.discoverProse`. The prose
 *   *is* the document (Markdown, LaTeX), discovered independently of
 *   `queries.comments`/`queries.strings` -- LaTeX in particular still
 *   declares `queries.comments` (its `%` paragraphs flow through the
 *   generic line-comment machinery too), so `'prose'` is classified by
 *   the `discoverProse` hook's presence, not by the absence of a
 *   comments query the way a first-pass reading of "no comments/strings
 *   queries" might suggest -- verified directly against
 *   `packages/engine/src/languages/latex/descriptor.ts` and
 *   `./adapter.ts` before writing this classifier, not assumed.
 * - `'comments-only'` -- everything else: declares `queries.comments`,
 *   no `strings`, no `discoverProse`. Unexercised by any real adapter
 *   when this category was first designed (`docs/planning/`'s GitHub
 *   Pages task); TOML, Shell script (Bash), CSS, SCSS, and PowerShell
 *   shipped since and are the first real members.
 *
 * ## `hasMultilineStringForm`
 *
 * For a `'strings'` language, whether at least one of
 * `descriptor.strings.quotes` declares `multiline: true` -- i.e. whether
 * the language has a quote form that can hold a literal embedded newline
 * on its own (Python's `"""`/`'''`), versus every quote form being
 * single-line so the *only* way to split a long literal across lines is
 * inserting language-valid concatenation (every other `'strings'`
 * language shipped today: JavaScript/TypeScript/TSX/C++/Java each
 * declare every `QuoteSpec` `multiline: false`). Read directly off
 * `QuoteSpec.multiline`, not inferred from language name or reputation.
 *
 * Fails loudly (non-zero exit, no partial output written) if
 * `@rewrap-plus/engine`'s build output doesn't exist yet, or if any
 * adapter's descriptor doesn't fit one of the three capability buckets
 * above -- see `main()`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputPath = path.join(repoRoot, 'site', 'data', 'languages.json');

/** @typedef {import('@rewrap-plus/engine').LanguageAdapter} LanguageAdapter */

/**
 * Classifies one adapter's capability bucket -- see this module's own
 * doc comment above for what each bucket means and why the check order
 * (`strings` first, then `discoverProse`, then the comments-only
 * fallback) is correct even for LaTeX, which declares `queries.comments`
 * *and* implements `discoverProse`.
 *
 * @param {LanguageAdapter} adapter
 * @returns {'strings' | 'prose' | 'comments-only'}
 */
function classifyCapability(adapter) {
  if (adapter.descriptor.strings) {
    return 'strings';
  }
  if (adapter.discoverProse) {
    return 'prose';
  }
  if (adapter.descriptor.queries.comments) {
    return 'comments-only';
  }
  throw new Error(
    `generate-site-data: adapter '${adapter.descriptor.id}' fits none of the three known capability ` +
      `buckets (strings / prose / comments-only) -- it declares no queries.strings, no discoverProse, ` +
      `and no queries.comments. This classifier needs a new bucket, not a silent guess.`,
  );
}

/**
 * @param {LanguageAdapter} adapter
 * @returns {object}
 */
function describeLanguage(adapter) {
  const { descriptor } = adapter;
  const capability = classifyCapability(adapter);

  const docDialects = descriptor.comments.doc?.dialects ? [...descriptor.comments.doc.dialects] : [];

  const concatenationStyle = capability === 'strings' ? descriptor.strings.concatenation.style : null;

  const hasMultilineStringForm =
    capability === 'strings' ? descriptor.strings.quotes.some((quote) => quote.multiline) : null;

  return {
    id: descriptor.id,
    aliases: descriptor.aliases ? [...descriptor.aliases] : [],
    capability,
    docDialects,
    concatenationStyle,
    hasMultilineStringForm,
  };
}

async function main() {
  /** @type {typeof import('@rewrap-plus/engine')} */
  let engine;
  try {
    engine = await import('@rewrap-plus/engine');
  } catch (error) {
    throw new Error(
      `generate-site-data: failed to import '@rewrap-plus/engine' -- has it been built yet? ` +
        `Run 'npm run build' first. Underlying error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const registry = new engine.AdapterRegistry();
  engine.registerAllAdapters(registry);

  // Cross-check: every adapter's id + aliases must actually resolve
  // through the registry we just built, and the registry's own key count
  // must match what `allAdapters` implies -- catches a future
  // `all-adapters.ts` edit that adds an adapter to the array without it
  // actually registering cleanly (a duplicate id/alias, for instance),
  // rather than silently emitting data for an adapter that isn't really
  // wired up.
  const expectedKeyCount = engine.allAdapters.reduce(
    (total, adapter) => total + 1 + (adapter.descriptor.aliases?.length ?? 0),
    0,
  );
  const actualKeyCount = registry.supportedLanguages().length;
  if (actualKeyCount !== expectedKeyCount) {
    throw new Error(
      `generate-site-data: registry.supportedLanguages() returned ${actualKeyCount} keys, but ` +
        `allAdapters' own ids+aliases imply ${expectedKeyCount} -- registration didn't behave as ` +
        `expected (duplicate id/alias?). Refusing to emit possibly-wrong data.`,
    );
  }

  const languages = engine.allAdapters.map(describeLanguage).sort((a, b) => a.id.localeCompare(b.id));

  for (const language of languages) {
    if (!language.id.trim()) {
      throw new Error('generate-site-data: an adapter produced an empty id -- refusing to emit partial data.');
    }
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(languages, null, 2)}\n`, 'utf8');
  console.log(`generate-site-data: wrote ${languages.length} language(s) to ${path.relative(repoRoot, outputPath)}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
