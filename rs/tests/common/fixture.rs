/* Copyright (c) 2022-2026 Richard Rodger and other contributors, MIT License */

//! The test grammar and path-capture hook shared by the suites. Its twins
//! are `Grammar` / `capture` in `ts/test/fixture.ts` and `installGrammar`
//! / `addPathCapture` in `go/path_test.go`; keep the three in step.
//!
//! The grammar is deliberately minimal: brace maps with bare (unquoted)
//! keys, bracket lists, and scalar values, just enough nested structure
//! to exercise the Path plugin. The engine ships no grammar of its own,
//! so the tests bring their own, and this one depends on nothing but the
//! engine. The rule names (val/map/pair/list/elem) are the ones Path
//! hooks.
//!
//! It is built imperatively, as the Go fixture is, rather than as a
//! serialized document with `@val-bo` references the way the TypeScript
//! fixture is. Function references are one instance-wide namespace in
//! this engine, so a host grammar registering `@val-bo` by name and a
//! plugin registering the same name would collide; closures installed
//! through `define_rule` have no name to collide on.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use tabnas::{
    AltSpec, Rule, Tabnas, Tin, Value, TIN_CA, TIN_CB, TIN_CL, TIN_CS, TIN_OB, TIN_OS, TIN_ZZ,
};

/// The engine's default `#VAL` / `#KEY` token sets.
fn token_set(parser: &Tabnas, name: &str) -> Vec<Tin> {
    parser
        .token_set(name)
        .unwrap_or_else(|| panic!("engine default token set {name} is missing"))
}

/// Assign a rule's node. A pushed or replaced rule shares its parent's
/// node cell, so an assignment installs a fresh cell rather than writing
/// through the shared one.
pub fn set_node(rule: &mut Rule, value: Value) {
    rule.node = Rc::new(RefCell::new(value));
}

/// Install the local grammar.
pub fn install_grammar(parser: &mut Tabnas) {
    let val_set = token_set(parser, "VAL");
    let key_set = token_set(parser, "KEY");

    // val: a map, a list, or a scalar token.
    parser.define_rule("val", move |spec| {
        spec.add_bo(|rule, _context| set_node(rule, Value::Undefined));
        spec.add_bc(|rule, context| {
            if !rule.node.borrow().is_undefined() {
                return;
            }
            if !rule.child_node.is_undefined() {
                let child = rule.child_node.clone();
                set_node(rule, child);
                return;
            }
            if rule.os() == 0 {
                set_node(rule, Value::Undefined);
                return;
            }
            let value = rule.resolve_open_value(0, context);
            set_node(rule, value);
        });
        spec.add_open(AltSpec {
            s: vec![vec![TIN_OB]],
            p: Some("map".into()),
            b: 1,
            ..Default::default()
        })
        .add_open(AltSpec {
            s: vec![vec![TIN_OS]],
            p: Some("list".into()),
            b: 1,
            ..Default::default()
        })
        .add_open(AltSpec {
            s: vec![val_set],
            ..Default::default()
        })
        .add_close(AltSpec {
            s: vec![vec![TIN_ZZ]],
            ..Default::default()
        })
        .add_close(AltSpec {
            b: 1,
            ..Default::default()
        });
    });

    // map: `{ k: v, ... }`.
    parser.define_rule("map", |spec| {
        spec.add_bo(|rule, _context| set_node(rule, Value::Object(Default::default())));
        spec.add_open(AltSpec {
            s: vec![vec![TIN_OB], vec![TIN_CB]],
            b: 1,
            ..Default::default()
        })
        .add_open(AltSpec {
            s: vec![vec![TIN_OB]],
            p: Some("pair".into()),
            ..Default::default()
        })
        .add_close(AltSpec {
            s: vec![vec![TIN_CB]],
            ..Default::default()
        });
    });

    // list: `[ a, b, ... ]`.
    parser.define_rule("list", |spec| {
        spec.add_bo(|rule, _context| set_node(rule, Value::array(Vec::new())));
        spec.add_open(AltSpec {
            s: vec![vec![TIN_OS], vec![TIN_CS]],
            b: 1,
            ..Default::default()
        })
        .add_open(AltSpec {
            s: vec![vec![TIN_OS]],
            p: Some("elem".into()),
            ..Default::default()
        })
        .add_close(AltSpec {
            s: vec![vec![TIN_CS]],
            ..Default::default()
        });
    });

    // pair: a `key: value` entry inside a map. The pair shares the map's
    // node cell, so the entry is written through it.
    parser.define_rule("pair", move |spec| {
        spec.add_bc(|rule, _context| {
            if !rule.u.contains_key("pair") {
                return;
            }
            let Some(Value::String(key)) = rule.u.get("key").cloned() else {
                return;
            };
            let child = rule.child_node.clone();
            let value = if child.is_undefined() {
                Value::Null
            } else {
                child
            };
            if let Some(map) = rule.node.borrow_mut().as_object_mut() {
                map.insert(key, value);
            }
        });

        // `@pairkey`: a quoted or bare key is its value, anything else its
        // source text.
        let mut open = AltSpec {
            s: vec![key_set, vec![TIN_CL]],
            p: Some("val".into()),
            u: HashMap::from([("pair".to_string(), Value::Bool(true))]),
            ..Default::default()
        };
        open.add_action(|rule, _context| {
            let Some(token) = rule.o0() else { return };
            let key = match &token.val {
                Value::String(text) => text.clone(),
                _ => token.src.to_string(),
            };
            rule.u_mut().insert("key".to_string(), Value::String(key));
        });

        spec.add_open(open)
            .add_close(AltSpec {
                s: vec![vec![TIN_CA]],
                r: Some("pair".into()),
                ..Default::default()
            })
            .add_close(AltSpec {
                s: vec![vec![TIN_CB]],
                b: 1,
                ..Default::default()
            });
    });

    // elem: a value inside a list, appended through the shared list cell.
    parser.define_rule("elem", |spec| {
        spec.add_bc(|rule, _context| {
            if rule.child_node.is_undefined() {
                return;
            }
            let child = rule.child_node.clone();
            if let Some(items) = rule.node.borrow_mut().as_array_mut() {
                items.push(child);
            }
        });
        spec.add_open(AltSpec {
            p: Some("val".into()),
            ..Default::default()
        })
        .add_close(AltSpec {
            s: vec![vec![TIN_CA]],
            r: Some("elem".into()),
            ..Default::default()
        })
        .add_close(AltSpec {
            s: vec![vec![TIN_CS]],
            b: 1,
            ..Default::default()
        });
    });
}

