# Rewrap+

A VSCode extension that rewraps comments, docstrings, and string literals to a
configured column limit, preserving formatted structure and emitting
language-valid concatenation on split.

Status: pre-alpha, under active development. See `rewrap-plus-implementation-plan.md`
(project docs) for the full design and phased build-out.

## Repository layout

This is an npm workspaces monorepo:

- `packages/engine` — the pure wrapping engine (parsing, region discovery,
  reflow, emit). Framework-agnostic.
- `packages/vscode-extension` — the thin VSCode glue layer that adapts the
  engine to editor commands, configuration, and formatting providers.

**Hard rule:** `packages/engine` must never import `vscode`. The engine is
the reuse seam for a future CLI / pre-commit hook, and that only holds if it
stays free of editor-host dependencies. This is enforced mechanically via an
ESLint `no-restricted-imports` rule, not just documentation.

## Development

```bash
npm ci
npm run build
npm test
npm run lint
npm run typecheck
```

## License

MIT — see [LICENSE](./LICENSE).
