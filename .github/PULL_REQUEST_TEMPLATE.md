## Summary

<!-- What does this change, and why? -->

## Checklist

- [ ] If this touches a language adapter: confirms **zero changes** under
      `packages/engine/src/core` — or explains why an engine change was
      unavoidable, documented per `docs/adapters.md`'s known-leaks
      convention (not silently folded into the adapter change).
- [ ] New/changed language descriptor passes `runAdapterConformance`.
- [ ] Any deviation from the implementation plan is called out in the
      commit message or a `docs/` entry.
- [ ] Gold fixtures added/updated for the affected adapter, and
      idempotency holds (`wrap(wrap(x)) === wrap(x)`).
- [ ] `npm ci && npm test && npm run lint && npm run typecheck && npm run build`
      passes locally.
- [ ] If this touches string-literal wrapping: eval-equivalence still
      holds (a string's runtime value is unchanged by wrapping).
- [ ] `SECURITY.md` checklist items are only checked/added if backed by a
      cited test or CI reference, not asserted from reasoning alone.
