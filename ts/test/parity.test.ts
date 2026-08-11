/* Copyright (c) 2025 Richard Rodger and other contributors, MIT License */

// Cross-runtime conformance, driven by the shared `test/spec/*.tsv` fixtures
// at the repo root (see ../../test/AGENTS.md).
//
// The fixture loader, the escape codec, the `ERROR:<code>` contract and the
// row loop all come from @tabnas/support, whose Go half `go/parity_test.go`
// uses to run the SAME files — so the two implementations cannot drift
// without one of them going red, and neither can the two loaders.
//
// What is left here is only what is specific to path: the grammar and the
// capture plugin the fixtures parse against, and the row's parse meta.

import { Tabnas } from '@tabnas/parser'
import { findSpecDir, makeRunner } from '@tabnas/support'

import { Path } from '../dist/path'
import { Grammar, capture } from './fixture'

makeRunner({
  parse: (input, row) => {
    // path has no grammar of its own: it annotates whatever grammar it is
    // installed into. The local `Grammar` plays that part in both runtimes,
    // and `capture` collects what the fixture asserts against.
    //
    // The opts column is the parse META, not plugin options — a fixture
    // sets the base path a relative reference resolves against.
    const opts = row.named('opts')
    const meta = '' === opts.trim() ? undefined : JSON.parse(opts)

    return new Tabnas().use(Grammar).use(Path).use(capture).parse(input, meta)
  },
})
  // `findSpecDir` walks up from this file — `dist-test/` at runtime — to the
  // repo root's `test/spec`, so moving the suite does not mean recounting
  // `..` hops. `dir` then auto-discovers every fixture in it, so adding a
  // .tsv runs it in both runtimes without touching either runner.
  .dir(findSpecDir(__dirname))
