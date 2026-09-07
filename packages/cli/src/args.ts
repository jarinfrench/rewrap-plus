/**
 * Command-line argument parsing, via `node:util`'s `parseArgs` -- stable
 * since Node 20 (this repo's own floor, `package.json`'s `engines.node`)
 * -- rather than a third-party arg-parsing dependency. Self-contained by
 * design, the same call `./config/editorconfig.ts` already made for
 * `.editorconfig` and `./config/toml-subset.ts` made for
 * `pyproject.toml`: this repo reaches for "write the narrow thing
 * ourselves" over "add a dependency" whenever the narrow thing is this
 * cheap to get right.
 */
import { parseArgs } from 'node:util';
import type { PartialCliConfig } from './config/types.js';

export interface CliArgs {
  readonly help: boolean;
  readonly version: boolean;
  readonly check: boolean;
  readonly language: string | undefined;
  readonly paths: readonly string[];
  readonly config: PartialCliConfig;
}

/** Thrown for a malformed invocation -- `./run.ts` catches this and prints just the message plus usage, not a stack trace. */
export class CliArgsError extends Error {}

const STRING_POLICIES = ['prose', 'all', 'off'];
const DOC_DIALECTS = ['auto', 'google', 'numpy', 'sphinx', 'jsdoc', 'doxygen', 'plain'];

export function parseCliArgs(argv: readonly string[]): CliArgs {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        check: { type: 'boolean' },
        language: { type: 'string' },
        'column-limit': { type: 'string' },
        'tab-size': { type: 'string' },
        'wrap-comments': { type: 'boolean' },
        'no-wrap-comments': { type: 'boolean' },
        'wrap-strings': { type: 'boolean' },
        'no-wrap-strings': { type: 'boolean' },
        'string-policy': { type: 'string' },
        'doc-dialect': { type: 'string' },
        'preserve-indented-blocks': { type: 'boolean' },
        'no-preserve-indented-blocks': { type: 'boolean' },
        'balanced-wrapping': { type: 'boolean' },
        'no-balanced-wrapping': { type: 'boolean' },
        editorconfig: { type: 'boolean' },
        'no-editorconfig': { type: 'boolean' },
      },
    }));
  } catch (error) {
    throw new CliArgsError(error instanceof Error ? error.message : String(error));
  }

  const config: { -readonly [K in keyof PartialCliConfig]?: PartialCliConfig[K] } = {};

  if (values['column-limit'] !== undefined) {
    config.columnLimit = parsePositiveInt('--column-limit', values['column-limit']);
  }
  if (values['tab-size'] !== undefined) {
    config.tabSize = parsePositiveInt('--tab-size', values['tab-size']);
  }
  // `exactOptionalPropertyTypes` (tsconfig.base.json) means an optional
  // field must be omitted, not assigned `undefined` -- `setIfDefined`
  // enforces that once here rather than at each of these five call
  // sites.
  setIfDefined(config, 'wrapComments', negatableFlag('wrap-comments', values));
  setIfDefined(config, 'wrapStrings', negatableFlag('wrap-strings', values));
  setIfDefined(config, 'preserveIndentedBlocks', negatableFlag('preserve-indented-blocks', values));
  setIfDefined(config, 'balancedWrapping', negatableFlag('balanced-wrapping', values));
  setIfDefined(config, 'respectEditorConfig', negatableFlag('editorconfig', values));

  if (values['string-policy'] !== undefined) {
    config.stringPolicy = parseEnum('--string-policy', values['string-policy'], STRING_POLICIES) as
      | 'prose'
      | 'all'
      | 'off';
  }
  if (values['doc-dialect'] !== undefined) {
    config.docDialect = parseEnum('--doc-dialect', values['doc-dialect'], DOC_DIALECTS) as
      | 'auto'
      | 'google'
      | 'numpy'
      | 'sphinx'
      | 'jsdoc'
      | 'doxygen'
      | 'plain';
  }

  return {
    help: values.help ?? false,
    version: values.version ?? false,
    check: values.check ?? false,
    language: values.language,
    paths: positionals,
    config,
  };
}

function setIfDefined<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

/** `--foo`/`--no-foo` pairs: `--no-foo` wins if both are somehow passed (last-one-should-win is ambiguous with `parseArgs`'s own "last flag wins" only applying per-flag-name, not across a negated pair -- `--no-foo` taking priority is the safer read of "did the user mean to turn this off"). `undefined` when neither was passed, so `./config/resolve-config.ts`'s precedence chain falls through to the next source. */
function negatableFlag(name: string, values: Record<string, unknown>): boolean | undefined {
  const negated = values[`no-${name}`];
  if (negated === true) {
    return false;
  }
  const positive = values[name];
  if (positive === true) {
    return true;
  }
  return undefined;
}

function parsePositiveInt(flag: string, raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== raw.trim()) {
    throw new CliArgsError(`${flag} expects a positive integer, got '${raw}'`);
  }
  return parsed;
}

function parseEnum(flag: string, raw: string, allowed: readonly string[]): string {
  if (!allowed.includes(raw)) {
    throw new CliArgsError(`${flag} expects one of ${allowed.join(', ')}, got '${raw}'`);
  }
  return raw;
}

export const USAGE = `Usage: rewrap-plus [options] <path...>

Rewraps comments, docstrings, and string literals to a configured column
limit. Wraps files in place by default; pass --check for a dry run suitable
for CI and pre-commit hooks.

Positional arguments:
  <path...>                     Files and/or directories to process.
                                 Directories are walked recursively (see
                                 README for the default ignore list).

Options:
  --check                       Exit non-zero if any file would change;
                                 never writes.
  --language <id>                Force a languageId for explicit file
                                 arguments whose extension isn't recognized
                                 (ignored for files found via a directory).
  --column-limit <n>             Override the resolved column limit.
  --tab-size <n>                 Override the resolved tab size.
  --wrap-comments / --no-wrap-comments
  --wrap-strings / --no-wrap-strings
  --string-policy <prose|all|off>
  --doc-dialect <auto|google|numpy|sphinx|jsdoc|doxygen|plain>
  --preserve-indented-blocks / --no-preserve-indented-blocks
  --balanced-wrapping / --no-balanced-wrapping
  --editorconfig / --no-editorconfig
                                 Enable/disable the .editorconfig
                                 max_line_length tier.
  -h, --help                    Show this help and exit.
  -v, --version                 Show the version and exit.

Configuration precedence (highest to lowest) for every option above:
flag > .rewraprc > pyproject.toml's [tool.rewrap-plus] > (column limit only)
.editorconfig > built-in default.
`;
