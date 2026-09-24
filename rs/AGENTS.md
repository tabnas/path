# Agent guide: Rust implementation

The Rust port of the canonical TypeScript in [`../ts`](../ts). Read
[`../AGENTS.md`](../AGENTS.md) first: it holds the cross-runtime rules,
and this file only covers what is specific to this crate.

## Layout

| Path | |
|---|---|
| `src/lib.rs` | the whole port: the four hooks, `path`, `plugin`, `path_of`, the `k` key constants |
| `tests/common/fixture.rs` | the local host grammar and the capture hook: the twin of `ts/test/fixture.ts` and `go/path_test.go` |
| `tests/parity_test.rs` | the shared `../test/spec/*.tsv` fixtures, through `tabnas_support::Runner` |
| `tests/path_test.rs` | the Go/TS unit, stress and perf cases, plus what only this port can pin |
| `tests/version_test.rs` | the version sites must agree |
| `README.md` | the crate front page; its `rust` fences are doctests of the crate |

Crate `tabnas-path`, library `tabnas_path`. The engine crate `tabnas` is a
**path dependency on the sibling checkout** (`../../parser/rs`) and is the
only runtime dependency, as `@tabnas/parser` is for TS and
`github.com/tabnas/parser/go` is for Go. `tabnas-support` (the fixture
runner) and `tabnas-json` (the grammar the README example is tested on)
are dev-dependencies, also by sibling path. None of the three is
published, so `ci/rust/run.sh` expects all three beside the checkout
and `.github/workflows/rust.yml` clones them.

```bash
cargo build --all-targets
cargo test --all-targets
cargo test --doc
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt
```

## The one thing the engine cannot express

TypeScript sets the child's path from the PARENT: `@pair-ao` and
`@elem-ao` write `r.child.k.path`, `r.child.k.key`, and so on. Go does the
same through `r.Child.EnsureK()`. This engine cannot:

- the child's `k` is cloned from the parent's BEFORE the parent's `ao`
  phase runs (`parser.rs`, `child.k = Rc::clone(&current_rule.k)` right
  before `run_after_actions`), so a parent `k` write in `ao` is not
  inherited;
- the parent sees the child only as `rule.child_rule` (and the `next`
  argument of `state_action_with_next_ref`), an `Rc<RuleSnapshot>` that
  is immutable, and nothing copies a snapshot back into the live child;
- `Rc::make_mut` on that snapshot would copy it, not write through.

So the port does the same work one step later, from the CHILD: `@val-bo`
reads `rule.parent_rule`, the parent's snapshot, which the engine
refreshes AFTER the parent's `ao` ran (so the index `@elem-ao` just
advanced is what it reads), and computes the path from the parent's
`k.path` plus `u.key` (parent named `pair`, with `u.pair` truthy) or
`k.index` (parent named `elem`). `@elem-ao` still runs on the parent, to
advance the index in the parent's own bag, exactly as TS does. There is no
`@pair-ao`: everything TS does there is on the child.

Two consequences, both documented in the README's differences list:

1. Only a `val` child gets a path. A host grammar whose `pair` or `elem`
   pushes some other rule name gets nothing on that child, where TS sets
   it regardless of the child's name. The conventional rule set pushes
   `val`, and every fixture and test does.
2. The pushing rule must be NAMED `pair` or `elem`. TS keys on the hook
   firing, not the name; here the child has only the name to go on.

If the engine ever grows a write path to the child from the parent's
`ao` (a mutable `next`, or copying `child_rule` back into the child after
`ao`), move the work back to `@pair-ao` / `@elem-ao` and delete this
section.

## Function references are one namespace, and builtins win

Three engine facts that decided the hook names:

- `Tabnas` keeps ONE map of references per instance, looked up BY NAME
  at parse time. TS resolves each `grammar()` call's `ref` map to
  closures at install. So a plugin registering a name a host also
  registered overwrites the host's closure, and the engine wires each
  name once (`!actions.contains(..)`), so one hook is lost. jsonic's Rust
  port registers `@map-bo/append` and `@list-bo/append` (plus
  `@val-bc/replace`, `@elem-bc/replace` and `/append` refs for val-ac,
  map-bc, list-bc, pair-bc), so `/append` names are NOT free.
