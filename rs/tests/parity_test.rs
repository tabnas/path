// Cross-runtime conformance, driven by the shared `test/spec/*.tsv`
// fixtures at the repo root (see ../../test/AGENTS.md).
//
// The fixture loader, the escape codec, the `ERROR:<code>` contract and
// the row loop all come from tabnas-support, whose TypeScript and Go
// halves `ts/test/parity.test.ts` and `go/parity_test.go` use to run the
// SAME files, so the three implementations cannot drift without one of
// them going red, and neither can the loaders.
//
// What is left here is only what is specific to path: the grammar and the
// capture hook the fixtures parse against, and the row's parse meta.

mod common;

use std::path::Path;

use common::fixture::{add_path_capture, new_parser};
use tabnas_support::{find_spec_dir, Failure, Runner, Value};

/// Every fixture in the spec directory. `find_spec_dir` walks up from the
/// crate to the repo root's `test/spec`, and `dir` discovers the files by
/// listing, so adding a .tsv runs it in every runtime without touching a
/// runner. All four files share one column shape (`input`, `expected`,
/// `opts`), so none is exempt.
#[test]
fn spec() {
    let dir = find_spec_dir(Some(Path::new(env!("CARGO_MANIFEST_DIR")))).expect("test/spec");

    // path has no grammar of its own: it annotates whatever grammar it is
    // installed into. The local grammar plays that part in every runtime,
    // and the capture hook collects what the fixture asserts against. One
    // instance serves every row: the meta is per parse, and a parser holds
    // no state between parses.
    let mut parser = new_parser();
    add_path_capture(&mut parser);

    Runner::new_with_row(move |input, row| {
        // The opts column is the parse META, not plugin options: a fixture
        // sets the base path the tracked path starts from.
        let opts = row.named("opts");
        let meta = if opts.trim().is_empty() {
            tabnas::Value::Undefined
        } else {
            let json: serde_json::Value = serde_json::from_str(opts)
                .map_err(|error| Failure::message(format!("opts is not JSON: {error}")))?;
            tabnas::Value::from_json(&json)
        };

        parser
            .parse_with_meta(input, meta)
            .map(|value| Value::from(value.to_json()))
            .map_err(|error| Failure::new(error.code.clone()).with_message(error.to_string()))
    })
    .dir(&dir);
}
