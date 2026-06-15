# Agent guide: TypeScript implementation

Scoped notes for `ts/`. See the [root AGENTS.md](../AGENTS.md) for the rules that
apply across both implementations. **This is the canonical implementation** —
behaviour changes start here.

## Commands

```sh
npm install        # devDeps (typescript, @types/node); tabnas is a peer dep
npm run build      # tsc build of src + test
npm test           # node --test over dist-test
```

`tabnas` is a **peer** dependency, not installed by `npm install`. To build and
test against the GitHub `main` branch, fetch it, build it, and install it without
saving:

```sh
curl -sSL -o work/tabnas.tgz \
  https://github.com/tabnas/parser/archive/refs/heads/main.tar.gz
tar -C work -xzf work/tabnas.tgz
( cd work/parser-main/ts && npm install && npm run build )  # engine ships no dist/
npm install --no-save work/parser-main/ts
```

## Source notes

- `src/path.ts` holds the plugin. It imports `Tabnas` and friends from `tabnas`
  and registers its refs via `tn.grammar({ rule: {...}, ref: {...} })`. The
  engine is grammar-free, so the plugin only declares the rule *names* it hooks
  (`val/map/pair/list/elem`) — it does not define those rules.
- The path array is drawn from a preallocated pool and **mutated in place** as
  the parser descends. `r.k.path` is therefore a shared, mutable array: client
  code that needs to keep a path beyond the current callback must copy it
  (`r.k.path.slice()`). The `path-is-mutable` test asserts this sharing — keep
  that contract.
- The plugin only writes `r.k.path` / `r.k.key` / `r.k.index`. Reading the path
  is the job of a separate rule action, as shown in the tests and README.

## Tests

`test/path.test.ts` defines a small **local grammar** (`Grammar`) — bare-key
brace maps and bracket lists — declared with the standard `tn.grammar({...})`
form. It depends only on `tabnas`. Install the grammar before `Path`
(`new Tabnas().use(Grammar).use(Path)`) so the plugin's `@<rule>-<phase>` refs
wire onto rules that already exist. The Go suite mirrors this fixture in
`installGrammar`; keep the two in sync.