- A named action resolves to an engine BUILTIN first
  (`run_action_with_config` tries `run_builtin_action_with_info` before
  `actions` and `context_actions`), and `@val-bo`, `@map-bo`, `@list-bo`
  are builtin names. A `state_action_ref("@val-bo", …)` never runs; the
  builtin (node = undefined) runs instead. Only `state_action_with_next_ref`
  (which lands in `state_actions`, consulted first) would win, and a host
  document naming the builtin in its `bo` would then get Path's closure
  in place of the builtin.
- `wire_state_actions` in `grammar.rs` handles `/prepend` on its own:
  `/replace` clears the phase, else `/prepend` is inserted at 0 if
  absent, and THEN the base-or-`/append` slot is filled independently.
  So a `/prepend` reference neither takes a host's slot nor is taken by
  one, whichever is installed first.

Hence `@val-bo/prepend`, `@map-bo/prepend`, `@list-bo/prepend`,
`@elem-ao/prepend`. No sibling Rust port registers a `/prepend` name
(checked: chess, directive, hoover, jsonic, jsonl, markdown, railroad).
Position: Path's hooks run FIRST in their phase where TS's run last. For
`val-bo` that is the more faithful order: in TS the parent's `ao` set the
child's path before the child's `bo` ran, so a host `val-bo` sees the
path; with `/append` it would see the stale inherited one. The other
three hooks write only `k` entries no host hook of the same phase reads.
`composes_with_a_host_that_registers_append_refs` in `tests/path_test.rs`
pins the jsonic-shaped case: a host's `@map-bo/append` / `@list-bo/append`
closures still run with Path installed, and the paths are right.

