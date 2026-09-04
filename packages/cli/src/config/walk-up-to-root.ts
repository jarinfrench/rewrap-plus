import { dirname } from 'node:path';

/**
 * Walk from `startDir` up to the filesystem root, one directory at a time,
 * calling `visit` at each level — the shared shape `./pyproject.ts`'s
 * `findNearestPyproject`, `./rewraprc.ts`'s `findNearestRewraprc`, and this
 * file's own `collectEditorConfigFiles` each used to hand-roll separately
 * (same `for (;;) { ...; const parent = dirname(dir); if (parent === dir)
 * { ...; } dir = parent; }` loop, same `parent === dir` filesystem-root
 * termination, differing only in what happens at each directory and
 * whether the walk stops on the first hit or keeps collecting).
 *
 * `visit` returns `'stop'` to end the walk after that directory — a match
 * found (`findNearestPyproject`/`findNearestRewraprc`) or an explicit halt
 * condition (`.editorconfig`'s `root = true`) — or `'continue'` to keep
 * walking upward. `visit` reports what it found via its own closure, not a
 * return value threaded back through here, since the three current callers
 * want different shapes back (a single path, or an accumulated list) and
 * this walk doesn't need to know which.
 *
 * Deliberately CLI-internal only: `packages/vscode-extension`'s own
 * `.editorconfig` walk-up has the identical shape but stays a separate
 * copy, for the same "independent peer packages" reason
 * `packages/cli/src/config/editorconfig.ts`'s own doc comment gives in
 * full — this helper only consolidates the three copies that already live
 * inside this one package.
 */
export function walkUpToRoot(startDir: string, visit: (dir: string) => 'stop' | 'continue'): void {
  let dir = startDir;
  for (;;) {
    if (visit(dir) === 'stop') {
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return; // reached the filesystem root
    }
    dir = parent;
  }
}
