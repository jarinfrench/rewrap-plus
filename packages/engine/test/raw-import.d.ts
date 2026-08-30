// This package has no `@types/node` dependency (see e.g.
// `../src/types/position-mapper.test.ts`), so fixture source files are
// loaded as raw text via Vite's `?raw` import suffix rather than
// `node:fs` — see `discovery/python-region-fixtures.test.ts` for where
// that's actually used. TypeScript doesn't know what a `?raw`-suffixed
// import resolves to on its own; this tells it "a string, always."
declare module '*.py?raw' {
  const content: string;
  export default content;
}

// The block-splitter fixtures are plain `.txt` files (not Python) —
// fixture directory `packages/engine/test/fixtures/blocks/`, input
// `.txt`, expected block JSON — same rationale as the `.py?raw`
// declaration above, just a different source extension.
declare module '*.txt?raw' {
  const content: string;
  export default content;
}

// The JavaScript/TypeScript/TSX fixtures — same rationale as the
// `.py?raw` declaration above, one declaration per source extension.
declare module '*.js?raw' {
  const content: string;
  export default content;
}
declare module '*.jsx?raw' {
  const content: string;
  export default content;
}
declare module '*.ts?raw' {
  const content: string;
  export default content;
}
declare module '*.tsx?raw' {
  const content: string;
  export default content;
}

// The C++ fixtures — same rationale as the `.py?raw` declaration above.
declare module '*.cpp?raw' {
  const content: string;
  export default content;
}

// The Java fixtures — same rationale as the `.py?raw` declaration above.
declare module '*.java?raw' {
  const content: string;
  export default content;
}

// `import.meta.glob` (used by `test/wrap/idempotency-all-fixtures.test.ts`
// to pick up every gold fixture in a language's directory without a
// hand-maintained list of named imports) isn't typed without pulling in
// the full `vite/client` ambient types — which this package deliberately
// doesn't depend on, matching the "no @types/node either" minimalism
// `position-mapper.test.ts` already established. This narrows the
// declaration to exactly the one call shape this package actually uses:
// `{ eager: true, query: '?raw', import: 'default' }`, which resolves
// every match to its raw text content synchronously.
interface ImportMeta {
  glob(
    pattern: string,
    options: { eager: true; query: '?raw'; import: 'default' },
  ): Record<string, string>;
}
