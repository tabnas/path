# jsonic/path (Go port)

Go port of the [@jsonic/path](https://github.com/jsonicjs/path) Tabnas parser plugin. It adds property-path tracking to the [Tabnas](https://github.com/tabnas/parser) parser so that rule actions can see the path (keys and indices) leading to the current value.

Module path: `github.com/jsonicjs/path/go`

This documentation is organised in four parts:

- [Tutorial](#tutorial) — a hands-on walk-through for a first-time user.
- [How-to guides](#how-to-guides) — recipes for specific tasks.
- [Reference](#reference) — a precise description of what the package exposes.
- [Explanation](#explanation) — the ideas and design behind it.


## Tutorial

This tutorial shows you how to attach the package to a Tabnas parser and read the path of a value as it is parsed.

The Tabnas engine ships no grammar of its own — you bring a grammar that defines the `val` / `map` / `pair` / `list` / `elem` rules. `Path` attaches to those rules. Install your grammar first, then `Path` on top.

**1. Install**

```sh
go get github.com/jsonicjs/path/go
```

**2. Attach a grammar and the plugin**

```go
import (
    tabnas "github.com/tabnas/parser/go"
    path "github.com/jsonicjs/path/go"
)

j := tabnas.Make()
installGrammar(j)          // your grammar: defines val/map/pair/list/elem
_ = j.Use(path.Path, nil)  // install Path after the grammar
```

A complete, minimal grammar fixture lives in `path_test.go` (`installGrammar`).

Parsing works exactly as it would without the plugin:

```go
result, _ := j.Parse("{a:{b:1,c:[2,3]}}")
// result == map[string]any{
//   "a": map[string]any{
//     "b": float64(1),
//     "c": []any{float64(2), float64(3)},
//   },
// }
```

**3. Observe the path**

`Path` itself only populates `Rule.K["path"]`. To *see* it, register a second rule action that reads the path:

```go
j.Rule("val", func(rs *tabnas.RuleSpec, _ *tabnas.Parser) {
    rs.AC = append(rs.AC, func(r *tabnas.Rule, ctx *tabnas.Context) {
        p, _ := r.K["path"].([]any)
        switch node := r.Node.(type) {
        case map[string]any:
            node["$"] = fmt.Sprintf("<%v>", p)
        case []any:
            // elements are annotated individually
        default:
            r.Node = fmt.Sprintf("<%v:%v>", r.Node, p)
        }
    })
})

result, _ := j.Parse("{a:{b:1,c:[2,3]}}")
```

You have now seen the plugin populate the path at every level: the root is `[]any{}`, keys become `string`, array elements become `int`.


## How-to guides

### How to read the path inside your own rule action

`Path` runs its hooks first (`bo`/`ao`). Later actions can read `r.K["path"]` inside `BC`/`AC` actions:

```go
j.Rule("val", func(rs *tabnas.RuleSpec, _ *tabnas.Parser) {
    rs.AC = append(rs.AC, func(r *tabnas.Rule, ctx *tabnas.Context) {
        p, _ := r.K["path"].([]any)
        fmt.Printf("path = %v, value = %v\n", p, r.Node)
    })
})
```

### How to seed the path from the caller

Pass a base path via Tabnas meta and `Path` will use it for the root:

```go
result, _ := j.ParseMeta("{a:1}", map[string]any{
    "path": map[string]any{
        "base": []any{"x", "y"},
    },
})
// path of value 1 is []any{"x", "y", "a"}
```

The `base` slice is shallow-copied, so the caller's slice is not mutated.

### How to turn path tracking off without uninstalling the plugin

Every alt added by `Path` is tagged with group `"path"`. Excluding that group disables path tracking while leaving the plugin installed:

```go
j.SetOptions(tabnas.Options{
    Rule: &tabnas.RuleOptions{Exclude: "path"},
})
```


## Reference

```go
import path "github.com/jsonicjs/path/go"
```

### Exported identifiers

- `path.Path(j *tabnas.Tabnas, opts map[string]any) error` — plugin function. Register with `j.Use(path.Path, nil)` *after* the grammar that defines the hooked rules.
- `path.PathOptions` — empty struct reserved for future options.

### Hooked rules

`Path` attaches to the host grammar's rules by name:

```
val  map  pair  list  elem
```

Each is declared with an empty rule spec so `j.Grammar()` auto-wires the matching `@<rulename>-<phase>` refs as state actions, without otherwise altering the host grammar's rules.

### Values written to `Rule.K`

After the plugin runs, the following entries are present on the rule key bag:

| Key     | Where                  | Type      | Meaning                                                    |
| ------- | ---------------------- | --------- | ---------------------------------------------------------- |
| `path`  | every rule at `D > 0`  | `[]any`   | Property path from the root to this value.                 |
| `key`   | `pair`, `elem` child   | `string` or `int` | The last path segment (property name or array index). |
| `index` | `list`, `elem`         | `int`     | Current element index inside a list (`-1` before first elem). |

At the top level (`r.D == 0`) `path` is `[]any{}` unless a base was supplied via `ctx.Meta["path"]["base"]`.

Path segments are stored as `any`:
- Map keys are `string`.
- Array indices are `int`.

```go
p, _ := r.K["path"].([]any)
for _, seg := range p {
    switch s := seg.(type) {
    case string: // map key
    case int:    // array index
    }
}
```

### Meta input

```go
j.ParseMeta(src, map[string]any{
    "path": map[string]any{
        "base": []any{"x", "y"},
    },
})
```

- `meta["path"]["base"]` (`[]any`) — seed the root path. The slice is shallow-copied.

### Function refs

The plugin registers these refs against the grammar:

| Ref         | Fires                 | Effect                                               |
| ----------- | --------------------- | ---------------------------------------------------- |
| `@val-bo`   | before `val` opens    | Initialise `r.K["path"]` at the root (`D == 0`).     |
| `@map-bo`   | before `map` opens    | Clear `r.K["index"]` (map children key by name).     |
| `@list-bo`  | before `list` opens   | Set `r.K["index"] = -1` (no element seen yet).       |
| `@pair-ao`  | after `pair` opens    | Set child `path` = parent `path` + pair key.         |
| `@elem-ao`  | after `elem` opens    | Increment `index`; set child `path` = parent + idx.  |

### Group tag

`Path` calls `j.Grammar(..., &GrammarSetting{Rule: {Alt: {G: "path"}}})`, tagging every alt added by this plugin with group `"path"`. Callers can filter rules via `options.rule.include` / `options.rule.exclude`.


## Explanation

**Why a plugin.** A grammar does not record the path to a value because that information is unused by the default rules. Many extensions (validation, error reporting, templating) *do* need it. A plugin is the right scope: it costs nothing when not loaded, and it stays out of the core grammar.

**Why the host supplies the grammar.** Tabnas is a bare parsing engine: it ships no grammar. `Path` adds *behaviour* (path tracking) to whatever grammar you install, by hooking the conventional `val` / `map` / `pair` / `list` / `elem` rule names. Install your grammar first so those rules exist when `Path` wires its refs onto them.

**Why `Rule.K`.** Each parser rule has a key bag `K` that is *inherited by child rules*. Writing the path once into `r.K["path"]` makes it visible for the lifetime of that subtree without threading state through every action. Updating the child's `K["path"]` in `pair-ao` / `elem-ao` is enough to walk the path down one level at a time.

**Why two different updates for maps and lists.** Map children identify themselves by key, which the pair rule already captures as `r.U["key"]`. List children identify themselves by position, so the plugin maintains `r.K["index"]` on the list rule and increments it when each element opens. Clearing `index` in `map-bo` prevents a surrounding list's index from leaking into a nested map.

**Why depth guards.** Top-level implicit maps and lists can produce a rule at depth 0 that is logically the root. The plugin initialises the root path only at `D == 0` and updates children only at `D > 0`, so implicit structure does not create a phantom leading segment.

**Meta base path.** Passing `meta["path"]["base"]` lets a caller parse a fragment as if it were already nested under a known path — useful when composing parsers or when reporting errors in terms of a surrounding document.

**Why `any` for path segments.** A path mixes `string` (map keys) and `int` (array indices). Go has no sum type, so the slice element type is `any` and callers type-switch when they care about the distinction. Numeric indices are stored as `int` (not `float64`) so they survive a round trip through a type switch without further conversion.
