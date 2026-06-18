# tabnas/path (Go port)

Go port of the [@tabnas/path](https://github.com/tabnas/path) Tabnas parser
plugin. It adds property-path tracking to the
[Tabnas](https://github.com/tabnas/parser) parser so that rule actions can
see the path (keys and indices) leading to the current value.

The TypeScript version is canonical; this package tracks it.

- Module path: `github.com/tabnas/path/go`
- Package name: `tabnaspath`


## Install

```sh
go get github.com/tabnas/path/go
```

The Tabnas engine ships no grammar of its own — you bring a grammar that
defines the `val` / `map` / `pair` / `list` / `elem` rules. Install the
grammar first, then `Path` on top. A minimal grammar fixture
(`installGrammar`) lives in `path_test.go`.


## Tiny example

```go
import (
    "fmt"
    "strings"

    tabnas "github.com/tabnas/parser/go"
    tabnaspath "github.com/tabnas/path/go"
)

func main() {
    j := tabnas.Make()
    installGrammar(j)               // defines val/map/pair/list/elem
    _ = j.Use(tabnaspath.Path, nil) // install Path after the grammar

    j.Rule("val", func(rs *tabnas.RuleSpec, _ *tabnas.Parser) {
        rs.AddAC(func(r *tabnas.Rule, ctx *tabnas.Context) {
            path, _ := r.K["path"].([]any)
            parts := make([]string, len(path))
            for i, p := range path {
                parts[i] = fmt.Sprintf("%v", p)
            }
            if m, ok := r.Node.(map[string]any); ok {
                m["$"] = "<" + strings.Join(parts, ",") + ">"
            }
        })
    })

    result, _ := j.Parse("{x:{a:1}}")
    m := result.(map[string]any)
    // m["$"]            == "<>"   (root path is empty)
    x := m["x"].(map[string]any)
    // x["$"]            == "<x>"  (nested map at key x)
    _, _ = m, x
}
```


## Documentation

The docs follow the [Diátaxis](https://diataxis.fr) four-quadrant structure:

- [Tutorial](doc/tutorial.md) — zero to a working path-tracking parser, step
  by step.
- [How-to guides](doc/guide.md) — recipes: read the path, classify segments,
  use `r.K["key"]`, seed a base path.
- [Reference](doc/reference.md) — exported identifiers, the `Rule.K` keys,
  the function refs, meta input.
- [Concepts](doc/concepts.md) — how it works, the engine relationship, and a
  "Differences from the TS version" section.

The canonical TypeScript implementation lives in [`../ts/`](../ts/) with its
own [docs](../ts/doc/tutorial.md).


## License

MIT. Copyright (c) Richard Rodger.