What still loses a hook: a host registering one of those four `/prepend`
names, or a `/replace` for one of those four phases (a `/replace` clears
the phase on every reinstall, Path's `/prepend` included).

## The fixture grammar is imperative on purpose

`tests/common/fixture.rs` builds the host grammar with `define_rule` and
closures, as `go/path_test.go` does, not as a serialized document with
`@val-bo` references the way `ts/test/fixture.ts` does. The reason is the
section above: closures have no name to collide on, so the fixture's
`val-bo` and the plugin's cannot shadow each other. The engine's builtin
`@val-bo` / `@map-bo` / `@list-bo` / `@pairkey` / `@pair-bc` / `@elem-bc`
have these very semantics, but the serialized form would wire them by
name into the same namespace the plugin writes.

The pair's key action mirrors the TS `@pairkey`: a string-valued token
gives its value, anything else its source text. The capture hook mirrors
`addPathCapture` exactly, including rendering `null` as the text `null`
and an integral number without a fractional part, which is what the
shared fixtures pin.

## The shared node cell

A pushed or replaced rule SHARES its parent's `Rc<RefCell<Value>>`. An
assignment (`r.node = v` in TS) must install a fresh cell:
`rule.node = Rc::new(RefCell::new(v))`, which `fixture::set_node` does.
Borrow the cell mutably only to write into a container the rule genuinely
shares: `pair-bc` inserting into the enclosing map, `elem-bc` pushing onto
the enclosing list. The plugin itself never touches `node`.

## `k` details that differ from TS in mechanics only

- `@map-bo` REMOVES `index` (Go deletes it too); TS sets it to
  `undefined`. `rule.k.get("index")` answers `None` either way a Rust
  caller would check.
- `@elem-ao` starts the index at 0 when the bag holds no number, as Go
  does; TS computes `1 + undefined` (NaN). With a `list` rule setting `-1`
  first, which every conventional grammar has, both give 0.
- `pathDepth` is written, as TS does, and equals the path length. Go
  derives it from `len(path)` instead. It is bookkeeping, not contract.
- Segments are `Value::String` keys and `Value::Number` indices; the
  fixtures pin the rendering, not the type.

## One `meta.path.base` corner where TypeScript differs

`meta.path.base` is documented as an array of segments, and every
runtime copies an array as it is. Given a STRING instead
(`{"path":{"base":"xy"}}`), TypeScript indexes it like an array and
seeds the path with its characters (`["x","y"]`), while this port and
Go treat a non-array base as no base at all (empty path). That is the
canonical code's `base.length` and `base[i]` landing on a string, not a
documented contract, and Go made the same call, so the port follows Go
rather than reproducing it. Verified against the canonical TypeScript,
Go and this crate with the same probe; no shared fixture pins it. If the
contract is ever widened to accept a string, `base_path` in `src/lib.rs`
is the one place to change.

A `null` or `undefined` base segment is carried as `Value::Null` /
`Value::Undefined`, as TypeScript carries it; the fixture's `fmt_key`
renders such a segment as nothing, which is what the TypeScript
template's array join prints.

## The deep-nesting test is slow in the debug profile, and that is the engine

`no_crash_deep_nesting` pins depth 1000, as `stress.test.ts` and
`stress_test.go` do. In a release build it takes milliseconds. Under
`cargo test` (debug assertions on) it takes about a minute, and the whole
of it is `context.rs`'s `same_rule` debug assertion: on EVERY step it
`deep_equal`s every buried frame's `k` bag against the live rule, and
with a path array of O(depth) in each of O(depth) frames that is cubic.
The bare fixture grammar without Path is already quadratic under the
same assertion; Path's per-level array adds the third factor.

Measured (debug / release) with Path installed, `{a:` nested: depth 200
1.1 s / 2 ms, depth 400 5.9 s / 5 ms, depth 800 42 s / 13 ms. Do not
"fix" this by lowering the depth: the depth is the contract, the cost is
the engine's test-profile bookkeeping, and `cargo test --release` is the
fast loop when iterating on that test alone.

## Spec fixtures

`tests/parity_test.rs` is a dozen lines over `tabnas_support::Runner`:
`find_spec_dir` walks up from the crate to `../test/spec`, `dir` runs
every `.tsv` there, and the only path-specific parts are the fixture
grammar, the capture hook, and turning the `opts` column into the parse
META (`parse_with_meta`), which is what `ts/test/parity.test.ts` and
`go/parity_test.go` do with the same column. All four files share the
`input`/`expected`/`opts` header, so nothing is exempt. One instance
serves every row; a parser holds no state between parses, and
`holds_no_state_between_parses` pins that a seeded base path does not
leak into the next parse.

The runner refuses an empty fixture and an empty directory, so a green
run that ran nothing cannot happen here either.

## Version sites

`VERSION` in `src/lib.rs` and `version` in `Cargo.toml` must equal
`ts/package.json` "version"; `tests/version_test.rs` reads all three and
never skips. `make version-rs V=x.y.z` at the repo root rewrites both and
refreshes the crate's own `Cargo.lock` entry, which `ci/rust/run.sh`
checks before running cargo.

## Prose

`README.md` follows [`../docs/STYLE-GUIDE.md`](../docs/STYLE-GUIDE.md):
no em dashes in prose, no first person, no links from it to any
`AGENTS.md`, no project history, none of the phrases in
`.vale/styles/config/vocabularies/Tabnas/reject.txt`. It is in the
gated list `ts/scripts/gated-docs.cjs` produces, so both halves of the
prose gate run on it, and a Rust term Vale's dictionary lacks goes in
`accept.txt` as the style guide describes.

## Running it

`make test-rs` is the fast loop (`cargo test --all-targets`, then
`cargo test --doc`, then clippy). `ci/rust/run.sh` is the full gate and is
what CI runs, from `.github/workflows/rust.yml`: it adds
`cargo fmt --check`, a build, the lockfile check (exempting the three
sibling crates' recorded versions, and restoring the committed lock after
a green run as well as a red one) and the MSRV pin.

The doctests include `README.md` through a `#[cfg(doctest)]` include in
`src/lib.rs`, so every `rust` fence in the README is compiled and run as
written: keep each one a complete `fn main() -> Result<(), Box<dyn
std::error::Error>>` example with no hidden `# ` lines (they render as
garbage on GitHub). `cargo test --doc` lists one `readme_examples (line
N)` entry per fence; `--all-targets` skips them all. The siblings
must be checked out at `../../parser`, `../../support` and `../../json`.
