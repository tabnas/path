/* Copyright (c) 2022-2026 Richard Rodger and other contributors, MIT License */


import { test, describe } from 'node:test'
import assert from 'node:assert'

import { Tabnas, Plugin, Rule } from '@tabnas/parser'

import { Path } from '../dist/path'
import { Grammar, capture } from './fixture'


// Build a parser with the local grammar and the Path plugin. The grammar
// is installed first so the plugin's @<rule>-<phase> refs wire onto the
// existing rules.
const make = () => new Tabnas().use(Grammar).use(Path)


describe('path', () => {

  test('happy', () => {
    const j = make()
    assert.deepEqual(j.parse('{a:{b:1,c:[2,3]}}'), { a: { b: 1, c: [2, 3] } })
  })


  test('path-tracking', () => {
    const j = make().use(capture)
    const out: any = j.parse('{a:{b:1}}')
    assert.equal(out.$, '<>')
    assert.equal(out.a.$, '<a>')
    assert.equal(out.a.b, '<1:a,b>')
  })


  test('meta', () => {
    const j = make().use((tn: Tabnas) => {
      tn.rule('val', (rs: any) =>
        rs.ac(false, (r: Rule) => {
          if (null !== r.node && 'object' === typeof r.node && !Array.isArray(r.node)) {
            r.node.$ = `<${r.k.path}>`
          }
        }),
      )
    })

    assert.deepEqual(j.parse('{a:1}', { path: { base: ['x', 'y'] } }), {
      $: '<x,y>',
      a: 1,
    })
  })


  test('object', () => {
    const j = make().use(capture)

    assert.deepEqual(j.parse('{a:1}'), { $: '<>', a: '<1:a>' })
    assert.deepEqual(j.parse('{a:1,b:B}'), { $: '<>', a: '<1:a>', b: '<B:b>' })

    assert.deepEqual(j.parse('{x:{a:1}}'),
      { $: '<>', x: { $: '<x>', a: '<1:x,a>' } })
    assert.deepEqual(j.parse('{y:{x:{a:1,b:B}}}'),
      { $: '<>', y: { $: '<y>', x: { $: '<y,x>', a: '<1:y,x,a>', b: '<B:y,x,b>' } } })
  })


  test('array', () => {
    const j = make().use(capture)

    assert.deepEqual(j.parse('[1]'), ['<1:0>'])
    assert.deepEqual(j.parse('[1,2,3]'), ['<1:0>', '<2:1>', '<3:2>'])
    assert.deepEqual(j.parse('[[1,2]]'), [['<1:0,0>', '<2:0,1>']])
    assert.deepEqual(j.parse('[[[1,2,3]]]'),
      [[['<1:0,0,0>', '<2:0,0,1>', '<3:0,0,2>']]])
  })


  test('deep-mixed', () => {
    const j = make().use(capture)

    assert.deepEqual(j.parse('{a:{b:1,c:{d:{e:2}}},f:4}'), {
      $: '<>',
      a: {
        $: '<a>',
        b: '<1:a,b>',
        c: { $: '<a,c>', d: { $: '<a,c,d>', e: '<2:a,c,d,e>' } },
      },
      f: '<4:f>',
    })

    assert.deepEqual(j.parse('[a,[b],{c:1,d:[2,3]}]'), [
      '<a:0>',
      ['<b:1,0>'],
      { $: '<2>', c: '<1:2,c>', d: ['<2:2,d,0>', '<3:2,d,1>'] },
    ])
  })


  test('path-is-mutable', () => {
    // Verify that r.k.path is a shared mutable array (pooled per depth).
    // Client code that needs to retain it must copy.
    const captured: any[] = []
    const j = make().use((tn: Tabnas) => {
      tn.rule('val', (rs: any) =>
        rs.ac(false, (r: Rule) => {
          if (null === r.node || 'object' !== typeof r.node) {
            captured.push({
              live: r.k.path,
              snapshot: r.k.path.slice(),
              value: r.node,
            })
          }
        }),
      )
    })

    j.parse('{a:1,b:2,c:{d:3}}')

    const snaps = captured.map((c) => ({ v: c.value, p: c.snapshot }))
    assert.deepEqual(snaps, [
      { v: 1, p: ['a'] },
      { v: 2, p: ['b'] },
      { v: 3, p: ['c', 'd'] },
    ])

    // a and b are both depth 1, so their live path arrays are the same
    // pooled instance.
    assert.strictEqual(captured[0].live, captured[1].live)
  })

})
