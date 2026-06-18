# How-to guides (Go)

Focused recipes for using `tabnaspath`. Each is self-contained. For a guided
introduction start with the [tutorial](./tutorial.md); for the exact API see
the [reference](./reference.md).

All recipes assume a host grammar that defines the `val` / `map` / `pair` /
`list` / `elem` rules. A complete fixture (`installGrammar`) lives in
`go/path_test.go`; the snippets below assume it is in scope.


## Read the path inside your own rule action

`Path` runs its hooks during the open phase of each rule (`bo` / `ao`), so
the path is already populated by the time later actions run. Read
`r.K["path"]` from a close action (`AddBC`) or after-close action (`AddAC`).

```go
import (
    "fmt"

    tabnas "github.com/tabnas/parser/go"
    tabnaspath "github.com/tabnas/path/go"
)

func main() {
    j := tabnas.Make()
    installGrammar(j)
    _ = j.Use(tabnaspath.Path, nil)

    j.Rule("val", func(rs *tabnas.RuleSpec, _ *tabnas.Parser) {
        rs.AddAC(func(r *tabnas.Rule, ctx *tabnas.Context) {
            path, _ := r.K["path"].([]any)
            fmt.Printf("path = %v, value = %v\n", path, r.Node)
        })
    })

    _, _ = j.Parse("{a:1,b:[2,3]}")
    // prints, among others:
    //   path = [a], value = 1
    //   path = [b 0], value = 2
    //   path = [b 1], value = 3
}
```


## Tell a map key from an array index

Path segments are not all the same type. A map key is a `string`; an array
index is an `int`. Go has no sum type, so the slice element type is `any`;
type-switch on each segment when the distinction matters.

```go
path, _ := r.K["path"].([]any)
for _, seg := range path {
    switch s := seg.(type) {
    case string:
        // a map key
        _ = s
    case int:
        // an array index
        _ = s
    }
}
```

Indices are stored as `int` (not `float64`), so they survive a type switch
without further conversion.


## Use the last path segment directly

The plugin also sets `r.K["key"]` on each child to the final segment of its
path — the property name (`string`) for a map child, or the index (`int`)
for an array element. This saves you indexing into `r.K["path"]`.

```go
j.Rule("val", func(rs *tabnas.RuleSpec, _ *tabnas.Parser) {
    rs.AddAC(func(r *tabnas.Rule, ctx *tabnas.Context) {
        key := r.K["key"] // string for map children, int for array elements
        _ = key
    })
})
```


## Seed the path from the caller (meta base)

Parse a fragment as if it were already nested under a known path by passing
a `base` slice through Tabnas meta, using `ParseMeta`. The plugin uses it as
the root path.

```go
result, _ := j.ParseMeta("{a:1}", map[string]any{
    "path": map[string]any{
        "base": []any{"x", "y"},
    },
})
// the root map now has path []any{"x", "y"};
// the value 1 is at []any{"x", "y", "a"}
_ = result
```

The `base` slice is shallow-copied, so the caller's slice is not mutated.


## Plug it onto your own grammar

`Path` does not depend on any particular grammar — it depends on the *rule
names* `val` / `map` / `pair` / `list` / `elem`. Define those rules in your
own grammar, install it first, and `Path` will hook onto it:

```go
j := tabnas.Make()
installMyGrammar(j)              // defines val/map/pair/list/elem
_ = j.Use(tabnaspath.Path, nil)  // attach Path after the grammar
```

If your grammar omits one of the five names, the corresponding hook simply
never fires.


## Note on copying the path

Unlike the TypeScript version, the Go port allocates a fresh `[]any` for
each child's path (see [concepts](./concepts.md)). You can retain the slice
returned by `r.K["path"]` directly without copying — there is no shared
pooled array to defend against. (Copying anyway is harmless if you want to
match the TS code's habits.)
