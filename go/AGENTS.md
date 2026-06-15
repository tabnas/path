# Agent guide: Go implementation

Scoped notes for `go/`. See the [root AGENTS.md](../AGENTS.md) for the rules that
apply across both implementations. This is a **port** of the canonical TypeScript
plugin — match its observable behaviour; do not invent new behaviour here.

## Commands

```sh
go build ./...
go test ./...
go vet ./...
```

To build and test against the Tabnas GitHub `main` branch:

```sh
go get github.com/tabnas/parser/go@main
```

The dependency is `github.com/tabnas/parser/go` (Go package name `tabnas`, main
type `Tabnas`). It is the only required dependency. Do not depend on the legacy
`github.com/tabnas/jsonic/go` shim module.

## Source notes

- `path.go` imports `tabnas "github.com/tabnas/parser/go"` and registers its refs
  via `j.Grammar(&tabnas.GrammarSpec{Ref: ..., Rule: ...})`. The engine is
  grammar-free, so the plugin only declares the rule *names* it hooks
  (`hookedRules = val/map/pair/list/elem`); it does not define those rules.
- Difference from the TS port that is intentional, not a parity bug: each
  level's path is a **freshly allocated** `[]any` (Go does not pool/share arrays
  the way TS does), so callers do not have to copy before retaining it.
- The plugin contributes only state-action hooks (`bo`/`ao`), never alternates,
  so it does not change what the host grammar parses — it only annotates `Rule.K`.
- Path segments are `any`: map keys are `string`, array indices are `int`
  (deliberately `int`, not `float64`, so a type switch round-trips cleanly).
- `const Version` is bumped by the `publish-go` Makefile target.

## Debugging

Prefer the dedicated `github.com/tabnas/debug/go` package (dev-only — do not add
it to this module's dependencies; use it from a scratch module with a `replace`
pointing at a local checkout):

```go
import debug "github.com/tabnas/debug/go"

j := tabnas.Make()
installGrammar(j)
j.Use(path.Path, nil)

report, err := debug.Describe(j)  // (string, error) — dump tokens/rules/plugins
if err != nil { panic(err) }
fmt.Println(report)

j.Use(debug.Debug, map[string]any{"trace": true}) // log lex + rule steps
j.Parse("{a:1}")
```

The parser also bundles `tabnas.Debug` and `tabnas.Describe(j) string` (returns a
plain string) as a zero-dependency fallback.

## Tests

`path_test.go` defines a small **local grammar** (`installGrammar`) — bare-key
brace maps and bracket lists — using `j.Rule(...)` with `tabnas.AltSpec` alts. It
depends only on the Tabnas parser. `newParser` installs the grammar before
`Path` so the plugin's `@<rule>-<phase>` refs wire onto rules that already exist.
Keep this fixture and the tests aligned with the canonical TS suite.
