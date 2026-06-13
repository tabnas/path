# Agent guide: @jsonic/path

Guidance for AI agents and contributors working in this repository. Read this
before changing code. Per-language notes live in [`ts/AGENTS.md`](ts/AGENTS.md)
and [`go/AGENTS.md`](go/AGENTS.md).

## What this is

A plugin for the [Jsonic](https://github.com/jsonicjs/jsonic) parser that tracks
the property path (the sequence of map keys and array indices) leading to each
value as it is parsed. Rule actions added by other plugins can then read that
path. The plugin populates `Rule.k.path` (TypeScript) / `Rule.K["path"]` (Go) and
does nothing else.

Two implementations are kept in lock-step:

| Path     | Implementation                          |
| -------- | --------------------------------------- |
| `ts/`    | TypeScript / JavaScript. **Canonical.** |
| `go/`    | Go port. Mirrors the TS behaviour.      |

## Ground rules

1. **TypeScript is canonical.** When behaviour must change, change `ts/` first,
   then bring `go/` to parity. The Go port may differ in mechanics (it allocates
   a fresh path slice per level instead of pooling, and it tags its alts with
   the `path` group) but the *observable* path values must match the TS output
   for the same input.
2. **The only production dependency is the Jsonic parser itself.** TS declares it
   as a peer dependency (`jsonic`); Go requires `github.com/jsonicjs/jsonic/go`.
   Do not add other runtime dependencies. Test grammars must be defined locally
   (see the local arithmetic grammar in the `expr` / `TestLocalGrammar` tests).
3. **Build and test against the Jsonic GitHub `main` branch.** Download it over
   HTTPS into a scratch work folder rather than relying on a published release:
   - Go: `go get github.com/jsonicjs/jsonic/go@main`
   - TS: fetch `https://github.com/jsonicjs/jsonic/archive/refs/heads/main.tar.gz`,
     unpack it, and `npm install --no-save <unpacked-dir>` into `ts/`.
   Keep scratch work in an ignored `work/` folder; never commit it.
4. **The grammar has a single source of truth.** `ts/path-grammar.jsonic` is
   embedded into both `ts/src/path.ts` and `go/path.go` between the
   `BEGIN/END EMBEDDED path-grammar.jsonic` markers. Never hand-edit the embedded
   regions — edit the `.jsonic` file and run `npm run embed` (from `ts/`).
5. **Keep the two READMEs and the AGENTS guides in sync** when the plugin's API
   or behaviour changes.

## Build and test

From `ts/` (the Makefile drives both languages):

```sh
make build      # build TS, embed grammar, build Go
make test       # run TS and Go tests
make embed      # regenerate embedded grammar in src/path.ts and ../go/path.go
```

Directly:

```sh
# TypeScript
cd ts && npm install && npm run build && npm test

# Go
cd go && go build ./... && go test ./...
```

## Debugging

Use the Jsonic `Debug` facility rather than scattering print statements:

- Go: `j.Use(jsonic.Debug, map[string]any{"trace": true})` logs every lex token
  and rule transition; `jsonic.Describe(j)` dumps the configured tokens, rules,
  matchers, and plugins. This is the fastest way to see how `path` is wired and
  what the lexer produced for a non-JSON value.
- TS: the `jsonic` `Debug` plugin offers the equivalent tracing.

## Layout

| Path                        | Purpose                                            |
| --------------------------- | -------------------------------------------------- |
| `ts/src/path.ts`            | Plugin source (canonical). Embeds the grammar.     |
| `ts/path-grammar.jsonic`    | Grammar single source of truth.                    |
| `ts/embed-grammar.js`       | Embeds the grammar into both implementations.      |
| `ts/test/path.test.ts`      | TS test suite, incl. the local non-JSON grammar.   |
| `go/path.go`                | Go port. Embedded grammar region is generated.     |
| `go/path_test.go`           | Go test suite, kept at parity with the TS tests.   |
| `ts/Makefile`               | Cross-language build/test/embed/publish targets.   |
