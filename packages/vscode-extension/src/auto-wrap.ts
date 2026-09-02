/**
 * `rewrapPlus.autoWrap.enabled`: wrap the comment/docstring the cursor is
 * in the moment a space or Enter keystroke crosses the column limit,
 * mid-typing — Rewrap's own `rewrap.autoWrap.enabled` feature, which
 * Rewrap+ previously had no equivalent of. Unlike every other wrap path
 * (`./commands/*`, `./format-on-save.ts`), the trigger here is the
 * document's own edit stream, not an external event — see
 * `docs/planning/implementation-plan.md`'s Phase 12g for the full design
 * rationale and the three problems that shape this module (reacting to
 * one's own edit, fighting the user's undo stack, and IME composition
 * noise), plus what was actually verified against a live Extension
 * Development Host before this was written.
 *
 * String literals are deliberately out of scope here even when
 * `rewrapPlus.wrapStrings` is on — auto-wrap only ever targets comment
 * and docstring regions. Reflowing a string literal *while the user is
 * still typing inside it* carries materially higher corruption risk
 * (unbalanced quotes, an escape sequence split mid-composition) than
 * doing so afterward via an explicit command; the existing wrap commands
 * accept that risk because they're a deliberate, reviewable action, not
 * one firing on every other keystroke. Revisit only with its own
 * dedicated safety analysis, not as a byproduct of this module.
 */
import * as vscode from 'vscode';
import { getEngine, getSupportedLanguages } from './engine-host.js';
import { readExtensionSettings } from './config/settings.js';
import { resolveWrapConfigForDocument } from './config/resolve-wrap-config.js';
import { computeWrapResult, rangeTargetSpan, toVSCodeTextEdits } from './commands/apply-wrap.js';
import { getOutputChannel } from './output-channel.js';

export const TOGGLE_AUTO_WRAP_COMMAND = 'rewrapPlus.toggleAutoWrap';

const STATUS_BAR_PRIORITY = 100;
const TOGGLE_MESSAGE_TIMEOUT_MS = 5000;

export function registerAutoWrap(context: vscode.ExtensionContext): void {
  // Session-scoped per-document override set by `rewrapPlus.toggleAutoWrap`
  // — a plain `Map` (not `WeakMap`) because the key is `document.uri.toString()`,
  // not the `TextDocument` object itself: the design goal (§4 of the Phase
  // 12g writeup) is "off/on for this *file*, not this *editor instance*",
  // and a closed-then-reopened document is a new `TextDocument` object
  // with the same URI, which should keep its override. `onDidCloseTextDocument`
  // below still prunes it — this is deliberately a session override, not
  // a persisted setting, matching Rewrap's own `toggleAutoWrap` (VSCode
  // doesn't restore it across a window reload, and neither should this).
  const overrides = new Map<string, boolean>();

  // Guards against this module reacting to its own edit: before applying
  // an auto-wrap edit, record the document version that edit will produce;
  // the next `onDidChangeTextDocument` event for that document, if its
  // `document.version` matches, is that self-caused edit and is skipped
  // rather than re-evaluated as a new candidate trigger. A `WeakMap` (not
  // a plain `Map`) so a closed document's entry is never leaked.
  const pendingSelfEdits = new WeakMap<vscode.TextDocument, number>();

  const statusBarItem = vscode.window.createStatusBarItem(
    'rewrapPlus.autoWrap',
    vscode.StatusBarAlignment.Right,
    STATUS_BAR_PRIORITY,
  );
  statusBarItem.name = 'Rewrap+ Auto Wrap';

  context.subscriptions.push(
    statusBarItem,
    vscode.commands.registerCommand(TOGGLE_AUTO_WRAP_COMMAND, () =>
      toggleAutoWrap(overrides, statusBarItem),
    ),
    vscode.workspace.onDidChangeTextDocument((event) =>
      handleDocumentChange(event, overrides, pendingSelfEdits),
    ),
    vscode.window.onDidChangeActiveTextEditor(() => void updateStatusBarItem(statusBarItem, overrides)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('rewrapPlus.autoWrap')) {
        void updateStatusBarItem(statusBarItem, overrides);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => overrides.delete(document.uri.toString())),
  );

  void updateStatusBarItem(statusBarItem, overrides);
}

