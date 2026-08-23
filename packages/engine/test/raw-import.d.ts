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

// Phase 4's block-splitter fixtures are plain `.txt` files (not Python),
// per the plan ("Fixture directory `packages/engine/test/fixtures/blocks/`
// — input `.txt`, expected block JSON.") — same rationale as the `.py?raw`
// declaration above, just a different source extension.
declare module '*.txt?raw' {
  const content: string;
  export default content;
}
