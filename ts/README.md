# @tabnas/path (Tabnas parser plugin)

This plugin adds property-path tracking to the
[Tabnas](https://github.com/tabnas/parser) parser so that rule actions can
see the path (keys and indices) leading to the current value.


[![npm version](https://img.shields.io/npm/v/@tabnas/path.svg)](https://npmjs.com/package/@tabnas/path)
[![build](https://github.com/tabnas/path/actions/workflows/build.yml/badge.svg)](https://github.com/tabnas/path/actions/workflows/build.yml)


| ![Voxgig](https://www.voxgig.com/res/img/vgt01r.png) | This open source module is sponsored and supported by [Voxgig](https://www.voxgig.com). |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |


## Install

```sh
npm install @tabnas/parser @tabnas/json @tabnas/path
```

The Tabnas engine ships no grammar of its own — you bring a grammar plugin
that defines the `val` / `map` / `pair` / `list` / `elem` rules (here,
`@tabnas/json`). Install the grammar first, then `Path` on top.


## Tiny example

`Path` populates `r.k.path` for every value; a second plugin reads it. Here
each scalar is tagged `<value:path>` and each map gets a `$` of `<path>`:

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

Each scalar carries its full path: `1` lives at `a, 0` and `2` at `a, 1`.


## Documentation

The docs follow the [Diátaxis](https://diataxis.fr) four-quadrant structure:

- [Tutorial](doc/tutorial.md) — zero to a working path-tracking parser, step
  by step.
- [How-to guides](doc/guide.md) — recipes: read the path, keep a copy, seed
  a base path, classify segments.
- [Reference](doc/reference.md) — exports, options, the `Rule.k` keys, the
  function refs, meta input.
- [Concepts](doc/concepts.md) — how it works, the engine relationship, the
  array-pool / mutability trade-off.

The Go port lives in [`../go/`](../go/) with its own
[docs](../go/doc/tutorial.md).


## License

MIT. Copyright (c) Richard Rodger.
