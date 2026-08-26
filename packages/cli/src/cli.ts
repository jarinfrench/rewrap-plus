#!/usr/bin/env node
/**
 * The `rewrap-plus` bin entry point (`package.json`'s `bin` field) — as
 * thin as `./run.ts`'s signature allows: wire real `process.argv`/
 * `console`/`process.exitCode` to the testable core and nothing else.
 * `process.exitCode` (not `process.exit()`) so any pending I/O flushes
 * before the process actually exits.
 */
import { run } from './run.js';

const exitCode = await run(process.argv.slice(2), {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
});
process.exitCode = exitCode;
