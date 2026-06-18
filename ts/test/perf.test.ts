/* Copyright (c) 2022-2026 Richard Rodger and other contributors, MIT License */

import { test, describe } from 'node:test'
import assert from 'node:assert'

import { Tabnas, Plugin, Rule, Context } from '@tabnas/parser'

import { Path } from '../dist/path'


// A small, deliberately-minimal grammar (brace maps with bare keys, bracket
// lists, scalar values) — just enough nested structure to exercise the Path
// plugin. The Tabnas engine ships no grammar of its own, so the test brings
// its own. Mirrors the fixture in path.test.ts. The rule names
// (val/map/pair/list/elem) are the ones the Path plugin hooks.
const Grammar: Plugin = (tn: Tabnas) => {
  const { TX, ST } = tn.token

  tn.grammar({
    ref: {
      '@pairkey': (r: Rule) => {
        const kt = r.o0
        r.u.key = ST === kt.tin || TX === kt.tin ? kt.val : kt.src
      },
      '@val-bo': (r: Rule) => (r.node = undefined),
      '@val-bc': (r: Rule, ctx: Context) => {
        r.node =
          undefined === r.node
            ? undefined === r.child.node
              ? 0 === r.os
                ? undefined
                : r.o0.resolveVal(r, ctx)
              : r.child.node
            : r.node
      },
      '@map-bo': (r: Rule) => (r.node = {}),
      '@list-bo': (r: Rule) => (r.node = []),
      '@pair-bc': (r: Rule) => {
        if (r.u.pair) r.node[r.u.key] = r.child.node
      },
      '@elem-bc': (r: Rule) => {
        if (undefined !== r.child.node) r.node.push(r.child.node)
      },
    } as any,

    rule: {
      val: {
        open: [{ s: '#OB', p: 'map', b: 1 }, { s: '#OS', p: 'list', b: 1 }, { s: '#VAL' }],
        close: [{ s: '#ZZ' }, { b: 1 }],
      },
      map: {
        open: [{ s: '#OB #CB', b: 1 }, { s: '#OB', p: 'pair' }],
        close: [{ s: '#CB' }],
      },
      list: {
        open: [{ s: '#OS #CS', b: 1 }, { s: '#OS', p: 'elem' }],
        close: [{ s: '#CS' }],
      },
      pair: {
        open: [{ s: '#KEY #CL', p: 'val', u: { pair: true }, a: '@pairkey' }],
        close: [{ s: '#CA', r: 'pair' }, { s: '#CB', b: 1 }],
      },
      elem: {
        open: [{ p: 'val' }],
        close: [{ s: '#CA', r: 'elem' }, { s: '#CS', b: 1 }],
      },
    },
  } as any)
}

// Build a parser with the local grammar and the Path plugin (grammar first so
// the plugin's @<rule>-<phase> refs wire onto the existing rules).
const make = () => new Tabnas().use(Grammar).use(Path)


describe('perf', () => {

  // Guards against the performance anti-pattern of rebuilding the (expensive)
  // engine + grammar + Path plugin on every parse instead of building one
  // instance and reusing it.
  //
  // Unlike a grammar package (@tabnas/yaml, @tabnas/json), `path` ships NO
  // convenience parse(): it is a plugin a consumer installs on their own
  // engine (new Tabnas().use(Grammar).use(Path)). So there is nothing for the
  // package to cache. What this test guards is the consumer's usage: building
  // the grammar dominates a parse, so reusing ONE instance for N parses must
  // be dramatically faster than rebuilding the instance per parse. A consumer
  // (or a future convenience wrapper) that rebuilds per call would lose that
  // factor — this test makes that regression visible.
  //
  // The check is machine-INDEPENDENT: it compares rebuild-per-call against
  // instance reuse in the SAME run, so a slow CI box cannot make it flaky
  // (both sides scale together). There is deliberately NO wall-clock budget.
  test('reuse-instance-is-fast', () => {
    // A tiny but representative structured input (a map with one pair and a
    // scalar) exercises the val/map/pair path hooks. Keeping it small makes
    // the fixed grammar-build cost the dominant term, so reuse shows a large,
    // stable speedup over rebuild-per-call.
    const src = '{a:1}'
    const n = 3000

    // Warm both paths so the comparison is steady-state (JIT, caches).
    for (let i = 0; i < 50; i++) make().parse(src)
    const shared = make()
    for (let i = 0; i < 50; i++) shared.parse(src)

    // rebuild-per-call: builds the engine + grammar + plugin every iteration,
    // then parses — the slow anti-pattern.
    const t0 = process.hrtime.bigint()
    for (let i = 0; i < n; i++) make().parse(src)
    const rebuild = Number(process.hrtime.bigint() - t0)

    // reuse: builds the instance once, parses N times.
    const t1 = process.hrtime.bigint()
    for (let i = 0; i < n; i++) shared.parse(src)
    const reuse = Number(process.hrtime.bigint() - t1)

    const speedup = rebuild / reuse

    // Reusing one instance must be meaningfully cheaper than rebuilding per
    // call. For this tiny input the fixed grammar-build cost dominates, so
    // reuse is observed several-x faster than rebuild-per-call (a heavy
    // grammar like yaml would show 25x+). We require reuse to be at least 1.5x
    // faster — comfortably below the observed margin, yet it fails decisively
    // if a regression made every parse (re)build the grammar (reuse would then
    // equal rebuild, speedup ~1x). Machine-independent: only the ratio of two
    // same-run timings matters, no absolute budget.
    assert.ok(
      rebuild >= 1.5 * reuse,
      `reusing one instance is not meaningfully faster than rebuilding per ` +
        `parse: ${n} reuse parses took ${(reuse / 1e6).toFixed(1)}ms vs ` +
        `${(rebuild / 1e6).toFixed(1)}ms rebuilding the instance each call ` +
        `(speedup ${speedup.toFixed(2)}x, want >=1.5x). Building the grammar ` +
        `should dominate — reuse one instance instead of new Tabnas().use(...) ` +
        `per parse.`,
    )

    // eslint-disable-next-line no-console
    console.log(
      `  perf: rebuild-per-call=${(rebuild / 1e6).toFixed(1)}ms ` +
        `reuse=${(reuse / 1e6).toFixed(1)}ms speedup=${speedup.toFixed(2)}x`,
    )
  })

})
