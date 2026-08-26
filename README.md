# Rewrap+

A VSCode extension — and companion CLI — that rewraps comments, docstrings,
and string literals to a configured column limit, preserving formatted
structure and emitting language-valid concatenation on split.

Status: v1 feature-complete (through Phase 11 of
`docs/implementation-plan.md`), plus a CLI for scripting/pre-commit use
(Phase 12d) — installable as a `.vsix`/`npm install`, not yet published to
a marketplace or registry (Phase 12e). See
[CHANGELOG.md](./CHANGELOG.md) for what's shipped and what's known-missing.

## Repository layout

This is an npm workspaces monorepo:

- `packages/engine` — the pure wrapping engine (parsing, region discovery,
  reflow, emit). Framework-agnostic.
- `packages/vscode-extension` — the thin VSCode glue layer that adapts the
  engine to editor commands, configuration, and formatting providers.
- `packages/cli` — the thin CLI glue layer (`rewrap-plus` on the command
  line) for scripting, CI, and pre-commit hooks.

**Hard rule:** `packages/engine` must never import `vscode`. The engine is
the reuse seam a CLI / pre-commit hook builds on, and that only holds if it
stays free of editor-host dependencies. This is enforced mechanically via an
ESLint `no-restricted-imports` rule, not just documentation. `packages/cli`
is the proof the seam holds in practice — see
[`docs/adapters.md`](docs/adapters.md)'s Phase 12d section for what
building it against the unchanged engine actually looked like.

## Using the extension or the CLI

Features, commands and keybindings, the full settings reference, the
column-limit precedence chain, directive comment syntax, and what the
extension deliberately won't touch all live in
[`packages/vscode-extension/README.md`](packages/vscode-extension/README.md)
— the canonical user-facing doc (and what ships inside the packaged
`.vsix` for the Marketplace listing). The CLI's own usage, flags, config
file precedence, and exit codes live in
[`packages/cli/README.md`](packages/cli/README.md). This file stays
focused on the monorepo itself.

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

MIT — see [LICENSE](./LICENSE). Third-party licenses for what the
packaged extension actually bundles (`web-tree-sitter`, the vendored
tree-sitter grammars) are in
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
