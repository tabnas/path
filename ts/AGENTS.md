# Agent guide: TypeScript implementation

Scoped notes for `ts/`. See the [root AGENTS.md](../AGENTS.md) for the rules that
apply across both implementations. **This is the canonical implementation** —
behaviour changes start here.

## Commands

```sh
npm install        # devDeps (typescript, @types/node); jsonic is a peer dep
npm run build      # embed grammar, then tsc build of src + test
npm test           # node --test over dist-test
npm run embed      # regenerate the embedded grammar only
```

`jsonic` is a **peer** dependency, not installed by `npm install`. To build and
test against the GitHub `main` branch, fetch and install it without saving:

```sh
curl -sSL -o work/jsonic.tgz \
  https://github.com/jsonicjs/jsonic/archive/refs/heads/main.tar.gz
tar -C work -xzf work/jsonic.tgz
npm install --no-save work/jsonic-main
```

## Source notes

- `src/path.ts` holds the plugin. The grammar between the
  `BEGIN/END EMBEDDED path-grammar.jsonic` markers is generated from
  `path-grammar.jsonic` by `embed-grammar.js`; do not edit it by hand.
- The path array is drawn from a preallocated pool and **mutated in place** as
  the parser descends. `r.k.path` is therefore a shared, mutable array: client
  code that needs to keep a path beyond the current callback must copy it
  (`r.k.path.slice()`). The tests assert this sharing — keep that contract.
- The plugin only writes `r.k.path` / `r.k.key` / `r.k.index`. Reading the path
  is the job of a separate rule action, as shown in the tests and README.

## Tests

`test/path.test.ts` includes `expr`, which defines a small **non-JSON** grammar
(integer arithmetic) purely with a local lexer matcher — it depends on nothing
but `jsonic`. The Go suite mirrors it in `TestLocalGrammar`. Keep the two in
sync when either changes.
