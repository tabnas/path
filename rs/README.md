# tabnas-path (Rust)

Property-path tracking plugin for the
[`tabnas`](https://github.com/tabnas/parser) parsing engine, crate
`tabnas_path`.

It tracks the **property path**, the chain of map keys and array indices
leading from the root to each value, as a document is parsed, and records
it in the parser's per-rule `k` bag, where your own rule actions can read
it. It computes nothing visible on its own: the plugin adds no alternates
and changes nothing about what the host grammar parses.

This is the Rust port of the canonical TypeScript implementation in
[`../ts`](../ts); the TypeScript version is authoritative and this crate
tracks it. The Go port is in [`../go`](../go).

## Use

The engine ships no grammar of its own. Bring a grammar that defines the
`val` / `map` / `pair` / `list` / `elem` rules (here `tabnas-json`),
install it first, then Path on top, then read the path from a rule action
of your own. This example tags every scalar `<value:path>`:

```rust
use tabnas::{Tabnas, Value};

// A key or scalar as text: keys as themselves, numbers without a
// fractional part, anything else as JSON.
fn text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => format!("{number}"),
        other => other.to_json().to_string(),
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut parser = Tabnas::new();
    tabnas_json::json(&mut parser)?;
    tabnas_path::path(&mut parser)?;

    parser.define_rule("val", |spec| {
        spec.add_ac(|rule, _ctx| {
            let scalar = match &*rule.node.borrow() {
                Value::Object(_) | Value::Array(_) => None,
                other => Some(text(other)),
            };
            if let Some(value) = scalar {
                let segments: Vec<String> =
                    tabnas_path::path_of(rule).iter().map(text).collect();
                let tagged = format!("<{value}:{}>", segments.join(","));
                rule.node = std::rc::Rc::new(std::cell::RefCell::new(Value::String(tagged)));
            }
        });
    });

    let out = parser.parse(r#"{"a":[1,2]}"#)?;
    assert_eq!(
        out.to_json(),
        serde_json::json!({"a": ["<1:a,0>", "<2:a,1>"]})
    );
    Ok(())
}
```

Value `1` lives at path `a, 0` (key `a`, then index `0`). Every Rust
example on this page runs as a doctest of the crate, so it stays true.

The plugin writes these `k` entries, and nothing else:

| key | value |
|---|---|
| `path` (`tabnas_path::PATH`) | a `Value::Array` of segments: map keys as `Value::String`, array indices as `Value::Number` |
| `pathDepth` (`tabnas_path::PATH_DEPTH`) | the number of segments |
| `key` (`tabnas_path::KEY`) | the last segment |
| `index` (`tabnas_path::INDEX`) | the current element index inside a list, `-1` before the first element |

`tabnas_path::path_of(rule)` reads the path as a slice. The root value has
an empty path unless the parse meta seeds one:

```rust
use tabnas::{Tabnas, Value};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut parser = Tabnas::new();
    tabnas_json::json(&mut parser)?;
    tabnas_path::path(&mut parser)?;

    // Replace every scalar with its path.
    parser.define_rule("val", |spec| {
        spec.add_ac(|rule, _ctx| {
            let scalar = !matches!(&*rule.node.borrow(), Value::Object(_) | Value::Array(_));
            if scalar {
                let path = Value::array(tabnas_path::path_of(rule).to_vec());
                rule.node = std::rc::Rc::new(std::cell::RefCell::new(path));
            }
        });
    });

    let meta = Value::from_json(&serde_json::json!({"path": {"base": ["x", "y"]}}));
    let out = parser.parse_with_meta(r#"{"a":1}"#, meta)?;
    assert_eq!(out.to_json(), serde_json::json!({"a": ["x", "y", "a"]}));
    Ok(())
}
```

The plugin is also available as a `tabnas::Plugin`, for
`parser.use_plugin(tabnas_path::plugin(), None)`.

## Install

The `tabnas` crate is not published to a registry, so the engine is
consumed as a **sibling checkout**, the standard tabnas development
model. Clone `https://github.com/tabnas/parser` next to this repository
and point at it:

```toml
[dependencies]
tabnas-path = { path = "../path/rs" }
tabnas = { path = "../parser/rs" }
```

Both entries are needed. A crate's dependencies are not passed on to its
dependents, so `tabnas-path` alone does not put `tabnas` in your extern
prelude, and the examples above that name `tabnas::Tabnas` would not
resolve. Only `PathError` (the engine's `TabnasError`) is re-exported.

The engine is the crate's only dependency. The test suite also uses two
sibling checkouts, `https://github.com/tabnas/support` (the shared fixture
runner) and `https://github.com/tabnas/json` (the grammar the example
above runs on), as dev-dependencies.

## Differences from the canonical TypeScript

Three, all deliberate, and none changes the path a value gets on the
conventional rule set:

- **Each level's path is a fresh array.** TypeScript pools one array per
  depth and mutates it in place, so its callers must copy a path they
  keep. This crate, like the Go port, builds a new `Value::Array` per
  level, so a path read from the bag is an owned value and there is
  nothing to copy.
- **The child's path is set from the child's side.** TypeScript writes
  the child's `k` from the parent's `@pair-ao` and `@elem-ao` hooks. This
  engine hands a parent's after-open hook the child only as an immutable
  snapshot, and clones the child's `k` bag from the parent's before that
  hook runs, so the parent cannot write it. The port does the same work
  in the child's `@val-bo` hook instead, reading the parent's snapshot.
  Where `pair` and `elem` push `val`, as the conventional rule set does,
  the result is identical. A host grammar whose `pair` or `elem` pushes a
  rule of another name gets no path on that child here, where TypeScript
  would set one.
- **The hooks are `/prepend` references.** Function references are one
  instance-wide namespace in this engine, so a name the host grammar also
  registers is overwritten and only one of the two hooks runs. The bare
  `@val-bo`, `@map-bo` and `@list-bo` are also the names of hooks the
  engine provides itself, and the jsonic port registers `@map-bo/append`
  and `@list-bo/append`, so the plugin registers `@val-bo/prepend`,
  `@map-bo/prepend`, `@list-bo/prepend` and `@elem-ao/prepend`. The
  engine wires a `/prepend` reference without touching the phase's other
  hooks, so a host installed before or after Path keeps its own. The
  hooks run first in their phase where TypeScript's run last; for `val`
  that matches the canonical order, where the path is already set when
  the child's `bo` hooks run, and the other three touch only `k`. A host
  that registers one of those four `/prepend` names itself, or a
  `/replace` reference for one of those four phases, loses one hook.

## Build and test

The engine and the two test-only crates are path dependencies on sibling
checkouts, so there is nothing to fetch:

```bash
cargo test --all-targets
```

Or, from the repository root, `make test-rs`. For what CI would say,
including formatting, doctests and the lockfile check, run
`ci/rust/run.sh`.

The suite runs the shared `../test/spec/*.tsv` conformance fixtures, the
same files the TypeScript and Go suites run, through the `tabnas-support`
runner, plus the in-language cases the fixtures cannot express: the bag
entries, instance reuse, concurrent callers, malformed input, and nesting
one thousand levels deep.

## License

MIT.
