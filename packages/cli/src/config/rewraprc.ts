/**
 * Reads the nearest ancestor `.rewraprc` / `.rewraprc.json`.
 *
 * Plain JSON, keyed exactly like `packages/vscode-extension`'s
 * `rewrapPlus.*` settings (camelCase, no `rewrapPlus.` prefix -- e.g.
 * `{ "columnLimit": 88, "stringPolicy": "all" }`) -- deliberate
 * consistency with the extension's own settings namespace, unlike
 * `./pyproject.ts`'s kebab-case keys, which instead mirror *that* file's
 * own ecosystem convention. Two file formats, two audiences, two
 * matching naming conventions, rather than picking one and making the
 * other format's users translate.
 *
 * Only the nearest `.rewraprc`/`.rewraprc.json` is consulted, the same
 * "nearest wins outright, not a layered chain" choice
 * `./pyproject.ts` makes and for the identical reason: this is a
 * project-level config file, not a per-directory override mechanism the
 * way `.editorconfig` deliberately is.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PartialCliConfig } from './types.js';
import { walkUpToRoot } from './walk-up-to-root.js';

const CANDIDATE_FILENAMES = ['.rewraprc', '.rewraprc.json'];

/** Walk from `startDir` up to the filesystem root looking for the nearest `.rewraprc`/`.rewraprc.json`; returns its path, or `undefined` if neither exists anywhere on the way up. */
export function findNearestRewraprc(startDir: string): string | undefined {
  let found: string | undefined;
  walkUpToRoot(startDir, (dir) => {
    for (const filename of CANDIDATE_FILENAMES) {
      const candidate = join(dir, filename);
      if (existsSync(candidate)) {
        found = candidate;
        return 'stop';
      }
    }
    return 'continue';
  });
  return found;
}

const STRING_POLICIES = ['prose', 'all', 'off'] as const;
const DOC_DIALECTS = ['auto', 'google', 'numpy', 'sphinx', 'jsdoc', 'doxygen', 'plain'] as const;

/**
 * Resolve the `.rewraprc`/`.rewraprc.json` config that applies to
 * `filePath`. Returns an empty config when none exists on the way up to
 * the filesystem root, or when the nearest one found is present but
 * fails to parse as valid JSON -- malformed input is warned about by the
 * caller (`./resolve-config.ts`), not thrown here, matching this
 * project's engine-wide "skip, warn, never block" posture applied to a
 * config file instead of a source region.
 */
export function resolveRewraprcConfig(filePath: string): {
  readonly config: PartialCliConfig;
  readonly path: string | undefined;
  readonly parseError: string | undefined;
} {
  const rcPath = findNearestRewraprc(dirname(filePath));
  if (!rcPath) {
    return { config: {}, path: undefined, parseError: undefined };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(rcPath, 'utf8'));
  } catch (error) {
    return {
      config: {},
      path: rcPath,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }

  return { config: pickKnownFields(raw), path: rcPath, parseError: undefined };
}

/**
 * Type-checks each known field individually rather than trusting
 * `JSON.parse`'s `unknown` result wholesale -- a `.rewraprc` with e.g.
 * `"columnLimit": "wide"` (wrong type, still valid JSON) has that one
 * field silently omitted rather than corrupting `WrapConfig` with a
 * value the engine never expects, or throwing over one bad field in an
 * otherwise-usable file. Unknown top-level keys are ignored outright
 * (forward-compatible with a future field, and forgiving of a typo
 * rather than a hard failure).
 */
function pickKnownFields(raw: unknown): PartialCliConfig {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const obj = raw as Record<string, unknown>;
  const config: { -readonly [K in keyof PartialCliConfig]?: PartialCliConfig[K] } = {};

  if (typeof obj.columnLimit === 'number') {
    config.columnLimit = obj.columnLimit;
  }
  if (typeof obj.tabSize === 'number') {
    config.tabSize = obj.tabSize;
  }
  if (typeof obj.wrapComments === 'boolean') {
    config.wrapComments = obj.wrapComments;
  }
  if (typeof obj.wrapStrings === 'boolean') {
    config.wrapStrings = obj.wrapStrings;
  }
  if (typeof obj.stringPolicy === 'string' && (STRING_POLICIES as readonly string[]).includes(obj.stringPolicy)) {
    config.stringPolicy = obj.stringPolicy as (typeof STRING_POLICIES)[number];
  }
  if (typeof obj.docDialect === 'string' && (DOC_DIALECTS as readonly string[]).includes(obj.docDialect)) {
    config.docDialect = obj.docDialect as (typeof DOC_DIALECTS)[number];
  }
  if (typeof obj.preserveIndentedBlocks === 'boolean') {
    config.preserveIndentedBlocks = obj.preserveIndentedBlocks;
  }
  if (typeof obj.balancedWrapping === 'boolean') {
    config.balancedWrapping = obj.balancedWrapping;
  }
  if (typeof obj.respectEditorConfig === 'boolean') {
    config.respectEditorConfig = obj.respectEditorConfig;
  }

  return config;
}
