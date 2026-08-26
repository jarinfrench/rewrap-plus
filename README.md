# Rewrap+

A VSCode extension that rewraps comments, docstrings, and string literals to a
configured column limit, preserving formatted structure and emitting
language-valid concatenation on split.

Status: pre-alpha, under active development. See `docs/implementation-plan.md`
for the full design and phased build-out.

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

## Using the extension

Features, commands and keybindings, the full settings reference, the
column-limit precedence chain, directive comment syntax, and what the
extension deliberately won't touch all live in
[`packages/vscode-extension/README.md`](packages/vscode-extension/README.md)
— the canonical user-facing doc (and what ships inside the packaged
`.vsix` for the Marketplace listing). This file stays focused on the
monorepo itself.

## Development

```bash
npm ci
npm run build
npm test
npm run lint
npm run typecheck
```

`packages/vscode-extension` additionally has a real-VSCode-host integration
suite (`@vscode/test-electron` + Mocha), kept separate from the commands
above since it downloads/launches an actual VSCode build and takes tens of
seconds even when everything passes:

```bash
cd packages/vscode-extension
npm run test:integration
```

## License

MIT — see [LICENSE](./LICENSE).
