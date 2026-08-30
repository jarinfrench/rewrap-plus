#!/usr/bin/env node
/**
 * Unzips a packaged `.vsix` (without extracting it to disk — a `.vsix` is
 * an ordinary zip, and this only needs each entry's name and declared
 * size, both readable straight from the central directory) and confirms
 * every vendored grammar and core runtime file this extension needs to
 * activate actually made it into the package, at the right size.
 *
 * Closes a gap `docs/adapters.md`'s packaging history left open: commit
 * `9918460` verified a real `.vsix`'s contents by hand — unzipped it and
 * ran `activate()` against exactly those files — but that was a one-time
 * check from before the typescript/cpp/java grammars existed, and nothing
 * since has re-verified that packaging still carries every grammar a
 * newer adapter vendors. The required-file list below is deliberately
 * *not* a hardcoded language list for that exact reason: grammar
 * requirements are read from `packages/engine/grammars/` itself, so a
 * grammar vendored for a future language is checked automatically, not
 * only once someone remembers to update this script too.
 *
 * Deliberately dependency-free: only a file's *name* and *declared
 * uncompressed size* are needed, both sitting in the zip's central
 * directory, so a ~60-line reader covers this without pulling in a zip
 * library. Zip64 (needed past ~4 GiB or 65535 entries) isn't implemented —
 * this package's `.vsix` is nowhere near either threshold, the same
 * "implement only the spec surface this feature needs" call
 * `packages/cli/src/config/toml-subset.ts` already makes for its own
 * minimal-parser problem.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.dirname(scriptsDir);
const repoRoot = path.dirname(path.dirname(packageRoot));

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT_SIZE = 65535;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;

/**
 * Byte offset of the End Of Central Directory record — found by scanning
 * backward from the end of the file, since a variable-length trailing
 * comment (rarely used, but legal) means the record isn't at a fixed
 * offset.
 */
function findEndOfCentralDirectory(buf) {
  const searchFloor = Math.max(0, buf.length - EOCD_MIN_SIZE - MAX_COMMENT_SIZE);
  for (let offset = buf.length - EOCD_MIN_SIZE; offset >= searchFloor; offset--) {
    if (buf.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  throw new Error('verify-vsix-contents: no End Of Central Directory record found — not a valid zip?');
}

/** Maps each zip entry's stored name to its declared uncompressed size. */
function readZipEntries(buf) {
  const eocdOffset = findEndOfCentralDirectory(buf);
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  let offset = buf.readUInt32LE(eocdOffset + 16);

  const entries = new Map();
  for (let i = 0; i < totalEntries; i++) {
    const signature = buf.readUInt32LE(offset);
    if (signature !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error(
        `verify-vsix-contents: expected a central directory record at byte ${offset}, found signature 0x${signature.toString(16)} — malformed or truncated .vsix?`,
      );
    }
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const name = buf.toString('utf8', nameStart, nameStart + nameLength);

    entries.set(name, { uncompressedSize });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findVsix() {
  const candidates = fs.readdirSync(packageRoot).filter((entry) => entry.endsWith('.vsix'));
  if (candidates.length === 0) {
    throw new Error(`verify-vsix-contents: no .vsix found in ${packageRoot} — run "npm run package" first.`);
  }
  if (candidates.length > 1) {
    throw new Error(
      `verify-vsix-contents: multiple .vsix files found in ${packageRoot} (${candidates.join(', ')}) — pass the one to check as an argument.`,
    );
  }
  return path.join(packageRoot, candidates[0]);
}

function main() {
  const vsixPath = process.argv[2] ?? findVsix();
  const entries = readZipEntries(fs.readFileSync(vsixPath));

  const grammarsDir = path.join(repoRoot, 'packages', 'engine', 'grammars');
  const grammarFiles = fs.readdirSync(grammarsDir).filter((entry) => entry.endsWith('.wasm'));
  if (grammarFiles.length === 0) {
    throw new Error(`verify-vsix-contents: no vendored grammar .wasm files found under ${grammarsDir} — nothing to check against.`);
  }

  const failures = [];

  for (const requiredFile of [
    'extension/dist/extension.js',
    'extension/dist/web-tree-sitter-runtime/web-tree-sitter.wasm',
    'extension/dist/web-tree-sitter-runtime/web-tree-sitter.cjs',
    'extension/package.json',
  ]) {
    if (!entries.has(requiredFile)) {
      failures.push(`missing required file: ${requiredFile}`);
    }
  }

  for (const grammarFile of grammarFiles) {
    const entryName = `extension/grammars/${grammarFile}`;
    const entry = entries.get(entryName);
    if (!entry) {
      failures.push(
        `missing vendored grammar in the packaged .vsix: ${entryName} (present under packages/engine/grammars/ but not found in the package — a new or renamed grammar was likely vendored without a fresh build)`,
      );
      continue;
    }
    const sourceSize = fs.statSync(path.join(grammarsDir, grammarFile)).size;
    if (entry.uncompressedSize !== sourceSize) {
      failures.push(
        `size mismatch for ${entryName}: packaged uncompressed size is ${entry.uncompressedSize} bytes, vendored source is ${sourceSize} bytes — the packaged copy may be stale or corrupted`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(`verify-vsix-contents: ${vsixPath} failed verification:\n`);
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `verify-vsix-contents: ${vsixPath} — all ${grammarFiles.length} vendored grammar(s) and core runtime files verified present at the correct size.`,
  );
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
