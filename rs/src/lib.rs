/* Copyright (c) 2022-2026 Richard Rodger and other contributors, MIT License */

//! Property-path tracking for the `tabnas` parsing engine.
//!
//! This is a behaviour plugin, not a grammar plugin. It tracks the
//! **property path**, the chain of map keys and array indices leading to
//! each value as it is parsed, and records it in the parser's per-rule
//! `k` bag, where other rule actions can read it. It computes nothing
//! visible on its own: install it on a grammar that defines the
//! conventional `val` / `map` / `pair` / `list` / `elem` rules, then read
//! the path from a rule action of your own.
//!
//! This is the Rust port of the canonical TypeScript implementation in
//! `ts/src/path.ts`; the Go port is `go/path.go`.
//!
//! ```
//! use tabnas::{Tabnas, Value};
//!
//! let mut parser = Tabnas::new();
//! tabnas_json::json(&mut parser)?;   // any grammar with val/map/pair/list/elem
//! tabnas_path::path(&mut parser)?;   // the grammar first, then Path
//!
//! // A key or scalar as text: keys as themselves, numbers without a
//! // fractional part, anything else as JSON.
//! fn text(value: &Value) -> String {
//!     match value {
//!         Value::String(text) => text.clone(),
//!         Value::Number(number) => format!("{number}"),
//!         other => other.to_json().to_string(),
//!     }
//! }
//!
//! // Read the path from a rule action: tag every scalar `<value:path>`.
//! parser.define_rule("val", |spec| {
//!     spec.add_ac(|rule, _ctx| {
//!         let scalar = match &*rule.node.borrow() {
//!             Value::Object(_) | Value::Array(_) => None,
//!             other => Some(text(other)),
//!         };
//!         if let Some(value) = scalar {
//!             let segments: Vec<String> =
//!                 tabnas_path::path_of(rule).iter().map(text).collect();
//!             let tagged = format!("<{value}:{}>", segments.join(","));
//!             rule.node = std::rc::Rc::new(std::cell::RefCell::new(Value::String(tagged)));
//!         }
//!     });
//! });
//!
//! let out = parser.parse(r#"{"a":[1,2]}"#)?;
//! assert_eq!(
//!     out.to_json(),
//!     serde_json::json!({"a": ["<1:a,0>", "<2:a,1>"]})
//! );
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```
//!
//! # What it writes
//!
//! Only these `k` entries, on the rules of the host grammar:
//!
//! | key | value |
//! |---|---|
//! | [`PATH`] | a [`Value::Array`] of segments: map keys as strings, array indices as numbers |
//! | [`PATH_DEPTH`] | the number of segments |
//! | [`KEY`] | the last segment |
//! | [`INDEX`] | the current element index inside a list, `-1` before the first element |
//!
//! The `k` bag propagates from a rule to the rules it pushes and to the
//! rule that replaces it, so a value deep in the tree sees the whole
//! path above it. The root value has an empty path unless the parse meta
//! seeds one: `parser.parse_with_meta(src, meta)` with
//! `meta.path.base` set to an array of segments.
//!
//! Each level's path is a fresh [`Value::Array`], as in the Go port. The
//! TypeScript implementation pools and mutates one array per depth, so
//! its callers must copy a path they keep; here a path read from the
//! bag is an owned value.
//!
//! # How the child's path is set
//!
//! The canonical implementation sets the child's path from the parent's
//! `@pair-ao` / `@elem-ao` hooks (`r.child.k.path = ...`). This engine
//! hands a parent's after-open hook the child only as an immutable
//! snapshot, and the child's `k` bag is cloned from the parent's before
//! that hook runs, so a parent cannot write the child's bag. The port
//! therefore does the same work one step later, in the child's own
//! `@val-bo` hook, reading the parent rule's snapshot (which the engine
//! refreshes after the parent's `ao` phase). The observable `k` values
//! are the same for the conventional rule set, where `pair` and `elem`
//! push `val`. See the crate README for what that means for a host
//! grammar whose `pair` or `elem` pushes a rule of another name.

use tabnas::{
    Context, GrammarError, GrammarSpec, Plugin, PluginError, Rule, RuleSnapshot, Tabnas, Value,
};

/// This crate's version. It MUST equal `ts/package.json` "version": the
/// release orchestrator rewrites both, and `tests/version_test.rs` fails
/// the build if they drift. Mirrors `VERSION` in `ts/src/path.ts` and
/// `const VERSION` in `go/path.go`.
pub const VERSION: &str = "0.3.9";

/// The README's Rust examples run as doctests, so a stale one fails the
/// gate rather than misleading the reader. Its `toml` and `bash` fences
/// are skipped; rustdoc runs only the `rust` ones.
#[cfg(doctest)]
#[doc = include_str!("../README.md")]
mod readme_examples {}

/// The error a failed parse produces, re-exported so callers need not
/// depend on the engine crate directly. The plugin itself raises no
/// errors and declares no error codes: it contributes only lifecycle
/// hooks, never alternates, so any error a parse raises comes from the
/// engine or the host grammar.
pub use tabnas::TabnasError as PathError;

/// The host-grammar rules the plugin hooks. The engine ships no grammar
/// of its own, so these names must match the rules supplied by whatever
/// grammar plugin the consumer installs; the standard
/// value/map/pair/list/elem rule set uses these names.
pub const HOOKED_RULES: [&str; 5] = ["val", "map", "pair", "list", "elem"];

/// The `k` key holding the path: a [`Value::Array`] of segments.
pub const PATH: &str = "path";
/// The `k` key holding the number of segments in [`PATH`].
pub const PATH_DEPTH: &str = "pathDepth";
/// The `k` key holding the last segment: the map key or array index of
/// the current value.
pub const KEY: &str = "key";
/// The `k` key holding the current element index inside a list.
pub const INDEX: &str = "index";

/// The lifecycle references the plugin registers. They carry the
/// engine's `/prepend` suffix rather than the bare `@<rule>-<phase>`
/// name, for reasons that are all specific to this engine:
///
/// - Function references are one instance-wide namespace here, looked
///   up by name at parse time, where the TypeScript engine resolves each
///   `grammar()` call's `ref` map on its own. A name a host grammar also
///   registers is overwritten, and the engine wires each name once, so
///   one of the two hooks is lost. The bare names collide with a host
///   that registers them; the `/append` names collide with the jsonic
///   port, which registers `@map-bo/append` and `@list-bo/append`.
/// - `@val-bo`, `@map-bo` and `@list-bo` are also the names of engine
///   builtins, which a named action resolves to before any reference
///   registered through `state_action_ref`.
/// - The engine wires a `/prepend` reference on its own, without
///   touching the phase's base or `/append` slot, so a host grammar
///   installed before or after Path keeps its own hook either way.
///
/// The hooks run first in their phase where TypeScript's run last. That
/// is closer to the canonical order for `val`: there the parent set the
/// child's path before the child's `bo` ran, so a host `val-bo` sees the
/// path, as it does here. The other three hooks touch only `k`, which no
/// host hook of the same phase reads.
const VAL_BO: &str = "@val-bo/prepend";
const MAP_BO: &str = "@map-bo/prepend";
const LIST_BO: &str = "@list-bo/prepend";
const ELEM_AO: &str = "@elem-ao/prepend";

/// The grammar document: the hooked rules, declared empty. An empty
/// entry extends an existing rule with nothing, and re-installing it is
/// what makes the engine wire any registered `@<rule>-<phase>` reference
/// as a state action, without touching the host grammar's alternates.
const GRAMMAR: &str = r#"{
  "rule": { "val": {}, "map": {}, "pair": {}, "list": {}, "elem": {} }
}"#;

/// The tracked path of a rule, as a slice of segments: map keys as
/// [`Value::String`], array indices as [`Value::Number`]. Empty for a rule
/// carrying no path (the root, or a rule reached before the plugin ran).
///
/// Takes a snapshot so it reads a parent's path as readily as the current
/// rule's; a `&Rule` coerces to one.
pub fn path_of(rule: &RuleSnapshot) -> &[Value] {
    match rule.k.get(PATH) {
        Some(Value::Array(segments)) => segments,
        _ => &[],
    }
}

/// Install the plugin: register the lifecycle hooks and declare the
/// hooked rules so the engine wires them.
///
/// Install the host grammar first, then Path, so the hooks land on rules
/// that already exist. Installed on a bare engine it creates the five
/// rules empty, and a grammar installed afterwards extends them.
///
/// ```
/// let mut parser = tabnas::Tabnas::new();
/// tabnas_json::json(&mut parser).unwrap();
/// tabnas_path::path(&mut parser).unwrap();
/// // The plugin adds no alternates, so the grammar parses as before.
/// assert_eq!(
///     parser.parse(r#"{"a":[1,2]}"#).unwrap().to_json(),
///     serde_json::json!({"a": [1.0, 2.0]})
/// );
/// ```
pub fn path(parser: &mut Tabnas) -> Result<(), GrammarError> {
    parser.state_action_ref(VAL_BO, val_before_open);
    parser.state_action_ref(MAP_BO, map_before_open);
    parser.state_action_ref(LIST_BO, list_before_open);
    parser.state_action_ref(ELEM_AO, elem_after_open);

    let spec = GrammarSpec::from_json(GRAMMAR)?;
    parser.grammar(&spec)?;
    Ok(())
}

