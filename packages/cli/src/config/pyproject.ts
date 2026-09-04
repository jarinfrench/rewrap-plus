/**
 * Reads `[tool.rewrap-plus]` out of the nearest ancestor `pyproject.toml`
 * — one of the CLI's configuration sources, alongside `.rewraprc` /
 * `.rewraprc.json` and CLI flags.
 *
 * Keys are kebab-case, matching every other `[tool.*]` table's own
 * convention in the Python packaging ecosystem this file lives
 * alongside (Black's `line-length`, Ruff's `line-length`/`target-version`,
 * ...) — deliberately *not* the camelCase `./rewraprc.ts` uses to mirror
 * `rewrapPlus.*` VSCode settings, since `.rewraprc` and `pyproject.toml`
 * are read by different audiences with different naming expectations.
 *
 * Only the nearest `pyproject.toml` is consulted — unlike
 * `./editorconfig.ts`'s multi-file, root-to-leaf walk, this matches how
 * Python tooling (Black, Ruff) itself treats `pyproject.toml`: the
 * nearest one *is* the project root's config, not one layer in a chain
 * of overrides.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseTomlSubset, type TomlValue } from './toml-subset.js';
import type { PartialCliConfig } from './types.js';
import { walkUpToRoot } from './walk-up-to-root.js';

const TOOL_TABLE = 'tool.rewrap-plus';

/** Walk from `startDir` up to the filesystem root looking for the nearest `pyproject.toml`; returns its path, or `undefined` if none exists. */
export function findNearestPyproject(startDir: string): string | undefined {
  let found: string | undefined;
  walkUpToRoot(startDir, (dir) => {
    const candidate = join(dir, 'pyproject.toml');
    if (existsSync(candidate)) {
      found = candidate;
      return 'stop';
    }
    return 'continue';
  });
  return found;
}

/**
 * Resolve the `[tool.rewrap-plus]` config that applies to `filePath`, by
 * finding and parsing the nearest ancestor `pyproject.toml`. Returns an
 * empty config (not `undefined`) both when no `pyproject.toml` exists
 * and when one exists but declares no `[tool.rewrap-plus]` table — a
 * project's `pyproject.toml` existing for unrelated tools
 * (`[tool.black]`, `[build-system]`, ...) is the common case, not an
 * error.
 */
export function resolvePyprojectConfig(filePath: string): PartialCliConfig {
  const pyprojectPath = findNearestPyproject(dirname(filePath));
  if (!pyprojectPath) {
    return {};
  }

  const content = readFileSync(pyprojectPath, 'utf8');
  const tables = parseTomlSubset(content);
  const table = tables.get(TOOL_TABLE);
  if (!table) {
    return {};
  }

  return {
    ...numberField(table, 'column-limit', 'columnLimit'),
    ...numberField(table, 'tab-size', 'tabSize'),
    ...booleanField(table, 'wrap-comments', 'wrapComments'),
    ...booleanField(table, 'wrap-strings', 'wrapStrings'),
    ...stringField(table, 'string-policy', 'stringPolicy', ['prose', 'all', 'off'] as const),
    ...stringField(table, 'doc-dialect', 'docDialect', [
      'auto',
      'google',
      'numpy',
      'sphinx',
      'jsdoc',
      'doxygen',
      'plain',
    ] as const),
    ...booleanField(table, 'preserve-indented-blocks', 'preserveIndentedBlocks'),
    ...booleanField(table, 'balanced-wrapping', 'balancedWrapping'),
    ...booleanField(table, 'respect-editor-config', 'respectEditorConfig'),
  };
}

// Each helper below returns a one-key (or empty) object rather than
// mutating a shared accumulator, so the spread chain above reads as a
// flat list of "this TOML key becomes this config field" declarations —
// a value of the wrong TOML type (e.g. `column-limit = "wide"`) is
// silently omitted rather than thrown, the same defensive posture
// `./toml-subset.ts` itself already takes for unsupported value shapes.

function numberField<K extends string>(
  table: ReadonlyMap<string, TomlValue>,
  tomlKey: string,
  configKey: K,
): Partial<Record<K, number>> {
  const value = table.get(tomlKey);
  return typeof value === 'number' ? ({ [configKey]: value } as Partial<Record<K, number>>) : {};
}

function booleanField<K extends string>(
  table: ReadonlyMap<string, TomlValue>,
  tomlKey: string,
  configKey: K,
): Partial<Record<K, boolean>> {
  const value = table.get(tomlKey);
  return typeof value === 'boolean' ? ({ [configKey]: value } as Partial<Record<K, boolean>>) : {};
}

function stringField<K extends string, V extends string>(
  table: ReadonlyMap<string, TomlValue>,
  tomlKey: string,
  configKey: K,
  allowed: readonly V[],
): Partial<Record<K, V>> {
  const value = table.get(tomlKey);
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return { [configKey]: value as V } as Partial<Record<K, V>>;
  }
  return {};
}
