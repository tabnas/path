# @tabnas/path (Tabnas parser plugin)

This plugin adds property-path tracking to the [Tabnas](https://github.com/tabnas/parser) parser so that rule actions can see the path (keys and indices) leading to the current value.


[![npm version](https://img.shields.io/npm/v/@tabnas/path.svg)](https://npmjs.com/package/@tabnas/path)
[![build](https://github.com/tabnas/path/actions/workflows/build.yml/badge.svg)](https://github.com/tabnas/path/actions/workflows/build.yml)


| ![Voxgig](https://www.voxgig.com/res/img/vgt01r.png) | This open source module is sponsored and supported by [Voxgig](https://www.voxgig.com). |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |


This documentation is organised in four parts:

- [Tutorial](#tutorial) — a hands-on walk-through for a first-time user.
- [How-to guides](#how-to-guides) — recipes for specific tasks.
- [Reference](#reference) — a precise description of what the plugin exposes.
- [Explanation](#explanation) — the ideas and design behind it.


## Tutorial

This tutorial shows you how to attach the plugin to a Tabnas parser and read the path of a value as it is parsed.

The Tabnas engine ships no grammar of its own — you bring a grammar plugin that defines the `val` / `map` / `pair` / `list` / `elem` rules. `Path` attaches to those rules. Install your grammar first, then `Path` on top.

**1. Install**

```sh
npm install @tabnas/path @tabnas/parser
```

**2. Attach a grammar and the plugin**

```js
const { Tabnas } = require('@tabnas/parser')
const { Path } = require('@tabnas/path')

// `Grammar` is any plugin that defines val/map/pair/list/elem rules.
// A complete, minimal example lives in test/path.test.ts.
const j = new Tabnas().use(Grammar).use(Path)
```

Parsing works exactly as it would without the plugin:

```js ignore
j.parse('{a:{b:1,c:[2,3]}}')
// => { a: { b: 1, c: [ 2, 3 ] } }
```

**3. Observe the path**

`Path` itself only populates `Rule.k.path`. To *see* it, add a second plugin that reads the path inside a rule action:

```js ignore
const capture = (tn) => {
  tn.rule('val', (rs) => {
    rs.ac(false, (r) => {
      if (null === r.node || 'object' !== typeof r.node) {
        r.node = `<${r.node}:${r.k.path}>`
      } else if (!Array.isArray(r.node)) {
        r.node.$ = `<${r.k.path}>`
      }
    })
  })
}

const jp = new Tabnas().use(Grammar).use(Path).use(capture)
jp.parse('{a:{b:1,c:[2,3]}}')
// => {
//   $: '<>',
//   a: { $: '<a>', b: '<1:a,b>', c: [ '<2:a,c,0>', '<3:a,c,1>' ] }
// }
```

You have now seen the plugin populate the path at every level: the root is `[]`, keys become strings, array elements become integer indices.


## How-to guides

### Runnable example

A complete, self-contained example using the [`@tabnas/json`](https://npmjs.com/package/@tabnas/json) grammar as the host. `Path` populates `r.k.path` for every value; the `capture` plugin tags each value with that path (scalars become `<value:path>`, the array elements are tagged individually):

```js
const { Tabnas } = require('@tabnas/parser')
const { json } = require('@tabnas/json')
const { Path } = require('@tabnas/path')

// Tag every value with the path Path tracks in r.k.path.
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

const jp = new Tabnas({ plugins: [json] }).use(Path).use(capture)
const out = jp.parse('{"a":[1,2]}')

out.a       // => ['<1:a,0>', '<2:a,1>']
out.a[0]    // => '<1:a,0>'
```

Each scalar carries its full path: element `1` lives at `a,0` (key `a`, index `0`) and `2` at `a,1`.

### How to read the path inside your own rule action

`Path` runs its hooks first (`bo`/`ao`). Later plugins can read `r.k.path` inside `bc`/`ac` actions or from within alt actions:

```js
tn.rule('val', (rs) => rs.ac((r) => {
  console.log('path =', r.k.path, 'value =', r.node)
}))
```

`r.k.path` is a shared, mutable array — copy it (`r.k.path.slice()`) if you need to keep it beyond the current callback.

### How to seed the path from the caller

Pass a base path via Tabnas meta and `Path` will use it for the root:

```js ignore
j.parse('{a:1}', { path: { base: ['x', 'y'] } })
// path of value 1 is ['x','y','a']
```

### How to use it from Go

The Go port lives in the `go/` directory as module `github.com/tabnas/path/go`:

```go
import (
    tabnas "github.com/tabnas/parser/go"
    path "github.com/tabnas/path/go"
)

j := tabnas.Make()
installGrammar(j)         // your grammar: defines val/map/pair/list/elem
_ = j.Use(path.Path, nil) // install Path after the grammar

result, _ := j.Parse("{a:{b:1}}")
```

Inside a Go rule action, the path is `r.K["path"].([]any)`.


## Reference

### JavaScript/TypeScript

```ts
import { Path, PathOptions } from '@tabnas/path'
```

- `Path: Plugin` — the Tabnas plugin function. Pass to `tn.use(Path)` *after* the grammar that defines the hooked rules.
- `PathOptions` — currently an empty object type; no options are accepted.

### Go

```go
import path "github.com/tabnas/path/go"
```

- `path.Path(j *tabnas.Tabnas, opts map[string]any) error` — plugin function, registered with `j.Use(path.Path, nil)`.
- `path.PathOptions` — empty struct reserved for future options.

### Hooked rules

`Path` attaches to the host grammar's rules by name:

```
val  map  pair  list  elem
```

Each is declared with an empty rule spec so `tn.grammar()` auto-wires the matching `@<rulename>-<phase>` function refs as state actions, without otherwise altering the host grammar's rules.

### Values written to `Rule.k` / `Rule.K`

After the plugin runs, the following entries are present on the rule key bag:

| Key    | Where               | Type                  | Meaning                                                    |
| ------ | ------------------- | --------------------- | ---------------------------------------------------------- |
| `path` | every rule at `d>0` | `(string \| number)[]` | Property path from the root to this value.                 |
| `key`  | `pair`, `elem` child | `string \| number`    | The last path segment (property name or array index).      |
| `index` | `list`, `elem`     | `number`              | Current element index inside a list (-1 before first elem).|

At the top level (`r.d === 0`) `path` is `[]` unless a base was supplied via `ctx.meta.path.base`.

### Meta input

```ts
j.parse(src, { path: { base: ['x', 'y'] } })
```

- `meta.path.base: (string | number)[]` — seed the root path. The array is shallow-copied, so the caller's array is not mutated.

### Function refs

The plugin registers these refs against the grammar:

| Ref         | Fires                 | Effect                                               |
| ----------- | --------------------- | ---------------------------------------------------- |
| `@val-bo`   | before `val` opens    | Initialise `r.k.path` at the root (`d === 0`).       |
| `@map-bo`   | before `map` opens    | Clear `r.k.index` (map children key by name).        |
| `@list-bo`  | before `list` opens   | Set `r.k.index = -1` (no element seen yet).          |
| `@pair-ao`  | after `pair` opens    | Set child `path` = parent `path` + pair key.         |
| `@elem-ao`  | after `elem` opens    | Increment `index`; set child `path` = parent + idx.  |


## Explanation

**Why a plugin.** A grammar does not record the path to a value because that information is unused by the default rules. Many extensions (validation, error reporting, templating) *do* need it. A plugin is the right scope: it costs nothing when not loaded, and it stays out of the core grammar.

**Why the host supplies the grammar.** Tabnas is a bare parsing engine: it ships no grammar. `Path` adds *behaviour* (path tracking) to whatever grammar you install, by hooking the conventional `val` / `map` / `pair` / `list` / `elem` rule names. Install your grammar first so those rules exist when `Path` wires its refs onto them.

**Why `Rule.k`.** Each parser rule has a key bag `k` that is *inherited by child rules*. Writing the path once into `r.k.path` makes it visible for the lifetime of that subtree without threading state through every action. Updating the child's `k.path` in `pair-ao` / `elem-ao` is enough to walk the path down one level at a time.

**Why two different updates for maps and lists.** Map children identify themselves by key, which the pair rule already captures as `r.u.key`. List children identify themselves by position, so the plugin maintains `r.k.index` on the list rule and increments it when each element opens. Clearing `index` in `map-bo` prevents a surrounding list's index from leaking into a nested map.

**Why depth guards.** Top-level implicit maps and lists can produce a rule at depth 0 that is logically the root. The plugin initialises the root path only at `d === 0` and updates children only at `d > 0`, so implicit structure does not create a phantom leading segment.

**Meta base path.** Passing `meta.path.base` lets a caller parse a fragment as if it were already nested under a known path — useful when composing parsers or when reporting errors in terms of a surrounding document.


<!--START:options-->
## Options
_None_
<!--END:options-->
