# Concepts

How `@tabnas/path` works, and the reasoning behind its design. For usage see
the [tutorial](./tutorial.md), [guides](./guide.md), and
[reference](./reference.md).


## The path of a value

When a parser reads structured input, every value sits at some location in
the tree. The *path* is the chain of steps from the root to that value: each
step is either a map key (a string) or an array index (a number). For the
input `{"a":[1,2]}`:

- the value `1` is at `['a', 0]`,
- the value `2` is at `['a', 1]`,
- the map `{"a":...}` itself is at the root, `[]`.

`Path` computes this chain for every value during the parse and makes it
available to your code.


## Relationship to the Tabnas engine

Tabnas is a bare parsing *engine*. It ships **no grammar of its own**. A
grammar is supplied by a plugin (for example `@tabnas/json`), which defines
rules — the units of the parse. The conventional structural rule set uses
five rule names:

- `val` — a value of any kind,
- `map` — a brace-delimited map,
- `pair` — a single key/value pair inside a map,
- `list` — a bracket-delimited list,
- `elem` — a single element inside a list.

`Path` adds *behaviour* to whatever grammar provides those rules. It does
not parse anything itself; it hooks the five rule names and records the path
as the engine drives them. This is why you install the grammar first: the
rules must exist for `Path` to attach to.

The plugin attaches by declaring each rule with an **empty rule spec**. An
empty spec leaves the host grammar's rule untouched, but causes
`tn.grammar()` to auto-wire any matching `@<rulename>-<phase>` function ref
as a state action on that rule. So `@pair-ao` becomes an after-open action
on `pair`, and so on, without the plugin redefining how `pair` parses.


## Why `Rule.k` carries the path

Each parser rule has a key bag, `r.k`, that is **inherited by its child
rules**. This is the mechanism the plugin exploits: write the path into
`r.k.path` once, and every rule in that subtree sees it, without threading
state explicitly through each action.

The path grows by exactly one segment as the parse descends one level:

- When a `pair` opens (`@pair-ao`), the plugin takes the parent's `path`,
  appends the pair's key (`r.u.key`), and writes the result to the child's
  `k.path`.
- When an `elem` opens (`@elem-ao`), it appends the element's index instead.

Because the bag is inherited, the child and its whole subtree carry the
extended path. Descending again repeats the step. The root is set up once in
`@val-bo`.


## Maps versus lists

Map children and list children identify themselves differently, so the
plugin handles them differently:

- **Map children** know their key. The `pair` rule already captures it as
  `r.u.key`, so `@pair-ao` simply appends that key.
- **List children** know only their position. There is no key, so the plugin
  maintains a running counter, `r.k.index`, on the `list` rule. `@list-bo`
  sets it to `-1` (nothing seen yet); `@elem-ao` increments it and uses the
  new value as the path segment.

`@map-bo` clears `r.k.index`. Without this, a `list`'s index could leak,
through the inherited key bag, into a map nested inside that list and
corrupt its element bookkeeping. Clearing it at the start of every map keeps
the two regimes separate.


## Depth guards

A top-level value in Tabnas can be wrapped in an implicit map or list,
producing a rule at depth `0` that is logically the root. If the plugin
treated that rule like any other child, it would prepend a phantom leading
segment to every path.

The guards prevent this:

- The root path is initialised only at `r.d === 0` (`@val-bo`).
- Children's paths are extended only at `r.d > 0` (`@pair-ao`, `@elem-ao`).

So the implicit top-level structure contributes no segment, and the root
path stays empty unless you seed it.


## The array pool and mutability

Path tracking runs once per value, on the hot path of the parser. Allocating
a fresh array for every pair and element would create garbage proportional
to the input size. To avoid that, the plugin keeps a **pool of arrays, one
per depth level**, and rewrites the array in place as it walks the tree.

The trade-off is that `r.k.path` is **shared and mutable**. Two values at
the same depth observe the same array instance; reading it later yields a
different path. The contract is therefore:

- Reading the path synchronously (string interpolation, an immediate copy,
  classification) is safe.
- Retaining the path requires an explicit copy (`r.k.path.slice()`).

This is a deliberate choice: zero per-value allocation in exchange for a
copy when, and only when, the caller needs to keep a path. The plugin's
tests assert that two same-depth values share the live array, locking the
behaviour in.

The pool is preallocated up to a fixed maximum depth (`MAX_PATH_DEPTH`).
Deeper paths fall back to a freshly allocated array of the required length,
so depth is not hard-capped — only the fast preallocated range is.


## The meta base path

Passing `meta.path.base` lets a caller parse a fragment as if it were
already nested under a known prefix. The plugin copies the base into the
root path, so a value at key `a` parsed with `base: ['x', 'y']` reports path
`['x', 'y', 'a']`.

This is useful when composing parsers — parsing an embedded fragment whose
true location is known from the surrounding document — or when reporting
errors in terms of that surrounding document rather than the fragment alone.
The base is shallow-copied, so the caller's array is never mutated.


## Why a plugin at all

A grammar does not record paths because the default rules never use them.
But many extensions — validation, error reporting, templating, change
tracking — do. Making path tracking a plugin keeps the cost out of the core:
it is paid only when loaded, and the grammar stays focused on parsing. It
also composes cleanly, since later plugins simply read `r.k.path` from the
inherited key bag.