/// The plugin as a [`Plugin`], for `Tabnas::use_plugin`. Named `Path`,
/// as the TypeScript export is; it takes no options.
///
/// ```
/// let mut parser = tabnas::Tabnas::new();
/// tabnas_json::json(&mut parser).unwrap();
/// parser.use_plugin(tabnas_path::plugin(), None).unwrap();
/// ```
pub fn plugin() -> Plugin {
    Plugin::new("Path", |parser, _options| {
        path(parser).map_err(|error| PluginError(error.to_string()))
    })
}

/// `@val-bo`. At the top level, seed the path: empty, or the base path
/// the parse meta carries at `meta.path.base`. Below the top level,
/// adopt the path the pushing `pair` or `elem` rule has for this value.
fn val_before_open(rule: &mut Rule, context: &mut Context) -> Result<(), tabnas::ActionError> {
    if rule.d == 0 {
        let base = base_path(&context.meta);
        let depth = base.len();
        let bag = rule.k_mut();
        bag.insert(PATH.to_string(), Value::array(base));
        bag.insert(PATH_DEPTH.to_string(), Value::Number(depth as f64));
        return Ok(());
    }

    // The parent rule's snapshot, taken after its `ao` phase ran, so an
    // index `@elem-ao` just advanced is the one read here.
    let Some(parent) = rule.parent_rule.clone() else {
        return Ok(());
    };
    // Mirrors the canonical `0 < r.d` guard on the pair and elem rules:
    // the path only starts once the top-level implicit is set up.
    if parent.d == 0 {
        return Ok(());
    }

    match parent.name.as_str() {
        "pair" if truthy(parent.u.get("pair")) => {
            let key = parent.u.get(KEY).cloned().unwrap_or(Value::Undefined);
            adopt(rule, &parent, key.clone(), key, None);
        }
        "elem" => {
            let index = parent.k.get(INDEX).cloned().unwrap_or(Value::Undefined);
            adopt(rule, &parent, index.clone(), index.clone(), Some(index));
        }
        _ => {}
    }
    Ok(())
}