function isAutoWrapEffectivelyEnabled(document: vscode.TextDocument, overrides: ReadonlyMap<string, boolean>): boolean {
  const settings = readExtensionSettings(document);
  // The global kill switch always wins — nothing, including a per-document
  // override, should re-enable auto-wrap while `rewrapPlus.enable` is off,
  // matching every other command's precedence (`./commands/apply-wrap.ts`'s
  // own `computeWrapResult`).
  if (!settings.enable) {
    return false;
  }
  const override = overrides.get(document.uri.toString());
  return override ?? settings.autoWrap.enabled;
}

async function toggleAutoWrap(
  overrides: Map<string, boolean>,
  statusBarItem: vscode.StatusBarItem,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const { document } = editor;
  const key = document.uri.toString();
  const wasEffectivelyEnabled = isAutoWrapEffectivelyEnabled(document, overrides);
  const nowEnabled = !wasEffectivelyEnabled;
  overrides.set(key, nowEnabled);

  await updateStatusBarItem(statusBarItem, overrides);

  const settings = readExtensionSettings(document);
  if (settings.autoWrap.notification === 'text') {
    vscode.window.setStatusBarMessage(
      `Rewrap+: auto-wrap ${nowEnabled ? 'on' : 'off'} for this file`,
      TOGGLE_MESSAGE_TIMEOUT_MS,
    );
  }
}

async function updateStatusBarItem(
  statusBarItem: vscode.StatusBarItem,
  overrides: ReadonlyMap<string, boolean>,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    statusBarItem.hide();
    return;
  }
  const { document } = editor;
  const settings = readExtensionSettings(document);

  // Matches Rewrap's own 'icon' semantics exactly (confirmed from its
  // published package.json): shown while auto-wrap is on for this
  // document, hidden otherwise — including while 'text' notification
  // mode is selected, since that mode communicates state via a transient
  // status-bar message instead (see `toggleAutoWrap` above), not a
  // persistent icon.
  if (settings.autoWrap.notification !== 'icon') {
    statusBarItem.hide();
    return;
  }

  const supportedLanguages = await getSupportedLanguages();
  if (!supportedLanguages.includes(document.languageId)) {
    statusBarItem.hide();
    return;
  }

  const effective = isAutoWrapEffectivelyEnabled(document, overrides);
  if (!effective) {
    statusBarItem.hide();
    return;
  }

  const isOverride = overrides.has(document.uri.toString());
  statusBarItem.text = '$(word-wrap) Auto Wrap';
  statusBarItem.tooltip = isOverride
    ? 'Rewrap+: auto-wrap is ON for this file (overridden via rewrapPlus.toggleAutoWrap). Click to toggle.'
    : 'Rewrap+: auto-wrap is ON for this file. Click to toggle.';
  statusBarItem.command = TOGGLE_AUTO_WRAP_COMMAND;
  statusBarItem.show();
}

/**
 * Returns the position the trigger character (a space or Enter) was
 * typed at when `contentChanges` looks like exactly that and nothing
 * else — `undefined` otherwise. Multi-range changes (paste, multi-cursor
 * edits, snippet expansion) and any replace-shaped change (a non-empty
 * `range`) are rejected outright.
 *
 * This is also what excludes IME composition, verified against a real
 * composition simulation (`compositionStart`/`compositionType` with
 * `replacePrevCharCnt`/`compositionEnd`) in a live Extension Development
 * Host before this was written: a composing candidate's `.text` is the
 * candidate string itself, never literally a single space or newline, so
 * it can never satisfy the equality check below — regardless of whether
 * the underlying change is single- or multi-range. (An earlier version
 * of this design reasoned the *single-range* check would be what
 * excluded composition; the real exclusion is this text-equality check —
 * composition events observed in that spike were single-range too.)
 *
 * The position returned is `range.start` — where the character landed —
 * not the post-insert cursor position: for Enter, the post-insert
 * position is column 0 of the new line, which would never read as "past
 * the column limit". "You just typed a trigger character at or past the
 * limit" is a statement about where it landed, not where the cursor
 * ended up after.
 */
