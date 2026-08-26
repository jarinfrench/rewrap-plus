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

## Commands and keybindings

- **Rewrap+: Wrap at Cursor** (`rewrapPlus.wrapAtCursor`) — `Alt+Q` (`Cmd+Alt+Q`
  on macOS). **Note:** this collides with stkb/Rewrap's own default `Alt+Q`
  binding — the two extensions can't sensibly be bound to the same key at
  once. Rebind one of them (`Preferences: Open Keyboard Shortcuts`) if you
  have both installed.
- **Rewrap+: Wrap Selection** (`rewrapPlus.wrapSelection`) — no default
  keybinding; also reachable via `Format Selection`
  (`editor.action.formatSelection`), since Rewrap+ registers a
  `DocumentRangeFormattingEditProvider` backed by the same wrap path.
- **Rewrap+: Wrap Document** (`rewrapPlus.wrapDocument`) — no default
  keybinding; `Format Document` also invokes the range-formatting provider
  above when no other formatter is registered for the language. Shows a
  cancellable progress notification for large documents (2000+ lines).
- **Rewrap+: Show Resolved Configuration** (`rewrapPlus.showResolvedConfig`)
  — dumps the effective column limit (and which precedence tier it came
  from), active string/doc-dialect policy, and extension version for the
  current file to the "Rewrap+" output channel. A telemetry-free diagnostic
  aid for bug reports and for answering "why did it wrap at N?" — works
  even for an unsupported language, reporting that explicitly.

The three wrap commands are Python-only for now (v1 language scope,
decision of record); they gray themselves out in unsupported languages.

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
