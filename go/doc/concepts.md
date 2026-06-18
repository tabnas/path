# Concepts (Go)

How `tabnaspath` works, the reasoning behind its design, and how it differs
from the canonical TypeScript version. For usage see the
[tutorial](./tutorial.md), [guides](./guide.md), and
[reference](./reference.md).


## The path of a value

When a parser reads structured input, every value sits at some location in
the tree. The *path* is the chain of steps from the root to that value: each
step is either a map key (a `string`) or an array index (an `int`). For the
input `{a:{b:1,c:[2,3]}}`:

- the value `1` is at `[]any{"a", "b"}`,
- the value `2` is at `[]any{"a", "c", 0}`,
- the value `3` is at `[]any{"a", "c", 1}`,
- the outer map is at the root, `[]any{}`.

`Path` computes this chain for every value during the parse and makes it
available to your code through `r.K["path"]`.


## Relationship to the Tabnas engine

Tabnas is a bare parsing *engine*. It ships **no grammar of its own**. A
grammar is supplied separately, defining rules — the units of the parse. The
conventional structural rule set uses five rule names:

- `val` — a value of any kind,
- `map` — a brace-delimited map,
- `pair` — a single key/value pair inside a map,
- `list` — a bracket-delimited list,
- `elem` — a single element inside a list.

`Path` adds *behaviour* to whatever grammar provides those rules. It does
not parse anything itself; it hooks the five rule names and records the path
as the engine drives them. This is why you install the grammar first: the
rules must exist for `Path` to attach to.

The plugin attaches by declaring each rule with an **empty
`GrammarRuleSpec`**. An empty spec leaves the host grammar's rule untouched,
but causes `j.Grammar()` to auto-wire any matching `@<rulename>-<phase>`
function ref as a `StateAction` on that rule. So `@pair-ao` becomes an
after-open action on `pair`, without the plugin redefining how `pair`
parses.


## Why `Rule.K` carries the path

Each parser rule has a key bag, `r.K` (a `map[string]any`), that is
**inherited by its child rules**. This is the mechanism the plugin exploits:
write the path into `r.K["path"]` once, and every rule in that subtree sees
it, without threading state explicitly through each action.

The path grows by exactly one segment as the parse descends one level:

- When a `pair` opens (`@pair-ao`), the plugin takes the parent's `path`,
  appends the pair's key (`r.U["key"]`), and writes the result to the
  child's `K["path"]`.
- When an `elem` opens (`@elem-ao`), it appends the element's index instead.

Because the bag is inherited, the child and its whole subtree carry the
extended path. Descending again repeats the step. The root is set up once in
`@val-bo`.


## Maps versus lists

Map children and list children identify themselves differently, so the
plugin handles them differently:

- **Map children** know their key. The `pair` rule already captures it as
  `r.U["key"]`, so `@pair-ao` simply appends that key.
- **List children** know only their position. There is no key, so the plugin
  maintains a running counter, `r.K["index"]`, on the `list` rule.
  `@list-bo` sets it to `-1` (nothing seen yet); `@elem-ao` increments it and
  uses the new value as the path segment.

`@map-bo` deletes `r.K["index"]`. Without this, a `list`'s index could leak,
through the inherited key bag, into a map nested inside that list and corrupt
its element bookkeeping. Clearing it at the start of every map keeps the two
regimes separate.


## Depth guards

A top-level value in Tabnas can be wrapped in an implicit map or list,
producing a rule at depth `0` that is logically the root. If the plugin
treated that rule like any other child, it would prepend a phantom leading
segment to every path.

The guards prevent this:

- The root path is initialised only at `r.D == 0` (`@val-bo`).
- Children's paths are extended only at `r.D > 0` (`@pair-ao`, `@elem-ao`).

So the implicit top-level structure contributes no segment, and the root
path stays empty unless you seed it.


## The meta base path

Passing `meta["path"]["base"]` (via `ParseMeta`) lets a caller parse a
fragment as if it were already nested under a known prefix. The plugin
copies the base into the root path, so a value at key `a` parsed with
`base: []any{"x", "y"}` reports path `[]any{"x", "y", "a"}`.

This is useful when composing parsers — parsing an embedded fragment whose
true location is known from the surrounding document — or when reporting
errors in terms of that surrounding document. The base is shallow-copied, so
the caller's slice is never mutated.


## Why `any` for path segments

A path mixes `string` (map keys) and `int` (array indices). Go has no sum
type, so the slice element type is `any` and callers type-switch when they
care about the distinction. Numeric indices are stored as `int` (not
`float64`) so they survive a round trip through a type switch without further
conversion.


## Why a plugin at all

A grammar does not record paths because the default rules never use them.
But many extensions — validation, error reporting, templating, change
tracking — do. Making path tracking a plugin keeps the cost out of the core:
it is paid only when loaded, and the grammar stays focused on parsing. It
also composes cleanly, since later actions simply read `r.K["path"]` from the
inherited key bag.


## Differences from the TS version

The Go port tracks the canonical TypeScript implementation, with these
deliberate differences:

- **No array pool; fresh allocation per level.** The TS version keeps a
  pool of arrays (one per depth) and rewrites them in place to avoid
  per-value allocation, which makes `r.k.path` a **shared, mutable** array
  that callers must copy before retaining. The Go port instead allocates a
  fresh `[]any` for each child's path (`make` + `copy` in `@pair-ao` and
  `@elem-ao`). Consequently the slice from `r.K["path"]` is **not shared**
  and can be retained directly — there is no mutability hazard to defend
  against. There is also no `MAX_PATH_DEPTH` preallocation limit.

- **No `pathDepth` key.** The TS version stores `r.k.pathDepth` alongside
  `r.k.path` to size its pooled array. The Go port derives length from the
  slice (`len(...)`) and writes no `pathDepth` entry.

- **Index segments are `int`, not JS `number`.** In TS an array index is a
  plain JavaScript number. In Go it is stored as `int`, so a type switch
  distinguishes a `string` map key from an `int` index without a
  `float64` conversion step. (Note that parsed numeric *values* from the
  JSON-style grammar are `float64`; that is separate from path index
  segments.)

- **Meta is passed via `ParseMeta`.** TS accepts meta as the second
  argument to `parse(src, meta)`. The Go API uses a dedicated
  `j.ParseMeta(src, meta)` call, with `meta` typed as `map[string]any` and
  the base as `meta["path"]["base"].([]any)`.

- **Plugin signature and registration.** The Go plugin is
  `func(j *tabnas.Tabnas, opts map[string]any) error`, registered with
  `j.Use(Path, nil)`. The TS plugin is a `Plugin` value registered with
  `tn.use(Path)`. The Go package name is `tabnaspath`; the TS package is
  `@tabnas/path`.

- **`Version` constant.** The Go package exports a `Version` constant
  (`"0.2.0"`); the TS package's version lives in `package.json` (`2.1.0`).
