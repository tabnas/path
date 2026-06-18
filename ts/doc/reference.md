# Reference

Precise description of the `@tabnas/path` public surface. For an
introduction see the [tutorial](./tutorial.md); for task recipes see the
[guides](./guide.md); for the rationale see [concepts](./concepts.md).


## Package

```ts
import { Path, PathOptions } from '@tabnas/path'
```

or, in CommonJS:

```js
const { Path } = require('@tabnas/path')
```

- Package name: `@tabnas/path`
- Entry point: `dist/path.js` (CommonJS), types at `dist/path.d.ts`
- Peer dependency: `@tabnas/parser` (`>=2`)


## Exports

### `Path: Plugin`

The Tabnas plugin function. Install it with `tn.use(Path)` **after** the
grammar that defines the hooked rules.

```js
const parser = new Tabnas({ plugins: [grammar] }).use(Path)
// or
const parser = new Tabnas().use(grammar).use(Path)
```

`Path` takes no options. It declares the hooked rules with empty rule specs
and attaches its function refs as state actions, leaving the host grammar's
rules otherwise unchanged.

### `Path.defaults`

The default options object. Currently `{}`.

### `type PathOptions`

```ts
type PathOptions = {}
```

An empty object type. Reserved for future options; the plugin accepts none
today.


## Hooked rules

`Path` attaches to the host grammar's rules by these names:

```
val   map   pair   list   elem
```

Each is declared with an empty rule spec so `tn.grammar()` auto-wires the
matching `@<rulename>-<phase>` function refs as state actions. If your host
grammar does not define these rule names, the corresponding hooks never
fire.


## Function refs

The plugin registers these refs against the grammar. The suffix encodes the
phase: `-bo` = before open, `-ao` = after open.

| Ref        | Fires               | Effect                                                          |
| ---------- | ------------------- | -------------------------------------------------------------- |
| `@val-bo`  | before `val` opens  | At the root (`r.d === 0`), initialise `r.k.path` (empty, or from the meta base). |
| `@map-bo`  | before `map` opens  | Clear `r.k.index` (map children are keyed by name, not index). |
| `@list-bo` | before `list` opens | Set `r.k.index = -1` (no element seen yet).                    |
| `@pair-ao` | after `pair` opens  | Set the child's `path` to the parent path plus the pair key.   |
| `@elem-ao` | after `elem` opens  | Increment `index`; set the child's `path` to the parent path plus that index. |


## Values written to `Rule.k`

`Rule.k` is the per-rule key bag, inherited by child rules. After the
plugin's hooks run, these entries are present:

| Key         | Where                       | Type                   | Meaning                                                        |
| ----------- | --------------------------- | ---------------------- | ------------------------------------------------------------- |
| `path`      | every rule at `r.d > 0`     | `(string \| number)[]` | Property path from the root to this value.                    |
| `pathDepth` | every rule at `r.d > 0`     | `number`               | Length of `path`. Used internally to size the pooled array.   |
| `key`       | `pair` / `elem` child       | `string \| number`     | The last path segment (property name or array index).         |
| `index`     | `list` / `elem`             | `number`               | Current element index inside a list (`-1` before first elem). |

At the root (`r.d === 0`), `path` is `[]` unless a base is supplied through
meta (see below). Path segments are `string` for map keys and `number` for
array indices.

### Mutability — important

`r.k.path` is a **shared, mutable** array. The plugin keeps a pool of
arrays, one per depth level, and rewrites them in place as it walks the
tree. Two values at the same depth see the **same** array instance. Any code
that needs to retain a path beyond the current callback **must copy it**:

```js
const snapshot = r.k.path.slice()   // or [...r.k.path]
```

Reading `r.k.path` synchronously (for example, interpolating it into a
string) is always safe.


## Meta input

Seed the root path by passing a `base` array through the parse meta:

```ts
parser.parse(src, { path: { base: ['x', 'y'] } })
```

- `meta.path.base: (string | number)[]` — the root path. The array is
  shallow-copied into the pool, so the caller's array is not mutated.

If `base` is absent or empty, the root path is `[]`.


## Path stringification

A path array stringifies (via JavaScript array `toString`) to its segments
joined by commas:

| Path array      | String form |
| --------------- | ----------- |
| `[]`            | `` (empty)  |
| `['a']`         | `a`         |
| `['a', 'b']`    | `a,b`       |
| `['a', 0]`      | `a,0`       |
| `[0, 0, 1]`     | `0,0,1`     |

This is why the doc examples that interpolate `${r.k.path}` produce strings
like `a,c,0`.


## No CLI

`@tabnas/path` is a library plugin only. It ships no command-line interface
and no executable.
