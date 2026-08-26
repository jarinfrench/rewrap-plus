# Third-party notices

Rewrap+ itself is MIT-licensed (see [LICENSE](./LICENSE)). This file
covers the third-party code the packaged VSCode extension actually
bundles or vendors — not every devDependency in `package-lock.json`
(build/test tooling like `vitest`, `eslint`, `esbuild`, `@vscode/vsce`,
etc. never ships in the `.vsix`, so it isn't covered here).

Every component below is **MIT-licensed**, the same license as this
project — no license-compatibility conflict, and no reason to reconsider
the MIT-vs-Apache-2.0 choice made for this project. All of them happen
to share an author (Max Brunsfeld, the tree-sitter project's creator),
which is incidental to the license analysis, not load-bearing for it.

## `web-tree-sitter`

- **What it is / where it's used:** the WASM runtime that loads and runs
  every tree-sitter grammar this project uses. Bundled into
  `dist/extension.js` via a runtime-loaded copy in
  `dist/web-tree-sitter-runtime/` (see
  `packages/vscode-extension/src/web-tree-sitter-runtime.ts` for why a
  runtime-computed path is used instead of a normal bundled import).
- **Version:** see `packages/engine/package.json`'s `web-tree-sitter`
  dependency for the pinned version at any given point.
- **License:** MIT.
- **Source:** <https://github.com/tree-sitter/tree-sitter> (the
  `lib/binding_web` package, published to npm as `web-tree-sitter`).

```
The MIT License (MIT)

Copyright (c) 2018 Max Brunsfeld

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## `tree-sitter-python` (grammar)

- **What it is / where it's used:** the Python grammar, compiled to
  `packages/engine/grammars/tree-sitter-python.wasm` and copied into the
  packaged extension's `grammars/` directory at build time. Full
  provenance (exact version, upstream commit, checksums) is in
  `packages/engine/grammars/PROVENANCE.md`.
- **License:** MIT.
- **Source:** <https://github.com/tree-sitter/tree-sitter-python>.

```
MIT License

Copyright (c) 2016 Max Brunsfeld

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## `tree-sitter-javascript` (grammar)

- **What it is / where it's used:** the JavaScript grammar, compiled to
  `packages/engine/grammars/tree-sitter-javascript.wasm` and copied into
  the packaged extension's `grammars/` directory at build time, same as
  the Python grammar above. Backs the `javascript`/`javascriptreact`
  language adapter (`packages/engine/src/languages/javascript/`), a
  user-facing language. Full provenance is in
  `packages/engine/grammars/PROVENANCE.md`.
- **License:** MIT.
- **Source:** <https://github.com/tree-sitter/tree-sitter-javascript>.

```
MIT License

Copyright (c) 2014 Max Brunsfeld

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## `tree-sitter-typescript` (grammar)

- **What it is / where it's used:** the TypeScript and TSX grammars
  (one npm package, two prebuilt `.wasm` files), compiled to
  `packages/engine/grammars/tree-sitter-typescript.wasm` and
  `packages/engine/grammars/tree-sitter-tsx.wasm` and copied into the
  packaged extension's `grammars/` directory at build time. Back the
  `typescript` and `typescriptreact` language adapters
  (`packages/engine/src/languages/typescript/`). Full provenance is in
  `packages/engine/grammars/PROVENANCE.md`.
- **License:** MIT.
- **Source:** <https://github.com/tree-sitter/tree-sitter-typescript>.

```
The MIT License (MIT)

Copyright (c) 2017 Max Brunsfeld

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## `tree-sitter-cpp` (grammar)

- **What it is / where it's used:** the C++ grammar, compiled to
  `packages/engine/grammars/tree-sitter-cpp.wasm` and copied into the
  packaged extension's `grammars/` directory at build time. Backs the
  `cpp` language adapter (`packages/engine/src/languages/cpp/`). Full
  provenance is in `packages/engine/grammars/PROVENANCE.md`.
- **License:** MIT.
- **Source:** <https://github.com/tree-sitter/tree-sitter-cpp>.

```
The MIT License (MIT)

Copyright (c) 2014 Max Brunsfeld

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Keeping this file current

Whenever `packages/engine/grammars/PROVENANCE.md` gains a new grammar
entry (a new language's `.wasm`, per
[`docs/adding-a-language.md`](./docs/adding-a-language.md)) or
`web-tree-sitter`'s pinned version changes license terms, add or update
the corresponding section above in the same commit — this file should
never describe a different set of bundled components than what
`scripts/build.mjs` and `PROVENANCE.md` actually ship.
