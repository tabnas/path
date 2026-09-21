# Agents Guide — shared spec fixtures

`spec/*.tsv` holds the cross-runtime conformance fixtures. Every runtime
auto-discovers and runs **every** file in this directory, so a change here
affects TypeScript, Go and Rust together — edit with that in mind.

## Format

Tab-separated, one case per line, with a header row naming the columns.
Blank lines are skipped, and so are comment lines — a line starting with
`#` that contains no tab. (A data row always has at least one tab, so a
`#`-leading source such as a C preprocessor directive still works.)

| Column | Meaning |
|---|---|
| `input` | Source for the test grammar (see ts/test/fixture.ts, go/path_test.go and rs/tests/common/fixture.rs). Escapes `\n` `\r` `\t` `\\` are decoded. |
| `expected` | A JSON value (the parse result), or `ERROR` / `ERROR:<code>` for inputs that must fail. The code is compared **exactly** — it is the error's code, not a substring of its message. |
| `opts` | Optional JSON object of **parse-time meta** — path is configured per parse (e.g. `{"path":{"base":["x","y"]}}`), not by plugin options. |

`expected` and `opts` are **not** escape-decoded — they are raw JSON, so
JSON's own escape rules apply (`"a\nb"` is a string containing a newline).
To put a literal backslash in `input`, write `\\`.

The plugin tracks a path rather than producing a value of its own, so every
runner installs a `capture` hook that writes the tracked path onto each node:
a map gets a `$` property holding `<a,b>`, a scalar becomes `<value:a,b>`,
and lists are left alone (their elements are annotated individually). That
annotated tree is what `expected` pins. The test grammar and the capture hook
live in `ts/test/fixture.ts`, `go/path_test.go` (`installGrammar` /
`addPathCapture`) and `rs/tests/common/fixture.rs` (`install_grammar` /
`add_path_capture`) — keep the three in step.

Results are compared after a JSON round-trip, so key order and the
`OrderedMap` / null-prototype-object representations do not affect the
comparison.

## Who runs what

- TypeScript: `ts/test/parity.test.ts` — `makeRunner(...).dir(...)`.
- Go: `go/parity_test.go` — `support.Runner{...}.Dir(t, dir)`.
- Rust: `rs/tests/parity_test.rs` — `Runner::new_with_row(...).dir(...)`.

All three are a dozen lines holding only what is specific to path: the
grammar and capture plugin the fixtures parse against, and the row's parse
meta. Everything else — finding `test/spec`, reading the file, decoding
escapes, the `ERROR:` contract, the comparison, the `<file>:<line>` in a
failure message — comes from
[`@tabnas/support`](https://github.com/tabnas/support) and its Go and Rust
halves, so the three loaders cannot drift from each other either.

All three discover files by directory listing: adding a `.tsv` here runs it
in every runtime without touching a runner. An empty fixture, and a spec
directory with no fixtures in it, both **fail** — a runner that reports
green having run nothing is indistinguishable from coverage that was never
there.

## Rules

- Prefer adding a fixture here over a one-off in-language assertion when a
  case is expressible as input → output. That is what keeps the runtimes
  honest against each other.
- TypeScript is canonical. If the runtimes disagree, the TS behaviour is
  the expected value — unless a port has exposed a genuine TS defect, in
  which case fix TS first and pin the corrected behaviour here.
- A new fixture must pass in EVERY runtime: run `go test ./...` (from `go/`),
  `npm test` (from `ts/`) and `cargo test --all-targets` (from `rs/`)
  before considering it done.
