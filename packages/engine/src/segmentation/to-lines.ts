/**
 * Split dissolved region text into logical lines, dropping the single
 * trailing empty element `String.split` produces for a final newline.
 *
 * Shared by `split-blocks.ts` and the per-kind detectors added later in
 * this phase (`list-item.ts`, `verbatim.ts`) so every one of them agrees
 * on what "line N" means — in particular, that a source ending in `\n`
 * has the same line count as one that doesn't, matching how every other
 * line-oriented tool in the ecosystem (git diff, editors, `wc -l`)
 * treats a trailing newline as terminating the last line rather than
 * starting an empty one after it.
 *
 * Recognizes `\n`, `\r\n`, and bare `\r` — dissolve (Phase 6+) hands this
 * function already-dissolved region text, which may still carry whatever
 * line ending convention the source file used (Phase 10 normalizes CRLF
 * handling end to end; this function just needs to not miscount lines in
 * the meantime).
 */
export function toLines(text: string): string[] {
  const rawLines = text.split(/\r\n|\r|\n/);
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    return rawLines.slice(0, -1);
  }
  return rawLines;
}
