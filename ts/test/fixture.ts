/* Copyright (c) 2022-2026 Richard Rodger and other contributors, MIT License */

// The test grammar and path-capture plugin shared by path.test.ts and
// parity.test.ts. Their Go counterparts are `installGrammar` and
// `addPathCapture` in go/path_test.go — keep the two in step.

import { Tabnas, Plugin, Rule, Context } from '@tabnas/parser'

// A small, deliberately-minimal grammar: brace maps with bare (unquoted)
// keys, bracket lists, and scalar values — just enough nested structure to
// exercise the Path plugin. The Tabnas engine ships no grammar of its own,
// so tests bring their own; this fixture depends on nothing but the Tabnas
// parser itself. The rule names (val/map/pair/list/elem) are the ones the
// Path plugin hooks.
export const Grammar: Plugin = (tn: Tabnas) => {
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

// Annotate nodes with their tracked path: maps get a `$` property, scalars
// become `<value:path>`, arrays are left as-is (their elements are
// annotated individually).
export const capture: Plugin = (tn: Tabnas) => {
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
