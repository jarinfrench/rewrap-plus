# markdown fixtures

Placeholder, scaffolded by `npm run new-adapter`. Populate this
directory with gold-file fixtures (`.in`/`.out` pairs, or whatever
directory-walking shape this project's existing fixture-driven tests
use -- see `packages/engine/test/fixtures/python/` for the established
convention) once this adapter grows past what
`test/conformance/markdown-conformance.test.ts`'s inline
`sources` alone can cover. Not required for the conformance suite
itself, which is deliberately fixture-file-free (see that test's own
comments).
