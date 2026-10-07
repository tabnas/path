# Agent guide: TypeScript implementation

Scoped notes for `ts/`. See the [root AGENTS.md](../AGENTS.md) for the rules that
apply across both implementations. **This is the canonical implementation** —
behaviour changes start here.

## Commands

```sh
npm install        # every devDependency, @tabnas/parser included, from the registry
npm run build      # tsc build of src + test
npm test           # node --test over dist-test
```

`npm install` resolves everything from the npm registry. It installs the
`"*"` devDependencies `@tabnas/debug`, `@tabnas/parser`,
`@tabnas/railroad` and `@tabnas/support`, plus the pinned `typescript`
and `@types/node`. `package-lock.json` is gitignored, so a fresh install
takes the latest published `@tabnas/*` versions, and a local lockfile
keeps whatever it first resolved. `@tabnas/parser` is also the **peer**
dependency (`">=0"`), and npm 7 and later install peers too, so the
engine is installed either way.

To build and test against an unreleased engine, link a built checkout of
it over `node_modules/@tabnas/parser` once the install has finished. In
the fleet layout, build the sibling (`npm install && npm run build` in
`../../parser/ts`), then run admin's `scripts/link.sh` (`make link` in
the admin repo). For every repo in the tabnas folder, it replaces each
`@tabnas/*` package in `node_modules` with a symlink to the matching
sibling's `ts/`, without editing a tracked file. The tests also load
`@tabnas/support`, so build that sibling too. A later `npm install` puts
the registry copies back; re-run `link.sh` after one. The
[root AGENTS.md](../AGENTS.md) covers this wiring under "The tabnas
engine dependency".

## Source notes

- `src/path.ts` holds the plugin. It imports `Tabnas` and friends from `@tabnas/parser`
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
form. It depends only on `@tabnas/parser`. Install the grammar before `Path`
(`new Tabnas().use(Grammar).use(Path)`) so the plugin's `@<rule>-<phase>` refs
wire onto rules that already exist. The Go suite mirrors this fixture in
`installGrammar`; keep the two in sync.