/// `@map-bo`. Not in an array, so no element index to track.
fn map_before_open(rule: &mut Rule, _context: &mut Context) -> Result<(), tabnas::ActionError> {
    if rule.k.contains_key(INDEX) {
        rule.k_mut().remove(INDEX);
    }
    Ok(())
}

/// `@list-bo`. In an array, the path property is the element index,
/// which starts before the first element.
fn list_before_open(rule: &mut Rule, _context: &mut Context) -> Result<(), tabnas::ActionError> {
    rule.k_mut().insert(INDEX.to_string(), Value::Number(-1.0));
    Ok(())
}

/// `@elem-ao`. Advance the element index. The pushed `val` reads it from
/// this rule's snapshot in its own `@val-bo`.
fn elem_after_open(rule: &mut Rule, _context: &mut Context) -> Result<(), tabnas::ActionError> {
    if rule.d == 0 {
        return Ok(());
    }
    let next = match rule.k.get(INDEX) {
        Some(Value::Number(index)) => index + 1.0,
        _ => 0.0,
    };
    rule.k_mut().insert(INDEX.to_string(), Value::Number(next));
    Ok(())
}

/// Write the child's entries: the parent's path plus one segment, its
/// depth, the key, and (inside a list) the index.
fn adopt(rule: &mut Rule, parent: &RuleSnapshot, segment: Value, key: Value, index: Option<Value>) {
    let mut segments = path_of(parent).to_vec();
    segments.push(segment);
    let depth = segments.len();
    let bag = rule.k_mut();
    bag.insert(PATH.to_string(), Value::array(segments));
    bag.insert(PATH_DEPTH.to_string(), Value::Number(depth as f64));
    bag.insert(KEY.to_string(), key);
    if let Some(index) = index {
        bag.insert(INDEX.to_string(), index);
    }
}

/// `meta.path.base` as segments, or none.
fn base_path(meta: &Value) -> Vec<Value> {
    let Value::Object(meta) = meta else {
        return Vec::new();
    };
    let Some(Value::Object(path)) = meta.get("path") else {
        return Vec::new();
    };
    match path.get("base") {
        Some(Value::Array(segments)) => segments.to_vec(),
        _ => Vec::new(),
    }
}

/// JavaScript truthiness, for the `r.u.pair` guard.
fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Undefined) | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => *number != 0.0 && !number.is_nan(),
        Some(Value::String(text)) => !text.is_empty(),
        Some(_) => true,
    }
}
