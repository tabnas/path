/* Copyright (c) 2022-2026 Richard Rodger and other contributors, MIT License */

// TypeScript counterpart of go/stress_test.go. The Go suite asserts the
// plugin never panics on malformed or deeply-nested input; the TS analogue
// is that such input either parses or raises a controlled TabnasError —
// never an internal crash (TypeError/RangeError) leaking out of the plugin.

import { test, describe } from 'node:test'
import assert from 'node:assert'

import { Tabnas, TabnasError, Rule } from '@tabnas/parser'

import { Path } from '../dist/path'
import { Grammar, capture } from './fixture'


describe('stress', () => {

  // Mirrors TestNoPanicOnEdgeInputs. Parse may fail, but it must fail
  // cleanly: a TabnasError, not an internal error from inside the plugin.
  test('no-crash-on-edge-inputs', () => {
    const inputs = [
      '', ' ', '\n', '{', '}', '[', ']', '[}', '{]', ':', ',', '::', ',,',
      '{a', '{a:', '{a:}', '{:1}', '{a:1', 'a:1', '[1', '1,2', '[,]', '{,}',
      '{a:{b:{c:{d:{e:1}}}}}', '[[[[[1]]]]]', '[[[[', '}}}}', '{a:[1,{b:[2]}]}',
      '{a:1,a:2}', '{a:1 b:2}', '[1 2 3]', '{"a":1}', '{a:b:c:1}',
      '{1:2}', '[true,false,null]', '{a:[]}', '{a:{}}', '[{},[]]',
    ]

    for (const src of inputs) {
      const j = new Tabnas().use(Grammar).use(Path).use(capture)
      try {
        j.parse(src)
      } catch (e: any) {
        assert.ok(
          e instanceof TabnasError,
          `input ${JSON.stringify(src)} raised ${e?.constructor?.name}: ${e?.message}`,
        )
      }
    }
  })


  // Mirrors TestNoPanicDeepNesting. MAX_PATH_DEPTH (64) sizes the
  // preallocated pool; it is not a ceiling — deeper levels extend the pool
  // lazily and must still yield a full, correct path.
  test('no-crash-deep-nesting', () => {
    for (const depth of [1, 8, 64, 200, 1000]) {
      const src = '{a:'.repeat(depth) + '1' + '}'.repeat(depth)

      let deepest: any[] | null = null
      const j = new Tabnas().use(Grammar).use(Path).use((tn: Tabnas) => {
        tn.rule('val', (rs: any) =>
          rs.ac(false, (r: Rule) => {
            // Pooled array is reused - snapshot it.
            if (1 === r.node) deepest = r.k.path.slice()
          }),
        )
      })

      j.parse(src)

      assert.deepEqual(
        deepest,
        new Array(depth).fill('a'),
        `path wrong at depth ${depth}`,
      )
    }
  })

})
