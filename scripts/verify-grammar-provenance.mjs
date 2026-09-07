#!/usr/bin/env node
/**
 * Confirms every vendored grammar `.wasm` file under
 * `packages/engine/grammars/` still matches the sha256 recorded for it in
 * that directory's own `PROVENANCE.md` -- and that the two lists (files on
 * disk, entries in the doc) agree exactly, in both directions.
 *
 * `PROVENANCE.md` records each grammar's source, version, and hash so a
 * tampered or silently-swapped binary can be told apart from the real
 * thing (SECURITY.md's "supply-chain integrity" category) -- but a
 * recorded hash nobody re-checks is a claim, not a guarantee. Before this
 * script, nothing actually recomputed a vendored file's sha256 and
 * compared it against what the doc says; a `.wasm` replaced (accidentally
 * or otherwise) without updating `PROVENANCE.md`, or a doc entry edited
 * without the binary actually changing, would go unnoticed indefinitely.
 *
 * Wired in as a root `pretest` hook (see `package.json`) so it's part of
 * the same `npm test` every CI run and every commit's local gate already
 * executes -- no separate opt-in step to forget.
 *
 * Deliberately dependency-free, matching
 * `packages/vscode-extension/scripts/verify-vsix-contents.mjs`: parsing
 * `PROVENANCE.md`'s own table format with a couple of regexes is simpler
 * and more transparent than pulling in a markdown parser for one file.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const grammarsDir = path.join(repoRoot, 'packages', 'engine', 'grammars');
const provenancePath = path.join(grammarsDir, 'PROVENANCE.md');

const SECTION_HEADER = /^## `([^`]+)`$/gm;
const SHA256_ROW = /\|\s*Vendored file sha256\s*\|\s*`([0-9a-f]{64})`\s*\|/i;

/** Maps each `## \`filename\`` section's documented filename to its "Vendored file sha256" value. */
function parseDocumentedHashes(markdown) {
  const headers = [...markdown.matchAll(SECTION_HEADER)];
  const documented = new Map();

  for (let i = 0; i < headers.length; i++) {
    const filename = headers[i][1];
    const sectionStart = headers[i].index + headers[i][0].length;
    const sectionEnd = i + 1 < headers.length ? headers[i + 1].index : markdown.length;
    const sectionBody = markdown.slice(sectionStart, sectionEnd);

    const match = SHA256_ROW.exec(sectionBody);
    if (match) {
      documented.set(filename, match[1].toLowerCase());
    }
  }

  return documented;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function main() {
  const markdown = fs.readFileSync(provenancePath, 'utf8');
  const documented = parseDocumentedHashes(markdown);
  const vendored = new Set(fs.readdirSync(grammarsDir).filter((entry) => entry.endsWith('.wasm')));

  if (vendored.size === 0) {
    throw new Error(`verify-grammar-provenance: no vendored .wasm files found under ${grammarsDir} -- nothing to check.`);
  }
  if (documented.size === 0) {
    throw new Error(`verify-grammar-provenance: no "Vendored file sha256" entries parsed out of ${provenancePath} -- is its table format unchanged?`);
  }

  const failures = [];

  for (const filename of vendored) {
    if (!documented.has(filename)) {
      failures.push(
        `${filename} is vendored under packages/engine/grammars/ but has no matching "## \`${filename}\`" section (with a "Vendored file sha256" row) in PROVENANCE.md`,
      );
    }
  }

  for (const [filename, expectedHash] of documented) {
    if (!vendored.has(filename)) {
      failures.push(`PROVENANCE.md documents ${filename}, but no such file exists under packages/engine/grammars/ -- stale entry?`);
      continue;
    }
    const actualHash = sha256File(path.join(grammarsDir, filename));
    if (actualHash !== expectedHash) {
      failures.push(
        `${filename}: sha256 mismatch -- PROVENANCE.md says ${expectedHash}, actual file hashes to ${actualHash}. Either the binary changed without updating PROVENANCE.md, or vice versa.`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(`verify-grammar-provenance: ${failures.length} problem(s) found:\n`);
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`verify-grammar-provenance: all ${vendored.size} vendored grammar(s) match their PROVENANCE.md sha256.`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
