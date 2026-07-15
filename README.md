# @tabnas/path

<!-- tabnas-badges -->
[![npm](https://tabnas.github.io/status/badges/path-npm.svg)](https://www.npmjs.com/package/@tabnas/path)
[![CI](https://github.com/tabnas/path/actions/workflows/ci.yml/badge.svg)](https://github.com/tabnas/path/actions/workflows/ci.yml)
[![go](https://tabnas.github.io/status/badges/path-go.svg)](https://pkg.go.dev/github.com/tabnas/path/go)
[![tabnas standard](https://tabnas.github.io/status/badges/path-standard.svg)](https://tabnas.github.io/status/)
<!-- /tabnas-badges -->

A [Tabnas](https://github.com/tabnas/parser) parser plugin that tracks the
**property path** to each value as it is parsed — the chain of map keys and
array indices leading from the root to that value.

The plugin records the path into the parser's per-rule key bag, where your
own rule actions can read it. It computes nothing visible on its own; you
read the path and use it.

This repository contains:

| Path             | Description                          |
| ---------------- | ------------------------------------ |
| [`ts/`](ts/)     | TypeScript / JavaScript implementation (canonical). |
| [`go/`](go/)     | Go port (`tabnaspath`), tracking the TS version.    |


## Tiny example

```js
const { Tabnas } = require('@tabnas/parser')
const { json } = require('@tabnas/json')
const { Path } = require('@tabnas/path')

const capture = (tn) => {
  tn.rule('val', (rs) =>
    rs.ac(false, (r) => {
      if (null === r.node || 'object' !== typeof r.node) {
        r.node = `<${r.node}:${r.k.path}>`
      } else if (!Array.isArray(r.node)) {
        r.node.$ = `<${r.k.path}>`
      }
    }),
  )
}

const parser = new Tabnas({ plugins: [json] }).use(Path).use(capture)
const out = parser.parse('{"a":[1,2]}')

out.a     // => ['<1:a,0>', '<2:a,1>']
out.a[0]  // => '<1:a,0>'
```

Value `1` lives at path `a, 0` (key `a`, then index `0`).


## Documentation

The docs follow the [Diátaxis](https://diataxis.fr) four-quadrant structure.

**TypeScript / JavaScript** ([`ts/`](ts/)):

- [Tutorial](ts/doc/tutorial.md) — zero to a working path-tracking parser.
- [How-to guides](ts/doc/guide.md) — recipes for common tasks.
- [Reference](ts/doc/reference.md) — the exact API surface.
- [Concepts](ts/doc/concepts.md) — how it works and why.

**Go** ([`go/`](go/)):

- [Tutorial](go/doc/tutorial.md)
- [How-to guides](go/doc/guide.md)
- [Reference](go/doc/reference.md)
- [Concepts](go/doc/concepts.md) — including differences from the TS version.


## License

MIT. Copyright (c) Richard Rodger.
