# Agent guide: @tabnas/path

Guidance for AI agents and contributors working in this repository. Read this
before changing code. Per-language notes live in [`ts/AGENTS.md`](ts/AGENTS.md)
and [`go/AGENTS.md`](go/AGENTS.md).

## What this is

A plugin for the [Tabnas](https://github.com/tabnas/parser) parser that tracks
the property path (the sequence of map keys and array indices) leading to each
value as it is parsed. Rule actions added by other plugins can then read that
path. The plugin populates `Rule.k.path` (TypeScript) / `Rule.K["path"]` (Go) and
does nothing else.

The Tabnas engine is a **bare parsing engine — it ships no grammar**. `Path` adds
behaviour to whatever grammar the consumer installs, by hooking the conventional
rule names `val` / `map` / `pair` / `list` / `elem`. Install the grammar first,
then `Path`, so those rules exist when the plugin wires its refs onto them.

Two implementations are kept in lock-step:

| Path     | Implementation                          |
| -------- | --------------------------------------- |
| `ts/`    | TypeScript / JavaScript. **Canonical.** |
| `go/`    | Go port. Mirrors the TS behaviour.      |

## Ground rules

1. **TypeScript is canonical.** When behaviour must change, change `ts/` first,
   then bring `go/` to parity. The Go port may differ in mechanics (it allocates
   a fresh path slice per level instead of pooling) but the *observable* path
   values must match the TS output for the same input.
2. **The only production dependency is the Tabnas parser itself.** TS declares it
   as a peer dependency (`tabnas`); Go requires `github.com/tabnas/parser/go`
   (Go package name `tabnas`, main type `Tabnas`). Do not depend on the legacy
   `jsonic` / `jsonicjs` packages, and do not add any other runtime dependency.
3. **Tests bring their own grammar.** Because the engine ships no grammar, each
   test suite defines a small, local grammar (bare-key brace maps and bracket
   lists — see `installGrammar` in `go/path_test.go` and `Grammar` in
   `ts/test/path.test.ts`) that declares the hooked rules. That fixture depends
   on nothing but the Tabnas parser.
4. **Build and test against the Tabnas GitHub `main` branch.** Download it over
   HTTPS into a scratch work folder rather than relying on a published release:
   - Go: `go get github.com/tabnas/parser/go@main`
   - TS: fetch `https://github.com/tabnas/parser/archive/refs/heads/main.tar.gz`,
     unpack it, build it (`cd ts && npm install && npm run build`), then
     `npm install --no-save <unpacked>/ts` into this repo's `ts/`.
   Keep scratch work in an ignored `work/` folder; never commit it.
5. **Keep the two READMEs and the AGENTS guides in sync** when the plugin's API
   or behaviour changes.

## Build and test

From `ts/` (the Makefile drives both languages):

```sh
make build      # build TS, build Go
make test       # run TS and Go tests
```

Directly:

```sh
# TypeScript
cd ts && npm install && npm run build && npm test

# Go
cd go && go build ./... && go test ./...
```

## Debugging

Use the Tabnas debug facility rather than scattering print statements. There are
two options; both are dev-only — never add them to the plugin's dependencies.

- **Dedicated `tabnas/debug` package** (richer output, recommended for
  development): Go `github.com/tabnas/debug/go` (`debug.Debug` trace plugin,
  `debug.Describe(j) (string, error)`), TS `@tabnas/debug`. Use it from a scratch
  module/script that also installs your grammar and `Path`, so `Describe` shows
  how `Path` is wired and a traced parse shows the lex/rule steps.
- **Bundled fallback** (zero extra dependency): the parser still ships
  `tabnas.Debug` and `tabnas.Describe(j) string` in the `tabnas` package — handy
  for a quick trace without pulling in another module.

Note: as of the latest parser main the TS `@tabnas/debug` package does not build
cleanly against it (an upstream type issue), so for TS debugging prefer the
bundled `tabnas.Debug` until that is fixed.

## Layout

| Path                        | Purpose                                            |
| --------------------------- | -------------------------------------------------- |
| `ts/src/path.ts`            | Plugin source (canonical).                         |
| `ts/test/path.test.ts`      | TS test suite, incl. the local grammar fixture.    |
| `go/path.go`                | Go port.                                           |
| `go/path_test.go`           | Go test suite, incl. the local grammar fixture.    |
| `ts/Makefile`               | Cross-language build/test/publish targets.         |