/// A parser with the local grammar and the Path plugin. The grammar is
/// installed first so the plugin's hooks wire onto the existing rules.
pub fn new_parser() -> Tabnas {
    let mut parser = Tabnas::new();
    install_grammar(&mut parser);
    tabnas_path::path(&mut parser).expect("the Path grammar document is fixed and valid");
    parser
}

/// Annotate nodes with their tracked path: a map gets a `$` property
/// holding `<a,b>`, a scalar becomes `<value:a,b>`, and a list is left
/// alone (its elements are annotated individually). That annotated tree
/// is what the shared fixtures pin.
pub fn add_path_capture(parser: &mut Tabnas) {
    parser.define_rule("val", |spec| {
        spec.add_ac(|rule, _context| {
            let path = tabnas_path::path_of(rule).to_vec();
            let shape = match &*rule.node.borrow() {
                Value::Object(_) | Value::MapRef(_) => Shape::Map,
                Value::Array(_) | Value::ListRef(_) => Shape::List,
                _ => Shape::Scalar,
            };
            match shape {
                Shape::Map => {
                    if let Some(map) = rule.node.borrow_mut().as_object_mut() {
                        map.insert("$".to_string(), Value::String(fmt_path(&path)));
                    }
                }
                Shape::List => {}
                Shape::Scalar => {
                    let value = rule.node.borrow().clone();
                    set_node(rule, Value::String(fmt_val_path(&value, &path)));
                }
            }
        });
    });
}

enum Shape {
    Map,
    List,
    Scalar,
}

/// `<a,b,c>`.
pub fn fmt_path(path: &[Value]) -> String {
    format!("<{}>", join(path))
}

/// `<value:a,b>`.
pub fn fmt_val_path(value: &Value, path: &[Value]) -> String {
    format!("<{}:{}>", fmt_val(value), join(path))
}

fn join(path: &[Value]) -> String {
    path.iter().map(fmt_key).collect::<Vec<_>>().join(",")
}

/// A segment as the TypeScript template renders it: a key as itself, an
/// index without a fractional part, and a null or undefined segment (only
/// a seeded base path can hold one) as nothing, which is what an array
/// join does there.
pub fn fmt_key(segment: &Value) -> String {
    match segment {
        Value::String(text) => text.clone(),
        Value::Number(number) => fmt_number(*number),
        Value::Null | Value::Undefined => String::new(),
        other => other.to_json().to_string(),
    }
}

/// A scalar as the TypeScript template interpolates it.
pub fn fmt_val(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => fmt_number(*number),
        Value::Bool(flag) => flag.to_string(),
        Value::Null => "null".to_string(),
        Value::Undefined => "undefined".to_string(),
        other => other.to_json().to_string(),
    }
}

fn fmt_number(number: f64) -> String {
    if number.fract() == 0.0 && number.is_finite() {
        format!("{}", number as i64)
    } else {
        format!("{number}")
    }
}
