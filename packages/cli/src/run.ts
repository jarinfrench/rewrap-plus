/**
 * The CLI's testable core: parse args, discover files, wrap each one,
 * print results, and return an exit code — everything `./cli.ts`'s thin
 * entry point needs, minus actually touching `process.argv`/
 * `process.exit` so this can be called directly from a test with a
 * fake argv and captured output.
 *
 * Exit codes (matching Black's own `--check` convention, not invented
 * fresh — a CI/pre-commit hook author already knows this shape):
 * - `0` — nothing needed changing (or everything was rewritten cleanly).
 * - `1` — `--check` found at least one file that would change.
 * - `2` — a hard error: bad arguments, a missing path, an explicit file
 *   with an unrecognized extension and no `--language`, or a per-file
 *   processing error (parse failure, unsupported language, ...).
 */
import { createRequire } from 'node:module';
import { CliArgsError, USAGE, parseCliArgs } from './args.js';
import { processFile, type FileOutcome } from './apply.js';
import { discoverFiles } from './file-discovery.js';
import { getParserManager, getSupportedLanguages } from './engine-host.js';
import { formatFileLine, formatRewraprcWarning, formatSummaryLine, summarize } from './report.js';

export interface RunIo {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

// `createRequire` (not a hardcoded string) so this can never drift from
// `package.json`'s own `version` field. Relative resolution from this
// module's own location works whether it's running as `src/run.ts`
// (vitest, transpiled in place) or the built `dist/run.js` — both sit
// exactly one directory below `packages/cli/`, so `'../package.json'`
// reaches the same file either way.
const require = createRequire(import.meta.url);
const CLI_VERSION = (require('../package.json') as { readonly version: string }).version;

export async function run(argv: readonly string[], io: RunIo): Promise<number> {
  let args;
  try {
    args = parseCliArgs(argv);
  } catch (error) {
    io.stderr((error as CliArgsError).message);
    io.stderr(USAGE);
    return 2;
  }

  if (args.help) {
    io.stdout(USAGE);
    return 0;
  }
  if (args.version) {
    io.stdout(CLI_VERSION);
    return 0;
  }
  if (args.paths.length === 0) {
    io.stderr('rewrap-plus: no <path> arguments given.');
    io.stderr(USAGE);
    return 2;
  }

  const discovery = discoverFiles(args.paths, { languageOverride: args.language });

  let hardError = false;
  for (const path of discovery.missing) {
    io.stderr(`error   ${path}: no such file or directory`);
    hardError = true;
  }
  for (const path of discovery.unrecognized) {
    io.stderr(
      `error   ${path}: unrecognized file extension (pass --language to force one, e.g. --language python)`,
    );
    hardError = true;
  }

  if (discovery.files.length === 0) {
    if (!hardError) {
      io.stdout('No files matched.');
    }
    return hardError ? 2 : 0;
  }

  const supportedLanguages = await getSupportedLanguages();
  const parserManager = await getParserManager();
  const mode = args.check ? 'check' : 'write';

  const outcomes: FileOutcome[] = [];
  for (const file of discovery.files) {
    if (!supportedLanguages.includes(file.languageId)) {
      // Reachable when --language names a real languageId that just
      // isn't one this build registers an adapter for — every
      // extension-detected languageId (./language-detection.ts) is
      // already drawn from the registered set, so this path is
      // exercised by --language, not ordinary directory walks.
      io.stderr(`error   ${file.path}: no adapter registered for language '${file.languageId}'`);
      hardError = true;
      continue;
    }
    const outcome = await processFile(file, parserManager, args.config, mode);
    outcomes.push(outcome);

    const warning = formatRewraprcWarning(outcome);
    if (warning) {
      io.stderr(warning);
    }
    if (outcome.error) {
      hardError = true;
      io.stderr(`error   ${outcome.path}: ${outcome.error}`);
      continue;
    }
    const line = formatFileLine(outcome, mode);
    if (line) {
      io.stdout(line);
    }
  }

  const summary = summarize(outcomes);
  io.stdout(formatSummaryLine(summary, mode));

  if (hardError) {
    return 2;
  }
  if (mode === 'check' && summary.changed > 0) {
    return 1;
  }
  return 0;
}
