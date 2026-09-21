/* Copyright (c) 2022-2026 Richard Rodger and other contributors, MIT License */

// In-language behaviour the shared fixtures cannot express. Mirrors
// go/path_test.go, go/stress_test.go and go/perf_test.go, and the
// TypeScript suites they mirror in turn (ts/test/path.test.ts,
// stress.test.ts, perf.test.ts).

mod common;

use std::sync::{Arc, Mutex};
use std::time::Instant;

use common::fixture::{add_path_capture, fmt_path, install_grammar, new_parser, set_node};
use serde_json::json;
use tabnas::{Tabnas, Value};
use tabnas_support::Value as Fixture;

/// Compare a parse result to a JSON text by value, through the fixture
/// data model, so `1` and `1.0` are the same number and key order does not
/// take part.
fn assert_parse(parser: &Tabnas, src: &str, expected: &str) {
    let value = parser
        .parse(src)
        .unwrap_or_else(|error| panic!("{src}: {error}"));
    assert_eq!(
        Fixture::from(value.to_json()),
        Fixture::parse_json(expected).expect("expected is JSON"),
        "{src}"
    );
}

/// A parser with the grammar, Path and the capture hook.
fn capturing() -> Tabnas {
    let mut parser = new_parser();
    add_path_capture(&mut parser);
    parser
}

