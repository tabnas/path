# Reference (Go)

Precise description of the `tabnaspath` public surface. For an introduction
see the [tutorial](./tutorial.md); for task recipes see the
[guides](./guide.md); for the rationale see [concepts](./concepts.md).


## Package

```go
import tabnaspath "github.com/tabnas/path/go"
```

- Module path: `github.com/tabnas/path/go`
- Package name: `tabnaspath`
- Depends on: `github.com/tabnas/parser/go`


## Exported identifiers

### `func Path(j *tabnas.Tabnas, opts map[string]any) error`

The Tabnas plugin function. Register it with `j.Use(Path, nil)` **after**
the grammar that defines the hooked rules.

```go
j := tabnas.Make()
installGrammar(j)
_ = j.Use(tabnaspath.Path, nil)
```

`opts` is accepted for signature compatibility but is unused. `Path` returns
the error (if any) from declaring its rules on the grammar.

### `type PathOptions struct{}`

An empty struct. Reserved for future options; the plugin accepts none today.

### `const Version`

```go
const Version = "0.2.0"
```

The package version string.


## Hooked rules

`Path` attaches to the host grammar's rules by these names:

```
val   map   pair   list   elem
```

Each is declared with an empty `GrammarRuleSpec` so `j.Grammar()` auto-wires
the matching `@<rulename>-<phase>` function refs as state actions, without
otherwise altering the host grammar's rules. If your host grammar does not
define these rule names, the corresponding hooks never fire.


## Function refs

The plugin registers these refs against the grammar. The suffix encodes the
phase: `-bo` = before open, `-ao` = after open. Each is wired as a
`tabnas.StateAction`.

| Ref        | Fires               | Effect                                                          |
| ---------- | ------------------- | -------------------------------------------------------------- |
| `@val-bo`  | before `val` opens  | At the root (`r.D == 0`), initialise `r.K["path"]` (empty, or from the meta base). |
| `@map-bo`  | before `map` opens  | Delete `r.K["index"]` (map children are keyed by name, not index). |
| `@list-bo` | before `list` opens | Set `r.K["index"] = -1` (no element seen yet).                 |
| `@pair-ao` | after `pair` opens  | Set the child's `path` to the parent path plus the pair key.   |
| `@elem-ao` | after `elem` opens  | Increment `index`; set the child's `path` to the parent path plus that index. |


## Values written to `Rule.K`

`Rule.K` is the per-rule key bag (`map[string]any`), inherited by child
rules. After the plugin's hooks run, these entries are present:

| Key     | Where                       | Type             | Meaning                                                        |
| ------- | --------------------------- | ---------------- | ------------------------------------------------------------- |
| `path`  | every rule at `r.D > 0`     | `[]any`          | Property path from the root to this value.                    |
| `key`   | `pair` / `elem` child       | `string` or `int`| The last path segment (property name or array index).         |
| `index` | `list` / `elem`             | `int`            | Current element index inside a list (`-1` before first elem). |

At the root (`r.D == 0`), `path` is `[]any{}` unless a base is supplied
through meta (see below).

Path segments are stored as `any`:

- map keys are `string`,
- array indices are `int`.

```go
path, _ := r.K["path"].([]any)
for _, seg := range path {
    switch s := seg.(type) {
    case string: // map key
        _ = s
    case int:    // array index
        _ = s
    }
}
```

### Helper

```go
func toPathSlice(v any) []any
```

Returns `v` as `[]any` if it is one, otherwise an empty `[]any{}`. Used
internally and convenient for reading `r.K["path"]` defensively.


## Meta input

Seed the root path by passing a `base` slice through `ParseMeta`:

```go
j.ParseMeta(src, map[string]any{
    "path": map[string]any{
        "base": []any{"x", "y"},
    },
})
```

- `meta["path"]["base"]` (`[]any`) — the root path. The slice is
  shallow-copied, so the caller's slice is not mutated.

If the entry is absent or not a `[]any`, the root path is `[]any{}`.


## No CLI

`tabnaspath` is a library package only. It ships no command-line interface
and no `main` package.
