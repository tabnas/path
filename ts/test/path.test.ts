/* Copyright (c) 2022-2026 Richard Rodger and other contributors, MIT License */


import { test, describe } from 'node:test'
import assert from 'node:assert'

import { Tabnas, Plugin, Rule, Context } from '@tabnas/parser'

import { Path } from '../dist/path'


// A small, deliberately-minimal grammar: brace maps with bare (unquoted)
// keys, bracket lists, and scalar values — just enough nested structure to
// exercise the Path plugin. The Tabnas engine ships no grammar of its own,
// so tests bring their own; this fixture depends on nothing but the Tabnas
// parser itself. The rule names (val/map/pair/list/elem) are the ones the
// Path plugin hooks.
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


// Build a parser with the local grammar and the Path plugin. The grammar
// is installed first so the plugin's @<rule>-<phase> refs wire onto the
// existing rules.
const make = () => new Tabnas().use(Grammar).use(Path)


// Annotate nodes with their tracked path: maps get a `$` property, scalars
// become `<value:path>`, arrays are left as-is (their elements are
// annotated individually).
const capture: Plugin = (tn: Tabnas) => {
  tn.rule('val', (rs: any) =>
    rs.ac(false, (r: Rule) => {
      if (null === r.node || 'object' !== typeof r.node) {
        // String coercion reads path immediately — safe.
        r.node = `<${r.node}:${r.k.path}>`
      } else if (!Array.isArray(r.node)) {
        r.node.$ = `<${r.k.path}>`
      }
    }),
  )
}


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
