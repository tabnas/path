# Tutorial: tracking the path to a value

This tutorial takes you from nothing to a working parser that knows the
property path of every value it parses. It is a single happy path — follow
the steps in order.

By the end you will have a parser that, given `{"a":[1,2]}`, can tell you
that the value `1` lives at path `a, 0` (the key `a`, then array index `0`).


## What the plugin does

`@tabnas/path` is a plugin for the [Tabnas](https://github.com/tabnas/parser)
parser. As the parser walks an input it descends into maps and lists. The
plugin records, for every value, the chain of keys and indices that leads to
it from the root. That chain is the *path*.

The plugin does not print or return the path on its own. It writes the path
into the parser's per-rule key bag, `r.k.path`, where your own rule actions
can read it.


## Step 1 — Install

You need the parser engine, a grammar, and the plugin. The Tabnas engine
ships no grammar of its own, so we use the `@tabnas/json` grammar as the
host. (Any grammar that defines the conventional `val` / `map` / `pair` /
`list` / `elem` rules will do.)

```sh
npm install @tabnas/parser @tabnas/json @tabnas/path
```


## Step 2 — Build a parser

Install the grammar first, then the plugin on top. `Path` wires its hooks
onto the grammar's rules, so the rules must already exist when it runs.

```js
const { Tabnas } = require('@tabnas/parser')
const { json } = require('@tabnas/json')
const { Path } = require('@tabnas/path')

const parser = new Tabnas({ plugins: [json] }).use(Path)

parser.parse('{"a":[1,2]}')  // => { a: [ 1, 2 ] }
```

So far the result is identical to parsing without the plugin. `Path` only
*records* the path; it does not change the parsed value. To see the path,
you read it.


## Step 3 — Read the path

The path lives in `r.k.path` during the parse. Add a small second plugin
that reads it inside a `val` rule action and tags each value with its path.
Scalars become `<value:path>`; maps get a `$` property holding `<path>`;
array elements are tagged individually as scalars.

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

Read the tags:

- `<1:a,0>` — the value `1` is reached by key `a`, then index `0`.
- `<2:a,1>` — the value `2` is reached by key `a`, then index `1`.

When an array is stringified, the path `['a', 0]` renders as `a,0`. Map keys
appear as their string names; array indices appear as numbers.


## Step 4 — Go deeper

Nesting works the same way at any depth. Reuse the same `parser`:

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
const out = parser.parse('{"a":{"b":1,"c":[2,3]}}')

out.$         // => '<>'
out.a.$       // => '<a>'
out.a.b       // => '<1:a,b>'
out.a.c       // => ['<2:a,c,0>', '<3:a,c,1>']
```

- `out.$` is `<>`: the root path is empty.
- `out.a.$` is `<a>`: the nested map at `a` has path `[a]`.
- `out.a.b` is `<1:a,b>`: value `1` is at `a, b`.
- `out.a.c` holds two scalars, each carrying its full path including the
  array index.


## What you learned

- `Path` records the path of every value into `r.k.path`.
- The root path is empty (`[]`, which stringifies to `<>`).
- Map keys add a string segment; array elements add a numeric index.
- You read the path in your own rule action — the plugin never returns it.

Next:

- [How-to guides](./guide.md) — focused recipes for common tasks.
- [Reference](./reference.md) — the exact API surface.
- [Concepts](./concepts.md) — how and why it works.
