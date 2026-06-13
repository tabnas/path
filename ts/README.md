# @jsonic/path (Jsonic syntax plugin)

This plugin adds property-path tracking to the [Jsonic](https://jsonic.senecajs.org) parser so that rule actions can see the path (keys and indices) leading to the current value.


[![npm version](https://img.shields.io/npm/v/@jsonic/path.svg)](https://npmjs.com/package/@jsonic/path)
[![build](https://github.com/jsonicjs/path/actions/workflows/build.yml/badge.svg)](https://github.com/jsonicjs/path/actions/workflows/build.yml)
[![Coverage Status](https://coveralls.io/repos/github/jsonicjs/path/badge.svg?branch=main)](https://coveralls.io/github/jsonicjs/path?branch=main)
[![Known Vulnerabilities](https://snyk.io/test/github/jsonicjs/path/badge.svg)](https://snyk.io/test/github/jsonicjs/path)
[![DeepScan grade](https://deepscan.io/api/teams/5016/projects/22470/branches/663910/badge/grade.svg)](https://deepscan.io/dashboard#view=project&tid=5016&pid=22470&bid=663910)
[![Maintainability](https://api.codeclimate.com/v1/badges/d62b581b8a8404e18229/maintainability)](https://codeclimate.com/github/jsonicjs/path/maintainability)


| ![Voxgig](https://www.voxgig.com/res/img/vgt01r.png) | This open source module is sponsored and supported by [Voxgig](https://www.voxgig.com). |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |


This documentation is organised in four parts:

- [Tutorial](#tutorial) — a hands-on walk-through for a first-time user.
- [How-to guides](#how-to-guides) — recipes for specific tasks.
- [Reference](#reference) — a precise description of what the plugin exposes.
- [Explanation](#explanation) — the ideas and design behind it.


## Tutorial

This tutorial shows you how to install the plugin, attach it to a Jsonic instance, and read the path of a value as it is parsed.

**1. Install**

```sh
npm install @jsonic/path jsonic
```

**2. Attach the plugin**

```js
const { Jsonic } = require('jsonic')
const { Path } = require('@jsonic/path')

const j = Jsonic.make().use(Path)
```

Parsing works exactly as before:

```js
j('{a:{b:1,c:[2,3]}}')
// => { a: { b: 1, c: [ 2, 3 ] } }
```

**3. Observe the path**

Path itself only populates `Rule.k.path`. To *see* it, add a second plugin that reads the path inside a rule action:

```js
const capture = (jsonic) => {
  jsonic.rule('val', (rs) => {
    rs.ac(false, (r) => {
      if ('object' !== typeof r.node) {
        r.node = `<${r.node}:${r.k.path}>`
      } else {
        r.node.$ = `<${r.k.path}>`
      }
    })
  })
}

const jp = Jsonic.make().use(Path).use(capture)
jp('{a:{b:1,c:[2,3]}}')
// => {
//   $: '<>',
//   a: { $: '<a>', b: '<1:a,b>', c: [ '<2:a,c,0>', '<3:a,c,1>' ] }
// }
```

You have now seen the plugin populate the path at every level: the root is `[]`, keys become strings, array elements become integer indices.


## How-to guides

### How to read the path inside your own rule action

`Path` runs its hooks first (`bo`/`ao`). Later plugins can read `r.k.path` inside `bc`/`ac` actions or from within alt actions:

```js
jsonic.rule('val', (rs) => rs.ac((r) => {
  console.log('path =', r.k.path, 'value =', r.node)
}))
```

### How to seed the path from the caller

Pass a base path via Jsonic meta and Path will use it for the root:

```js
j('{a:1}', { path: { base: ['x', 'y'] } })
// path of value 1 is ['x','y','a']
```

### How to use it from Go

The Go port lives in the `go/` directory as module `github.com/jsonicjs/path/go`:

```go
import (
    jsonic "github.com/jsonicjs/jsonic/go"
    path "github.com/jsonicjs/path/go"
)

j := jsonic.Make()
_ = j.Use(path.Path, nil)
// or: j := path.MakeJsonic()

result, _ := j.Parse("{a:{b:1}}")
```

Inside a Go rule action, the path is `r.K["path"].([]any)`.

### How to rebuild the embedded grammar

`path-grammar.jsonic` is the single source of truth for the declarative grammar. After editing it, regenerate the embedded copies:

```sh
npm run embed
```

The script rewrites the marked region in `src/path.ts` and `go/path.go`.


## Reference

### JavaScript/TypeScript

```ts
import { Path, PathOptions } from '@jsonic/path'
```

- `Path: Plugin` — the Jsonic plugin function. Pass to `jsonic.use(Path)`.
- `PathOptions` — currently an empty object type; no options are accepted.

### Go

```go
import path "github.com/jsonicjs/path/go"
```

- `path.Path(j *jsonic.Jsonic, opts map[string]any) error` — plugin function, registered with `j.Use(path.Path, nil)`.
- `path.MakeJsonic() *jsonic.Jsonic` — returns a Jsonic instance with `Path` already installed.
- `path.PathOptions` — empty struct reserved for future options.

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
parser(src, { path: { base: ['x', 'y'] } })
```

- `meta.path.base: (string | number)[]` — seed the root path. The array is shallow-copied, so the caller's array is not mutated.

### Grammar file

`path-grammar.jsonic` declares the rules the plugin hooks into:

```
{
  rule: {
    val:  {}
    map:  {}
    pair: {}
    list: {}
    elem: {}
  }
}
```

Each empty rule entry causes `jsonic.grammar()` to auto-wire any matching `@<rulename>-<phase>` function refs as state actions.

### Function refs

The plugin registers these refs against the grammar:

| Ref         | Fires                 | Effect                                               |
| ----------- | --------------------- | ---------------------------------------------------- |
| `@val-bo`   | before `val` opens    | Initialise `r.k.path` at the root (`d === 0`).       |
| `@map-bo`   | before `map` opens    | Clear `r.k.index` (map children key by name).        |
| `@list-bo`  | before `list` opens   | Set `r.k.index = -1` (no element seen yet).          |
| `@pair-ao`  | after `pair` opens    | Set child `path` = parent `path` + pair key.         |
| `@elem-ao`  | after `elem` opens    | Increment `index`; set child `path` = parent + idx.  |

### Group tag

In the Go implementation, `j.Grammar(..., &GrammarSetting{Rule: {Alt: {G: "path"}}})` tags every alt added by this plugin with `g: "path"`, so callers can filter rules via `options.rule.include` / `options.rule.exclude`.


## Explanation

**Why a plugin.** Jsonic does not record the path to a value because that information is unused by the default rules. Many extensions (validation, error reporting, templating) *do* need it. A plugin is the right scope: it costs nothing when not loaded, and it stays out of the core parser.

**Why `Rule.k`.** Each parser rule has a key bag `k` that is *inherited by child rules*. Writing the path once into `r.k.path` makes it visible for the lifetime of that subtree without threading state through every action. Updating the child's `k.path` in `pair-ao` / `elem-ao` is enough to walk the path down one level at a time.

**Why two different updates for maps and lists.** Map children identify themselves by key, which the pair rule already captures as `r.u.key`. List children identify themselves by position, so the plugin maintains `r.k.index` on the list rule and increments it when each element opens. Clearing `index` in `map-bo` prevents a surrounding list's index from leaking into a nested map.

**Why depth guards.** Top-level implicit maps and lists can produce a rule at depth 0 that is logically the root. The plugin initialises the root path only at `d === 0` and updates children only at `d > 0`, so implicit structure does not create a phantom leading segment.

**Meta base path.** Passing `meta.path.base` lets a caller parse a fragment as if it were already nested under a known path — useful when composing parsers or when reporting errors in terms of a surrounding document.

**Declarative grammar and the `g: "path"` tag.** The plugin's rule bindings are declared in `path-grammar.jsonic` rather than built imperatively. The `g: "path"` group tag marks every alt this plugin contributes, so a parser built with `options.rule.exclude: "path"` can reliably turn path tracking off without uninstalling the plugin.


<!--START:options-->
## Options
_None_
<!--END:options-->
