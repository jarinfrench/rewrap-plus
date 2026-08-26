/**
 * Assembles the engine's `WrapConfig` for one file — the CLI's
 * counterpart to
 * `packages/vscode-extension/src/config/resolve-wrap-config.ts`: the
 * point where `--flags`, `.rewraprc`, `pyproject.toml`, and
 * `.editorconfig` all come together.
 *
 * Every field except `columnLimit` follows the same flat, four-tier
 * chain (flag > `.rewraprc` > `pyproject.toml` > built-in default) —
 * `??` on each source in turn. `columnLimit` alone gets a fifth tier
 * (`.editorconfig`, between `pyproject.toml` and the default) via
 * `./column-limit.ts`, since it's the one field `.editorconfig` also has
 * an opinion about.
 */
import type { WrapConfig } from '@rewrap-plus/engine';
import { resolveColumnLimit, type ResolvedColumnLimit } from './column-limit.js';
import { DEFAULT_CLI_CONFIG } from './defaults.js';
import { resolveEditorConfigMaxLineLength } from './editorconfig.js';
import { resolvePyprojectConfig } from './pyproject.js';
import { resolveRewraprcConfig } from './rewraprc.js';
import type { PartialCliConfig } from './types.js';

export interface ResolvedFileConfig {
  readonly wrapConfig: WrapConfig;
  readonly columnLimit: ResolvedColumnLimit;
  /** Path of the `.rewraprc`/`.rewraprc.json` actually used, if any — surfaced for `--show-config`-style diagnostics. */
  readonly rewraprcPath: string | undefined;
  /** Set when a `.rewraprc` was found but failed to parse — the caller warns rather than treating this as fatal (`./rewraprc.ts`'s own "skip, warn, never block" framing). */
  readonly rewraprcParseError: string | undefined;
}

export function resolveConfigForFile(filePath: string, flags: PartialCliConfig): ResolvedFileConfig {
  const pyprojectConfig = resolvePyprojectConfig(filePath);
  const { config: rewraprcConfig, path: rewraprcPath, parseError: rewraprcParseError } =
    resolveRewraprcConfig(filePath);

  const tabSize = pick('tabSize', flags, rewraprcConfig, pyprojectConfig);
  const wrapComments = pick('wrapComments', flags, rewraprcConfig, pyprojectConfig);
  const wrapStrings = pick('wrapStrings', flags, rewraprcConfig, pyprojectConfig);
  const stringPolicy = pick('stringPolicy', flags, rewraprcConfig, pyprojectConfig);
  const docDialect = pick('docDialect', flags, rewraprcConfig, pyprojectConfig);
  const preserveIndentedBlocks = pick('preserveIndentedBlocks', flags, rewraprcConfig, pyprojectConfig);
  const balancedWrapping = pick('balancedWrapping', flags, rewraprcConfig, pyprojectConfig);
  const respectEditorConfig = pick('respectEditorConfig', flags, rewraprcConfig, pyprojectConfig);

  const editorConfigMaxLineLength = respectEditorConfig
    ? resolveEditorConfigMaxLineLength(filePath)
    : undefined;

  const columnLimit = resolveColumnLimit({
    flagColumnLimit: flags.columnLimit,
    rewraprcColumnLimit: rewraprcConfig.columnLimit,
    pyprojectColumnLimit: pyprojectConfig.columnLimit,
    editorConfigMaxLineLength,
  });

  const wrapConfig: WrapConfig = {
    columnLimit: columnLimit.value,
    tabSize,
    wrapComments,
    wrapStrings,
    stringPolicy,
    docDialect,
    preserveIndentedBlocks,
    balancedWrapping,
  };

  return { wrapConfig, columnLimit, rewraprcPath, rewraprcParseError };
}

/** `flags[field] ?? rewraprc[field] ?? pyproject[field] ?? DEFAULT_CLI_CONFIG[field]` — spelled as a function so each call site above stays a one-liner naming just the field. */
function pick<K extends keyof PartialCliConfig>(
  field: K,
  flags: PartialCliConfig,
  rewraprcConfig: PartialCliConfig,
  pyprojectConfig: PartialCliConfig,
): NonNullable<PartialCliConfig[K]> {
  return (flags[field] ?? rewraprcConfig[field] ?? pyprojectConfig[field] ?? DEFAULT_CLI_CONFIG[field])!;
}
