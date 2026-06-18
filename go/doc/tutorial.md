# Tutorial: tracking the path to a value (Go)

This tutorial takes you from nothing to a working parser that knows the
property path of every value it parses. It is a single happy path — follow
the steps in order.

This is the Go port of `@tabnas/path`. The TypeScript version is canonical;
this package tracks it. By the end you will have a parser that, given
`{a:1}`, can report that the value `1` lives at path `a`.


## What the package does

`tabnaspath` is a plugin for the [Tabnas](https://github.com/tabnas/parser)
parser. As the parser walks an input it descends into maps and lists. The
plugin records, for every value, the chain of keys and indices that leads to
it from the root. That chain is the *path*.

The plugin does not print or return the path on its own. It writes the path
into the parser's per-rule key bag, `r.K["path"]`, where your own rule
actions can read it.


## Step 1 — Install

```sh
go get github.com/tabnas/path/go
```

Import it with the package name `tabnaspath`:

```go
import (
    tabnas "github.com/tabnas/parser/go"
    tabnaspath "github.com/tabnas/path/go"
)
```


## Step 2 — Build a parser

The Tabnas engine ships no grammar of its own, so you bring one that defines
the `val` / `map` / `pair` / `list` / `elem` rules. Install the grammar
first, then the plugin on top — `Path` wires its hooks onto the grammar's
rules, so the rules must already exist when it runs.

A complete, minimal grammar fixture (`installGrammar`) lives in
`go/path_test.go`; it defines exactly those five rules over brace maps,
bracket lists, and scalar values.

```go
j := tabnas.Make()
installGrammar(j)            // your grammar: defines val/map/pair/list/elem
_ = j.Use(tabnaspath.Path, nil) // install Path after the grammar

result, _ := j.Parse("{a:{b:1,c:[2,3]}}")
// result == map[string]any{
//   "a": map[string]any{
//     "b": float64(1),
//     "c": []any{float64(2), float64(3)},
//   },
// }
```

So far the result is identical to parsing without the plugin. `Path` only
*records* the path; it does not change the parsed value. To see the path,
you read it.


## Step 3 — Read the path

The path lives in `r.K["path"]` during the parse, as a `[]any` of `string`
keys and `int` indices. Add a `val` rule action that reads it and tags each
value. Scalars become `<value:path>`; maps get a `$` entry holding
`<path>`; array elements are tagged individually as scalars.

```go
import (
    "fmt"
    "strings"

    tabnas "github.com/tabnas/parser/go"
    tabnaspath "github.com/tabnas/path/go"
)

func fmtPath(path []any) string {
    parts := make([]string, len(path))
    for i, p := range path {
        parts[i] = fmt.Sprintf("%v", p)
    }
    return "<" + strings.Join(parts, ",") + ">"
}

func main() {
    j := tabnas.Make()
    installGrammar(j)
    _ = j.Use(tabnaspath.Path, nil)

    j.Rule("val", func(rs *tabnas.RuleSpec, _ *tabnas.Parser) {
        rs.AddAC(func(r *tabnas.Rule, ctx *tabnas.Context) {
            path, _ := r.K["path"].([]any)
            switch node := r.Node.(type) {
            case map[string]any:
                node["$"] = fmtPath(path)
            case []any:
                // elements are annotated individually; leave as-is
            default:
                r.Node = "<" + fmt.Sprintf("%v", r.Node) + ":" +
                    strings.TrimPrefix(strings.TrimSuffix(fmtPath(path), ">"), "<") + ">"
            }
        })
    })

    result, _ := j.Parse("{a:1}")
    m := result.(map[string]any)
    // m["$"] == "<>"      (root path is empty)
    // m["a"] == "<1:a>"   (value 1 is at key a)
    _ = m
}
```

Read the tags:

- `<>` — the root map's path is empty.
- `<1:a>` — the value `1` is reached by key `a`.


## Step 4 — Go deeper

Nesting works the same way at any depth. With the same `val` annotator,
parsing `{x:{a:1}}` yields:

```go
result, _ := j.Parse("{x:{a:1}}")
m := result.(map[string]any)
// m["$"]               == "<>"
x := m["x"].(map[string]any)
// x["$"]               == "<x>"
// x["a"]               == "<1:x,a>"
_ = m
```

- the root map has path `<>`,
- the nested map at `x` has path `<x>`,
- the value `1` is at `x, a`.

Arrays add numeric index segments. Parsing `[1,2,3]` with the same annotator
yields `["<1:0>", "<2:1>", "<3:2>"]`: each element carries its index.


## What you learned

- `Path` records the path of every value into `r.K["path"]` (a `[]any`).
- The root path is empty (`[]any{}`, formatted here as `<>`).
- Map keys add a `string` segment; array elements add an `int` index.
- You read the path in your own rule action — the plugin never returns it.

Next:

- [How-to guides](./guide.md) — focused recipes for common tasks.
- [Reference](./reference.md) — the exact API surface.
- [Concepts](./concepts.md) — how and why it works, including the
  differences from the TypeScript version.
