# Contributing

## Commit style

Freeform but structured:

- Short imperative subject line, ≤ 72 characters.
- Optional `scope:` prefix where it aids scanning — e.g. `engine:`, `python:`,
  `ext:`, `cli:`, `docs:`, `build:`, `ci:`, `canary:`, `legal:`.
- A body is used for non-obvious rationale (why, not what).
- No strict Conventional Commits format is enforced.

Examples:

```
engine: define source span and text edit primitives
python: group adjacent string literals into concatenation runs
ext: implement wrap-at-cursor command
```

## Workspace rules

- `packages/engine` must never import `vscode`. This is enforced by an
  ESLint `no-restricted-imports` rule — if it fires, the change belongs in
  `packages/vscode-extension` instead.
- New languages are added as descriptors under `packages/engine`, not as
  engine code changes. See `docs/adapters.md` and `docs/adding-a-language.md`.
- `packages/vscode-extension` and `packages/cli` are independent glue
  layers over `packages/engine`, not a shared dependency of each other —
  neither should import from the other. A module that's genuinely
  editor/runtime-agnostic (config parsing, formatting helpers, ...)
  belongs in `packages/engine` if it's engine-level, or gets its own copy
  in each glue package if it's narrow enough that duplicating it costs
  less than a third shared package would (see `docs/adapters.md`'s CLI
  section for the `.editorconfig` parser as a worked example of that
  call).

## Before opening a PR

```bash
npm ci
npm run build
npm test
npm run lint
npm run typecheck
```

All four must pass. CI runs the same checks on a Node LTS matrix.
