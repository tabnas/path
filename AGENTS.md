# Agents Guide — path

## What this project is

`@tabnas/path` is a **behaviour plugin** (not a grammar plugin) for the
[`tabnas`](https://github.com/tabnas/parser) parsing engine. It tracks the
**property path** — the sequence of map keys and array indices — leading
to each value as it is parsed, and stashes it on the parser's per-rule
key-value store (`Rule.k.path` in TS, `Rule.K["path"]` in Go). Other
plugins' rule actions can then read that path. The plugin populates
`path` / `key` / `index` and does **nothing else** — it adds no
alternates and changes nothing about *what* the host grammar parses.

The engine is a **bare parsing engine — it ships no grammar**. `Path` adds
behaviour to whatever grammar the consumer installs by hooking the
conventional rule names `val` / `map` / `pair` / `list` / `elem`. It does
this by declaring those rule names with empty specs and attaching
state-action refs (`@<rule>-<phase>`), so the engine auto-wires the refs
without altering the existing rules. **Install the grammar first, then
`Path`**, so those rules exist when the plugin wires its refs onto them
(`new Tabnas().use(Grammar).use(Path)` / `j.Use(Path, nil)` after the
grammar).

There are two implementations that must behave identically — TypeScript
(canonical) and a Go port.

## Repository map

| Path | What it is |
|---|---|
| [`ts/`](ts/) | **Canonical** TypeScript implementation — the `@tabnas/path` package (v2.1.0). Plugin in `src/path.ts`. Depends on `@tabnas/parser`. |
| [`go/`](go/) | Go port — `github.com/tabnas/path/go` (`const Version` `0.2.0`). Plugin in `path.go`. Depends on `github.com/tabnas/parser/go`. |
| [`ts/test/path.test.ts`](ts/test/path.test.ts) | TS suite + the local grammar fixture (`Grammar`) and a `capture` plugin that annotates nodes with their path. |
| [`ts/test/doc-examples.test.ts`](ts/test/doc-examples.test.ts) | Extracts fenced `js` blocks with `// =>` assertions from the READMEs/docs and runs them. |
| [`go/path_test.go`](go/path_test.go) | Go suite + the local grammar fixture (`installGrammar`), mirroring the TS one. |
| [`go/stress_test.go`](go/stress_test.go) | No-panic / deep-nesting tests and `FuzzPathPlugin` — the plugin must never panic on malformed input. |
| [`ts/AGENTS.md`](ts/AGENTS.md), [`go/AGENTS.md`](go/AGENTS.md) | Per-language scoped notes. |

There is **no shared `.tsv` fixture directory and no CLI bin** here: each
runtime brings its own small grammar fixture in-process, and the parity
contract is the set of mirrored unit tests (see below).

## The tabnas engine dependency

Both runtimes depend on the unpublished `@tabnas` siblings via a
**sibling checkout** (the standard tabnas dev model until the packages
publish tagged releases):

- TypeScript: `@tabnas/parser` is a `peerDependency` (`">=2"`) in
  `ts/package.json` and mirrored as a `file:../../parser/ts` devDependency
  for local builds (npm >=7 / Node >=24 auto-installs peers;
  `engines.node` is `">=24"`). It is the plugin's **only production
  dependency**. `@tabnas/debug` and `@tabnas/railroad` are **dev-only**
  `file:` devDependencies — but note this repo has no grammar diagram, so
  railroad is effectively unused here and debug is only for ad-hoc manual
  debugging (see below); neither is exercised by the test suite.
- Go: `go/go.mod` requires `github.com/tabnas/parser/go` at a pinned
  pseudo-version. There is **no `replace` directive checked in**; local
  builds and CI resolve the sibling via a `go.work` workspace (the
  module's package name is `tabnas`, main type `Tabnas`). That is the
  module's only tabnas dependency. Do **not** depend on the legacy
  `@tabnas/jsonic` / `github.com/tabnas/jsonic/go` shim, and do not add
  any other runtime dependency.

Clone `https://github.com/tabnas/parser` as a sibling of this repo and
build its TS (`cd parser/ts && npm install && npm run build`) before
working here. CI (`.github/workflows/build.yml`) checks the siblings out
and builds them first.

## Authority and alignment rules

**TypeScript is canonical. Go is a port of it.** When behaviour must
change:

1. Change `ts/src/path.ts` first.
2. Port the same change to `go/path.go`.
3. Mirror the unit cases across `ts/test/path.test.ts` and
   `go/path_test.go` — the two suites are the parity contract and should
   cover the same ground. Both define a deliberately-minimal local grammar
   (bare-key brace maps and bracket lists) that declares the hooked rules
   and depends on nothing but the Tabnas parser. Keep `Grammar`
   (`ts/test/path.test.ts`) and `installGrammar` (`go/path_test.go`) in
   sync.
4. Run both suites and confirm green.

The Go port may differ in **mechanics** but not in **observable** path
values for the same input (see the next section).

## Path-array allocation: TS pools, Go allocates fresh

This is the one genuinely non-obvious, intentional difference between the
runtimes:

- **TypeScript pools and mutates in place.** `path.ts` keeps a
  preallocated `pathPool` of reusable arrays keyed by depth
  (`MAX_PATH_DEPTH = 64`) and rewrites them as the parser descends.
  `r.k.path` is therefore a **shared, mutable array** — two values at the
  same depth see the *same* live array instance. Client code that needs to
  retain a path beyond the current callback **must copy it** (`r.k.path.slice()`).
  The `path-is-mutable` test asserts both the snapshot values and that two
  depth-1 siblings share one live instance — keep that contract.
- **Go allocates a fresh `[]any` per level** (`make` + `copy` in the
  `@pair-ao` / `@elem-ao` refs), so Go callers do **not** have to copy
  before retaining. There is no pool and no depth limit, so deep nesting
  is bounded only by memory (`stress_test.go` exercises depth 1000).

Path **segments** are `any`: map keys are strings, array indices are
numbers (deliberately `int` in Go, not `float64`, so a type switch
round-trips cleanly). The observable path values — e.g. `["a","b"]` for
`{a:{b:1}}`, `[0,1]` for `[x,y]` — must match across runtimes.

## The plugin contract

- It writes only `r.k.path` / `r.k.key` / `r.k.index` (TS) and the
  equivalent `Rule.K` entries (Go). **Reading** the path is the job of a
  separate rule action — the tests' `capture` / `addPathCapture` plugins
  show the pattern (annotate maps with `$`, render scalars as
  `<value:path>`).
- The path only starts below the top-level implicit (`r.d > 0` guards),
  so the root value gets an empty path. A caller can seed a base path via
  parse meta: `parse(src, { path: { base: ['x','y'] } })` (TS) /
  `j.ParseMeta(src, map[string]any{"path": map[string]any{"base": []any{"x","y"}}})`
  (Go). The `meta` / `TestMetaBasePath` tests cover this.
- The plugin contributes only `bo`/`ao` state-action hooks, never
  alternates, so it never changes what the host grammar accepts.

## Debugging

Use the Tabnas debug facility rather than scattering print statements —
both options are **dev-only**; never add them to the plugin's runtime
dependencies.

- **Dedicated `@tabnas/debug` package** (richer output): TS `@tabnas/debug`
  / Go `github.com/tabnas/debug/go` (`debug.Debug` trace plugin,
  `debug.Describe(j)`). Use it from a scratch module/script that installs
  your grammar and `Path` so `Describe` shows how `Path` is wired and a
  traced parse shows the lex/rule steps. In Go, pull it in via a scratch
  module with a `replace` at a local checkout.
- **Bundled fallback, Go only** (zero extra dependency): the Go parser
  ships `tabnas.Debug` and `tabnas.Describe(j)` in the `tabnas` package
  (`parser/go/debug.go`) for a quick trace without another module. The TS
  parser bundles no such facility — the TS Debug plugin lives only in the
  separate `@tabnas/debug` repo — so on the TS side use the dedicated
  package above.

## Build & test

The repo-root [`Makefile`](Makefile) (adapted from voxgig/util) wraps both
halves: `make build|test|clean` run the TS and Go sides,
`make publish-ts` publishes the TS package at its `package.json` version,
and `make publish-go V=x.y.z` injects `V` into the `const Version` in
`go/path.go`, commits, and tags `go/vX.Y.Z` (`make tags-go` lists those
tags; `make reset` does a clean rebuild + test of both). There is also a
thin `ts/Makefile` with the same targets driven from `ts/`.

TypeScript (from `ts/`):

```bash
npm install            # devDeps; auto-installs the @tabnas/parser peer, resolves file: siblings
npm run build          # tsc --build src test
npm test               # node --test over dist-test/*.test.js
```

Go (from `go/`):

```bash
go build ./...
go test ./...          # plugin tests + the local grammar fixture + stress/fuzz
go vet ./...
```

## CI

`.github/workflows/build.yml` has two jobs, neither publishing to npm:

- **build** (Ubuntu/Windows/macOS, Node 24): sets
  `git config --global core.autocrlf false` (the "Use LF line endings"
  step), git-clones the tabnas closure (`parser debug json abnf railroad`)
  as siblings, `npm i && npm run build --if-present` over
  `parser debug json path abnf railroad` in topo order, then `npm test`
  in `path/ts`.
- **build-go** (Ubuntu/macOS, Go 1.24): clones the same siblings, then
  mirrors `admin/scripts/link.sh` — creates `vendor/` symlinks for any
  `../vendor/` replaces and runs `go work init` + `go work use` over every
  non-vendor-replaced module — before `go build ./...` and `go test -v ./...`
  in `path/go`.
