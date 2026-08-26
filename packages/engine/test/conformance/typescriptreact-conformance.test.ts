import { typescriptReactAdapter } from '../../src/languages/typescript/adapter.js';
import { runAdapterConformance } from '../../src/conformance/run-adapter-conformance.js';

/**
 * TSX's own pass through the conformance suite — a genuinely separate
 * grammar from plain TypeScript (`../../src/languages/typescript/descriptor.ts`'s
 * own doc comment on why), so it gets its own conformance run rather than
 * relying on `./typescript-conformance.test.ts` to stand in for it.
 * Sources below wrap a JSX element's own comment and doc comment, proving
 * the shared ECMAScript-family dissolve/emit path holds inside JSX too,
 * not just plain statements.
 */
const CRLF_SOURCE =
  '/**\r\n' +
  ' * Renders a greeting banner for the given user, wrapped across enough lines to need reflow.\r\n' +
  ' */\r\n' +
  'function Greeting(props: { name: string }) {\r\n' +
  '  // this comment inside a component body is long enough that it needs to be wrapped too\r\n' +
  '  return <div className="greeting">{"Hello, " + props.name}</div>;\r\n' +
  '}\r\n';

const LF_SOURCE = CRLF_SOURCE.replace(/\r\n/g, '\n');

runAdapterConformance(typescriptReactAdapter, {
  wasmDir: '.',
  columnLimit: 40,
  sources: [CRLF_SOURCE, LF_SOURCE],
});
