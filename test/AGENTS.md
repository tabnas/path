# Agents Guide — shared spec fixtures

`spec/*.tsv` holds the cross-runtime conformance fixtures. Both runtimes
auto-discover and run **every** file in this directory, so a change here
affects TypeScript and Go together — edit with that in mind.

## Format

Tab-separated, one case per line, with a header row naming the columns.
Blank lines are skipped, and so are comment lines — a line starting with
`#` that contains no tab. (A data row always has at least one tab, so a
`#`-leading source such as a C preprocessor directive still works.)

| Column | Meaning |
|---|---|
| `input` | Source for the test grammar (see ts/test/fixture.ts and go/path_test.go). Escapes `\n` `\r` `\t` `\\` are decoded. |
| `expected` | A JSON value (the parse result), or `ERROR` / `ERROR:<substring>` for inputs that must fail. |
| `opts` | Optional JSON object of **parse-time meta** — path is configured per parse (e.g. `{"path":{"base":["x","y"]}}`), not by plugin options. |

`expected` and `opts` are **not** escape-decoded — they are raw JSON, so
JSON's own escape rules apply (`"a\nb"` is a string containing a newline).
To put a literal backslash in `input`, write `\\`.

The plugin tracks a path rather than producing a value of its own, so both
runners install a `capture` hook that writes the tracked path onto each node:
a map gets a `$` property holding `<a,b>`, a scalar becomes `<value:a,b>`,
and lists are left alone (their elements are annotated individually). That
annotated tree is what `expected` pins. The test grammar and the capture hook
live in `ts/test/fixture.ts` and `go/path_test.go` (`installGrammar` /
`addPathCapture`) — keep the two in step.

Results are compared after a JSON round-trip, so key order and the
`OrderedMap` / null-prototype-object representations do not affect the
comparison.

## Who runs what

- TypeScript: `ts/test/parity.test.ts` — reads `../../test/spec` at runtime
  from `dist-test/`, one `describe` per file.
- Go: `go/parity_test.go` — `TestSpec` globs `../test/spec/*.tsv`.

Both discover files by directory listing: adding a `.tsv` here runs it in
both runtimes without touching either runner.

## Rules

- Prefer adding a fixture here over a one-off in-language assertion when a
  case is expressible as input → output. That is what keeps the two
  runtimes honest against each other.
- TypeScript is canonical. If the two runtimes disagree, the TS behaviour is
  the expected value — unless Go has exposed a genuine TS defect, in which
  case fix TS first and pin the corrected behaviour here.
- A new fixture must pass in BOTH runtimes: run `go test ./...` (from `go/`)
  and `npm test` (from `ts/`) before considering it done.