#[test]
fn happy() {
    let parser = new_parser();
    assert_parse(&parser, "{a:{b:1,c:[2,3]}}", r#"{"a":{"b":1,"c":[2,3]}}"#);
}

#[test]
fn path_tracking() {
    let parser = capturing();
    assert_parse(
        &parser,
        "{a:{b:1}}",
        r#"{"$":"<>","a":{"$":"<a>","b":"<1:a,b>"}}"#,
    );
}

#[test]
fn meta_base_path() {
    // A base path seeded through the parse meta, read by a hook that
    // annotates only maps.
    let mut parser = new_parser();
    parser.define_rule("val", |spec| {
        spec.add_ac(|rule, _context| {
            let path = tabnas_path::path_of(rule).to_vec();
            if let Some(map) = rule.node.borrow_mut().as_object_mut() {
                map.insert("$".to_string(), Value::String(fmt_path(&path)));
            }
        });
    });

    let meta = Value::from_json(&json!({"path": {"base": ["x", "y"]}}));
    let value = parser.parse_with_meta("{a:1}", meta).expect("parses");
    assert_eq!(
        Fixture::from(value.to_json()),
        Fixture::parse_json(r#"{"$":"<x,y>","a":1}"#).unwrap()
    );
}

#[test]
fn object_paths() {
    let parser = capturing();
    assert_parse(&parser, "{a:1}", r#"{"$":"<>","a":"<1:a>"}"#);
    assert_parse(
        &parser,
        "{a:1,b:B}",
        r#"{"$":"<>","a":"<1:a>","b":"<B:b>"}"#,
    );
}

#[test]
fn nested_object_paths() {
    let parser = capturing();
    assert_parse(
        &parser,
        "{x:{a:1}}",
        r#"{"$":"<>","x":{"$":"<x>","a":"<1:x,a>"}}"#,
    );
    assert_parse(
        &parser,
        "{y:{x:{a:1,b:B}}}",
        r#"{"$":"<>","y":{"$":"<y>","x":{"$":"<y,x>","a":"<1:y,x,a>","b":"<B:y,x,b>"}}}"#,
    );
}

#[test]
fn array_paths() {
    let parser = capturing();
    assert_parse(&parser, "[1]", r#"["<1:0>"]"#);
    assert_parse(&parser, "[1,2,3]", r#"["<1:0>","<2:1>","<3:2>"]"#);
    assert_parse(&parser, "[[1,2]]", r#"[["<1:0,0>","<2:0,1>"]]"#);
    assert_parse(
        &parser,
        "[[[1,2,3]]]",
        r#"[[["<1:0,0,0>","<2:0,0,1>","<3:0,0,2>"]]]"#,
    );
}

#[test]
fn deep_mixed_paths() {
    let parser = capturing();

    // Deep object nesting.
    assert_parse(
        &parser,
        "{a:{b:1,c:{d:{e:2}}},f:4}",
        r#"{"$":"<>","a":{"$":"<a>","b":"<1:a,b>","c":{"$":"<a,c>","d":{"$":"<a,c,d>","e":"<2:a,c,d,e>"}}},"f":"<4:f>"}"#,
    );

    // Mixed objects and arrays.
    assert_parse(
        &parser,
        "[a,[b],{c:1,d:[2,3]}]",
        r#"["<a:0>",["<b:1,0>"],{"$":"<2>","c":"<1:2,c>","d":["<2:2,d,0>","<3:2,d,1>"]}]"#,
    );
}

/// The bag entries themselves, not their rendering: the depth, the key
/// and the index alongside the path.
#[test]
fn writes_path_depth_key_and_index() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let mut parser = new_parser();
    let sink = Arc::clone(&seen);
    parser.define_rule("val", move |spec| {
        spec.add_ac(move |rule, _context| {
            if rule.d == 0 {
                return;
            }
            let get = |name: &str| rule.k.get(name).map(|value| value.to_json());
            sink.lock().unwrap().push((
                get(tabnas_path::PATH),
                get(tabnas_path::PATH_DEPTH),
                get(tabnas_path::KEY),
                get(tabnas_path::INDEX),
            ));
        });
    });

    parser.parse("{a:[x,{b:y}]}").expect("parses");

    let seen = seen.lock().unwrap();
    let rows: Vec<_> = seen
        .iter()
        .map(|(path, depth, key, index)| json!([path, depth, key, index]))
        .collect();
    assert_eq!(
        rows,
        vec![
            json!([["a", 0.0], 2.0, 0.0, 0.0]),       // x
            json!([["a", 1.0, "b"], 3.0, "b", null]), // y: no index inside a map
            json!([["a", 1.0], 2.0, 1.0, 1.0]),       // {b:y}
            json!([["a"], 1.0, "a", null]),           // [x,{b:y}]
        ]
    );
}

/// The TypeScript suite's `path-is-mutable` pins that two values at the
/// same depth share one live pooled array. This port, like Go, hands out
/// a fresh array per level, so the inverse is pinned: the snapshots are
/// the same values, and no two are the same allocation. A caller here
/// may keep a path without copying it.
#[test]
fn path_is_a_fresh_value_per_level() {
    let captured = Arc::new(Mutex::new(Vec::new()));
    let mut parser = new_parser();
    let sink = Arc::clone(&captured);
    parser.define_rule("val", move |spec| {
        spec.add_ac(move |rule, _context| {
            let node = rule.node.borrow().clone();
            if matches!(node, Value::Object(_) | Value::Array(_)) {
                return;
            }
            let Some(Value::Array(live)) = rule.k.get(tabnas_path::PATH).cloned() else {
                panic!("a scalar carries a path");
            };
            sink.lock().unwrap().push((node.to_json(), live));
        });
    });

    parser.parse("{a:1,b:2,c:{d:3}}").expect("parses");

    let captured = captured.lock().unwrap();
    let snaps: Vec<_> = captured
        .iter()
        .map(|(value, path)| json!({"v": value, "p": Value::Array(Arc::clone(path)).to_json()}))
        .collect();
    assert_eq!(
        snaps,
        vec![
            json!({"v": 1.0, "p": ["a"]}),
            json!({"v": 2.0, "p": ["b"]}),
            json!({"v": 3.0, "p": ["c", "d"]}),
        ]
    );
    // a and b are both depth 1; in TypeScript they share one pooled
    // instance. Here each level's path is its own allocation.
    assert!(
        !Arc::ptr_eq(&captured[0].1, &captured[1].1),
        "two depth-1 siblings share one path allocation"
    );
}

#[test]
fn installs_through_use_plugin() {
    let mut parser = Tabnas::new();
    install_grammar(&mut parser);
    parser
        .use_plugin(tabnas_path::plugin(), None)
        .expect("the plugin installs");
    add_path_capture(&mut parser);
    assert_parse(&parser, "{a:[1]}", r#"{"$":"<>","a":["<1:a,0>"]}"#);
}

/// The plugin contributes only lifecycle hooks, never alternates, so it
/// changes nothing about what the host grammar accepts or produces.
#[test]
fn adds_no_alternates() {
    let mut bare = Tabnas::new();
    install_grammar(&mut bare);
    let with_path = new_parser();

    for src in [
        "{a:{b:1,c:[2,3]}}",
        "[1,[2],{x:y}]",
        "x",
        "{}",
        "[]",
        "{a:[]}",
    ] {
        let want = bare.parse(src).expect("the bare grammar parses");
        let got = with_path.parse(src).expect("the hooked grammar parses");
        assert_eq!(
            Fixture::from(got.to_json()),
            Fixture::from(want.to_json()),
            "{src}"
        );
    }
    for src in ["{a", "[1", "a:1", "{a:1 b:2}"] {
        assert_eq!(
            bare.parse(src).unwrap_err().code,
            with_path.parse(src).unwrap_err().code,
            "{src}"
        );
    }
}

/// Installed on a bare engine it declares the five rules empty rather
/// than failing; a grammar can still be layered on afterwards.
#[test]
fn installs_on_a_bare_engine() {
    let mut parser = Tabnas::new();
    tabnas_path::path(&mut parser).expect("installs without a grammar");
    assert!(parser.parse("{a:1}").is_err(), "empty rules accept nothing");
}

/// A base path seeded by one parse's meta does not reach the next parse.
#[test]
fn holds_no_state_between_parses() {
    let parser = capturing();
    let meta = Value::from_json(&json!({"path": {"base": ["x"]}}));
    let seeded = parser.parse_with_meta("{a:1}", meta).expect("parses");
    assert_eq!(
        Fixture::from(seeded.to_json()),
        Fixture::parse_json(r#"{"$":"<x>","a":"<1:x,a>"}"#).unwrap()
    );
    assert_parse(&parser, "{a:1}", r#"{"$":"<>","a":"<1:a>"}"#);
}

/// One instance serves concurrent callers: `Tabnas::parse` takes `&self`
/// and the plugin keeps its state in the per-parse rule bags, so threads
/// sharing an instance see only their own paths.
#[test]
fn a_shared_instance_takes_concurrent_callers() {
    let parser = Arc::new(capturing());
    let threads: Vec<_> = (0..8)
        .map(|n| {
            let parser = Arc::clone(&parser);
            std::thread::spawn(move || {
                let base = format!("t{n}");
                let meta = Value::from_json(&json!({"path": {"base": [base]}}));
                for _ in 0..50 {
                    let value = parser
                        .parse_with_meta("{a:[1]}", meta.clone())
                        .expect("parses");
                    let want = format!(r#"{{"$":"<t{n}>","a":["<1:t{n},a,0>"]}}"#);
                    assert_eq!(
                        Fixture::from(value.to_json()),
                        Fixture::parse_json(&want).unwrap()
                    );
                    assert!(parser.parse("{bad").is_err());
                }
            })
        })
        .collect();
    for thread in threads {
        thread.join().expect("no thread panicked");
    }
}

/// Mirrors TestNoPanicOnEdgeInputs and `no-crash-on-edge-inputs`. A parse
/// may fail, but it must fail cleanly: an error carrying a code, never a
/// panic out of the plugin.
#[test]
fn no_crash_on_edge_inputs() {
    let inputs = [
        "",
        " ",
        "\n",
        "{",
        "}",
        "[",
        "]",
        "[}",
        "{]",
        ":",
        ",",
        "::",
        ",,",
        "{a",
        "{a:",
        "{a:}",
        "{:1}",
        "{a:1",
        "a:1",
        "[1",
        "1,2",
        "[,]",
        "{,}",
        "{a:{b:{c:{d:{e:1}}}}}",
        "[[[[[1]]]]]",
        "[[[[",
        "}}}}",
        "{a:[1,{b:[2]}]}",
        "{a:1,a:2}",
        "{a:1 b:2}",
        "[1 2 3]",
        "{\"a\":1}",
        "{a:b:c:1}",
        "{1:2}",
        "[true,false,null]",
        "{a:[]}",
        "{a:{}}",
        "[{},[]]",
    ];
    for src in inputs {
        let parser = capturing();
        if let Err(error) = parser.parse(src) {
            assert!(
                !error.code.is_empty(),
                "input {src:?} failed without a code"
            );
        }
    }
}

/// Mirrors TestNoPanicDeepNesting and `no-crash-deep-nesting`. There is
/// no pool and no depth ceiling: deep nesting must still yield a full,
/// correct path, and must not exhaust the stack.
#[test]
fn no_crash_deep_nesting() {
    for depth in [1, 8, 64, 200, 1000] {
        let src = format!("{}1{}", "{a:".repeat(depth), "}".repeat(depth));

        let deepest = Arc::new(Mutex::new(None));
        let mut parser = new_parser();
        let sink = Arc::clone(&deepest);
        parser.define_rule("val", move |spec| {
            spec.add_ac(move |rule, _context| {
                if matches!(&*rule.node.borrow(), Value::Number(n) if *n == 1.0) {
                    *sink.lock().unwrap() = Some(tabnas_path::path_of(rule).to_vec());
                }
            });
        });

        parser
            .parse(&src)
            .unwrap_or_else(|error| panic!("depth {depth}: {error}"));

        let want: Vec<Value> = vec![Value::String("a".to_string()); depth];
        assert_eq!(
            deepest.lock().unwrap().as_deref(),
            Some(want.as_slice()),
            "path wrong at depth {depth}"
        );
    }
}

/// Mirrors TestReuseInstanceIsFast and `reuse-instance-is-fast`. The
/// plugin ships no convenience `parse`: a consumer installs it on their
/// own engine. Building that engine dominates a parse of a small input,
/// so reusing ONE instance for N parses must be markedly faster than
/// rebuilding per call; a consumer, or a future convenience wrapper, that
/// rebuilds per call loses that factor and this makes it visible.
///
/// Machine-independent: it compares two timings from the same run, so a
/// slow or shared box moves both sides together. There is deliberately no
/// wall-clock budget.
#[test]
fn reuse_instance_is_fast() {
    let src = "{a:1}";
    let n = 3000;

    // Warm both paths so the comparison is steady-state.
    for _ in 0..50 {
        new_parser().parse(src).expect("warm rebuild parse");
    }
    let shared = new_parser();
    for _ in 0..50 {
        shared.parse(src).expect("warm reuse parse");
    }

    // rebuild-per-call: engine + grammar + plugin every iteration.
    let t0 = Instant::now();
    for _ in 0..n {
        new_parser().parse(src).expect("rebuild parse");
    }
    let rebuild = t0.elapsed();

    // reuse: one instance, N parses.
    let t1 = Instant::now();
    for _ in 0..n {
        shared.parse(src).expect("reuse parse");
    }
    let reuse = t1.elapsed();

    let speedup = rebuild.as_secs_f64() / reuse.as_secs_f64();
    assert!(
        rebuild.as_secs_f64() >= 1.5 * reuse.as_secs_f64(),
        "reusing one instance is not meaningfully faster than rebuilding per \
         parse: {n} reuse parses took {reuse:?} vs {rebuild:?} rebuilding the \
         instance each call (speedup {speedup:.2}x, want >=1.5x). Building the \
         grammar should dominate: reuse one instance instead of new_parser() \
         per parse."
    );
    eprintln!("rebuild-per-call={rebuild:?}  reuse={reuse:?}  speedup={speedup:.2}x");
}

/// The README's tiny example, on the standard JSON grammar rather than the
/// local fixture: the serialized-grammar host the `/append` reference
/// names exist for. `tabnas_json` names its rules `val`/`map`/`pair`/
/// `list`/`elem` and its pair sets `u.pair` and `u.key`, so Path layers
/// on it exactly as `@tabnas/path` layers on `@tabnas/json`.
#[test]
fn layers_on_the_json_grammar() {
    let mut parser = Tabnas::new();
    tabnas_json::json(&mut parser).expect("json installs");
    tabnas_path::path(&mut parser).expect("Path installs after it");
    add_path_capture(&mut parser);

    let value = parser
        .parse(r#"{"a":[1,2],"b":{"c":true}}"#)
        .expect("parses");
    assert_eq!(
        Fixture::from(value.to_json()),
        Fixture::parse_json(
            r#"{"$":"<>","a":["<1:a,0>","<2:a,1>"],"b":{"$":"<b>","c":"<true:b,c>"}}"#
        )
        .unwrap()
    );
    // Still strict JSON: the plugin added no alternates to it.
    assert!(parser.parse("{a:1}").is_err());
}

/// A host grammar that registers its own `@map-bo/append` and
/// `@list-bo/append` references by name, the shape of the jsonic port,
/// keeps them with Path installed: the plugin's `/prepend` references
/// share no name with them, and the engine wires the two slots
/// independently. A name collision would overwrite the host's closures,
/// the counters would stay at zero, and the maps would never be
/// initialised.
#[test]
fn composes_with_a_host_that_registers_append_refs() {
    use std::sync::atomic::{AtomicUsize, Ordering};

    let map_inits = Arc::new(AtomicUsize::new(0));
    let list_inits = Arc::new(AtomicUsize::new(0));

    let mut parser = Tabnas::new();
    install_grammar(&mut parser);
    // The host's own lifecycle references, registered by name and wired
    // by re-declaring the rules, as a serialized grammar does.
    let counter = Arc::clone(&map_inits);
    parser.state_action_ref("@map-bo/append", move |_rule, _context| {
        counter.fetch_add(1, Ordering::SeqCst);
        Ok(())
    });
    let counter = Arc::clone(&list_inits);
    parser.state_action_ref("@list-bo/append", move |_rule, _context| {
        counter.fetch_add(1, Ordering::SeqCst);
        Ok(())
    });
    let host = tabnas::GrammarSpec::from_json(r#"{"rule": {"map": {}, "list": {}}}"#).unwrap();
    parser.grammar(&host).expect("the host document installs");

    tabnas_path::path(&mut parser).expect("Path installs after the host");
    add_path_capture(&mut parser);

    assert_parse(
        &parser,
        "{a:[1,{b:2}]}",
        r#"{"$":"<>","a":["<1:a,0>",{"$":"<a,1>","b":"<2:a,1,b>"}]}"#,
    );
    assert_eq!(
        map_inits.load(Ordering::SeqCst),
        2,
        "the host's map-bo ran per map"
    );
    assert_eq!(
        list_inits.load(Ordering::SeqCst),
        1,
        "the host's list-bo ran per list"
    );
}

/// Scalars that are not maps or lists, including null, render the way the
/// TypeScript template interpolates them.
#[test]
fn null_and_booleans_carry_paths() {
    let parser = capturing();
    assert_parse(
        &parser,
        "[true,false,null]",
        r#"["<true:0>","<false:1>","<null:2>"]"#,
    );
    let mut parser = new_parser();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    parser.define_rule("val", move |spec| {
        spec.add_ac(move |rule, _context| {
            if rule.d > 0 {
                let path = tabnas_path::path_of(rule).to_vec();
                let node = rule.node.borrow().clone();
                sink.lock().unwrap().push((node.to_json(), path.len()));
                set_node(rule, node);
            }
        });
    });
    parser.parse("{a:null}").expect("parses");
    assert_eq!(*seen.lock().unwrap(), vec![(serde_json::Value::Null, 1)]);
}