function matchAutoWrapTrigger(
  contentChanges: readonly vscode.TextDocumentContentChangeEvent[],
): vscode.Position | undefined {
  if (contentChanges.length !== 1) {
    return undefined;
  }
  const change = contentChanges[0]!;
  if (!change.range.isEmpty) {
    return undefined;
  }
  if (change.text !== ' ' && !/^\r?\n$/.test(change.text)) {
    return undefined;
  }
  return change.range.start;
}

async function handleDocumentChange(
  event: vscode.TextDocumentChangeEvent,
  overrides: ReadonlyMap<string, boolean>,
  pendingSelfEdits: WeakMap<vscode.TextDocument, number>,
): Promise<void> {
  const { document } = event;

  const expectedSelfEditVersion = pendingSelfEdits.get(document);
  if (expectedSelfEditVersion !== undefined) {
    pendingSelfEdits.delete(document);
    if (document.version === expectedSelfEditVersion) {
      return;
    }
    // A real edit landed instead of (or interleaved with) our own —
    // fall through and evaluate it normally rather than silently
    // dropping it, since the guard's only job is to skip the one change
    // event *we* caused.
  }

  // `TextEditor.edit()` (needed below for the undo-coalescing behavior
  // verified in the Phase 12g spike — `vscode.workspace.applyEdit`
  // doesn't coalesce with the triggering keystroke) requires the editor
  // instance, not just the document, so auto-wrap only ever acts on the
  // active editor's own document.
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document !== document) {
    return;
  }

  if (!isAutoWrapEffectivelyEnabled(document, overrides)) {
    return;
  }

  const triggerPosition = matchAutoWrapTrigger(event.contentChanges);
  if (!triggerPosition) {
    return;
  }

  // Resolving the real column limit (`.editorconfig` included) only
  // happens once a space/Enter keystroke has already passed the cheap
  // shape check above — not on every keystroke — since it's the one step
  // here that can touch the filesystem.
  const resolvedConfig = resolveWrapConfigForDocument(document);
  if (triggerPosition.character < resolvedConfig.columnLimit.value) {
    return;
  }

  const supportedLanguages = await getSupportedLanguages();
  if (!supportedLanguages.includes(document.languageId)) {
    return;
  }

  try {
    const engine = await getEngine();
    const mapper = new engine.PositionMapper(document.getText());
    const target = rangeTargetSpan(mapper, document, new vscode.Range(triggerPosition, triggerPosition));

    // `wrapStrings: false` is what actually makes this comment/docstring-only
    // (see this module's own doc comment) — independent of whatever
    // `rewrapPlus.wrapStrings` the user has configured for the explicit
    // wrap commands.
    const outcome = await computeWrapResult(document, [target], undefined, {
      report: false,
      wrapStrings: false,
    });
    if (!outcome || outcome.result.cancelled || outcome.documentVersionChanged || outcome.result.edits.length === 0) {
      return;
    }

    // `outcome.documentVersionChanged` already covers "the document
    // changed while `wrapRegions` was computing" (checked above). The one
    // thing that check doesn't cover is the active editor itself changing
    // during that same `await` — re-check before calling `editor.edit()`,
    // since editing a no-longer-active editor is pointless at best.
    if (vscode.window.activeTextEditor !== editor) {
      return;
    }

    const edits = toVSCodeTextEdits(outcome.result.edits);
    const expectedVersion = document.version + 1;
    pendingSelfEdits.set(document, expectedVersion);

    const applied = await editor.edit(
      (editBuilder) => {
        for (const edit of edits) {
          editBuilder.replace(edit.range, edit.newText);
        }
      },
      { undoStopBefore: false, undoStopAfter: true },
    );

    if (!applied) {
      // Our edit never landed — clear the guard so it doesn't
      // accidentally swallow a real future edit that happens to bump
      // the document to the version we were expecting.
      pendingSelfEdits.delete(document);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    getOutputChannel().appendLine(`${document.uri.fsPath}: auto-wrap skipped a keystroke — ${message}`);
  }
}
