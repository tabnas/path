# How-to guides

Focused recipes for using `@tabnas/path`. Each is self-contained. For a
guided introduction start with the [tutorial](./tutorial.md); for the exact
API see the [reference](./reference.md).

All recipes assume a host grammar that defines the `val` / `map` / `pair` /
`list` / `elem` rules. The examples use `@tabnas/json` as that host, but any
compatible grammar works.


## Read the path inside your own rule action

`Path` runs its hooks during the open phase of each rule (`bo` / `ao`), so
the path is already populated by the time later actions run. Read
`r.k.path` from a close action (`bc` / `ac`) or from an alt action.

```js
const { Tabnas } = require('@tabnas/parser')
const { json } = require('@tabnas/json')
const { Path } = require('@tabnas/path')

const seen = []
const collect = (tn) => {
  tn.rule('val', (rs) =>
    rs.ac(false, (r) => {
      if (null === r.node || 'object' !== typeof r.node) {
        seen.push({ value: r.node, path: r.k.path.slice() })
      }
    }),
  )
}

const parser = new Tabnas({ plugins: [json] }).use(Path).use(collect)
parser.parse('{"a":1,"b":[2,3]}')

seen  // => [{ value: 1, path: ['a'] }, { value: 2, path: ['b', 0] }, { value: 3, path: ['b', 1] }]
```

The path of a scalar is the chain of keys and indices from the root down to
it.


## Keep a path beyond the current callback

`r.k.path` is a **shared, mutable** array. The plugin reuses one array per
depth level and rewrites it in place as it walks the tree, so reading it
later gives you a different path. If you need to retain a path, copy it
immediately with `.slice()` (or `[...r.k.path]`).

```js
const { Tabnas } = require('@tabnas/parser')
const { json } = require('@tabnas/json')
const { Path } = require('@tabnas/path')

const kept = []
const keep = (tn) => {
  tn.rule('val', (rs) =>
    rs.ac(false, (r) => {
      if (null === r.node || 'object' !== typeof r.node) {
        kept.push(r.k.path.slice()) // copy — safe to retain
      }
    }),
  )
}

const parser = new Tabnas({ plugins: [json] }).use(Path).use(keep)
parser.parse('{"a":1,"b":2}')

kept  // => [['a'], ['b']]
```

Without the `.slice()`, both entries would end up pointing at the same
recycled array.


## Seed the path from the caller (meta base)

Parse a fragment as if it were already nested under a known path by passing
a `base` array through Tabnas meta. The plugin uses it as the root path.

```js
const { Tabnas } = require('@tabnas/parser')
const { json } = require('@tabnas/json')
const { Path } = require('@tabnas/path')

const tag = (tn) => {
  tn.rule('val', (rs) =>
    rs.ac(false, (r) => {
      if (null !== r.node && 'object' === typeof r.node && !Array.isArray(r.node)) {
        r.node.$ = `<${r.k.path}>`
      }
    }),
  )
}

const parser = new Tabnas({ plugins: [json] }).use(Path).use(tag)
const out = parser.parse('{"a":1}', { path: { base: ['x', 'y'] } })

out.$  // => '<x,y>'
```

The root map now reports path `x, y` instead of the empty root. The `base`
array is shallow-copied, so the caller's array is never mutated.


## Tell a map key from an array index

Path segments are not all the same type. A map key is a `string`; an array
index is a `number`. Type-switch on each segment when the distinction
matters.

```js
const { Tabnas } = require('@tabnas/parser')
const { json } = require('@tabnas/json')
const { Path } = require('@tabnas/path')

const classify = []
const inspect = (tn) => {
  tn.rule('val', (rs) =>
    rs.ac(false, (r) => {
      if (null === r.node || 'object' !== typeof r.node) {
        classify.push(r.k.path.map((seg) => typeof seg))
      }
    }),
  )
}

const parser = new Tabnas({ plugins: [json] }).use(Path).use(inspect)
parser.parse('{"a":[10]}')

classify  // => [['string', 'number']]
```

The single scalar `10` lives at `['a', 0]`: a string key followed by a
numeric index.


## Use the last path segment directly

The plugin also sets `r.k.key` on each child to the final segment of its
path — the property name for a map child, or the index for an array element.
This saves you indexing into `r.k.path`.

```js
const { Tabnas } = require('@tabnas/parser')
const { json } = require('@tabnas/json')
const { Path } = require('@tabnas/path')

const keys = []
const grab = (tn) => {
  tn.rule('val', (rs) =>
    rs.ac(false, (r) => {
      if (null === r.node || 'object' !== typeof r.node) {
        keys.push(r.k.key)
      }
    }),
  )
}

const parser = new Tabnas({ plugins: [json] }).use(Path).use(grab)
parser.parse('{"a":1,"b":[2]}')

keys  // => ['a', 0]
```


## Plug it onto your own grammar

`Path` does not depend on `@tabnas/json` — it depends on the *rule names*
`val` / `map` / `pair` / `list` / `elem`. If you write your own grammar with
those rules, install it first and `Path` will hook onto it. A complete,
minimal grammar fixture lives in `ts/test/path.test.ts` (`Grammar`); it
defines exactly those five rules over brace maps, bracket lists, and scalar
values, and is enough to exercise the plugin without any JSON dependency.
