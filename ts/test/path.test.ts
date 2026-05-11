/* Copyright (c) 2022-2025 Richard Rodger and other contributors, MIT License */


import { test, describe } from 'node:test'
import assert from 'node:assert'

import { Jsonic, Plugin, Rule } from 'jsonic'



import { Path } from '../dist/path'


// A very simple grammar for addition and multiplication of integer
// expressions. No parens, but precedence: `*` binds tighter than `+`.
// Expressions are lexed as a single value token and evaluated on the
// `val` rule close so that the Path plugin's key/path are available.
const EXPR_MARK = Symbol('expr')

const evalExpr = (src: string): number =>
  src.split('+')
    .map(term => term.split('*').reduce((a, b) => a * parseInt(b, 10), 1))
    .reduce((a, b) => a + b, 0)

const ExprLite: Plugin = (jsonic: Jsonic) => {
  jsonic.options({
    lex: {
      match: {
        exprLite: {
          order: 6.5e6,
          make: () => (lex: any) => {
            const pnt = lex.pnt
            const fwd = lex.src.substring(pnt.sI)
            const m = fwd.match(/^\d+(?:[+*]\d+)+/)
            if (!m) return undefined
            const src = m[0]
            const tkn = lex.token('#VL', { [EXPR_MARK]: true, src }, src, pnt)
            pnt.sI += src.length
            pnt.cI += src.length
            return tkn
          },
        },
      },
    },
  })

  jsonic.rule('val', rs => {
    rs.ac(false, (r: Rule) => {
      if (r.node && typeof r.node === 'object' && r.node[EXPR_MARK]) {
        // NOTE: path must be copied — it is a mutable shared array
        r.node = { expr: evalExpr(r.node.src), k: r.k.key, p: r.k.path.slice() }
      }
    })
  })
}


describe('path', () => {

  test('happy', () => {
    const j = Jsonic.make().use(Path)
    assert.deepEqual(j('{a:{b:1,c:[2,3]}}'), { a: { b: 1, c: [2, 3] } })
  })


  test('basic', () => {
    const j = Jsonic.make().use(Path).use((jsonic) => {
      jsonic.rule('val', rs => {
        rs
          .ac(false, (r) => {
            if ('object' !== typeof (r.node)) {
              // String coercion reads path immediately — safe
              r.node = `<${r.node}:${r.k.path}>`
            }
            else {
              r.node.$ = `<${r.k.path}>`
            }
          })
      })
    })

    let c: any = [
      '<2:a,c,0>',
      '<3:a,c,1>',
    ]
    c.$ = '<a,c>'
    assert.deepEqual(j('{a:{b:1,c:[2,3]}}'), {
      $: '<>',
      a: {
        $: '<a>',
        b: '<1:a,b>',
        c
      }
    })
  })


  test('meta', () => {
    const j = Jsonic.make().use(Path).use((jsonic) => {
      jsonic.rule('val', rs => {
        rs
          .ac(false, (r) => {
            if ('object' === typeof (r.node)) {
              r.node.$ = `<${r.k.path}>`
            }
          })
      })
    })

    assert.deepEqual(j('a:b:c:1,d:e:2', { path: { base: ['x', 'y'] } }), {
      $: '<x,y>',
      a: {
        $: '<x,y,a>',
        b: {
          $: '<x,y,a,b>',
          c: 1
        }
      },
      d: {
        $: '<x,y,d>',
        e: 2
      }
    })
  })



  test('object', () => {
    const j = Jsonic.make().use(Path).use((jsonic) => {
      jsonic.rule('val', rs => {
        rs
          .ac(false, (r) => {
            if ('object' !== typeof (r.node)) {
              r.node = `<${r.node}:${r.k.path}>`
            }
            else {
              r.node.$ = `<${r.k.path}>`
            }
          })
      })
    })

    assert.deepEqual(j('a:1'), { $: '<>', a: '<1:a>' })
    assert.deepEqual(j('a:1,b:B'), { $: '<>', a: '<1:a>', b: '<B:b>' })
    assert.deepEqual(j('a:1,b:B,c:true'),
      { $: '<>', a: '<1:a>', b: '<B:b>', c: '<true:c>' })

    assert.deepEqual(j('{a:1}'), { $: '<>', a: '<1:a>' })
    assert.deepEqual(j('{a:1,b:B}'), { $: '<>', a: '<1:a>', b: '<B:b>' })
    assert.deepEqual(j('{a:1,b:B,c:true}'),
      { $: '<>', a: '<1:a>', b: '<B:b>', c: '<true:c>' })

    assert.deepEqual(j('x:{a:1}'), { $: '<>', x: { $: '<x>', a: '<1:x,a>' } })
    assert.deepEqual(j('x:{a:1,b:B}'),
      { $: '<>', x: { $: '<x>', a: '<1:x,a>', b: '<B:x,b>' } })
    assert.deepEqual(j('x:{a:1,b:B,c:true}'),
      {
        $: '<>',
        x: { $: '<x>', a: '<1:x,a>', b: '<B:x,b>', c: '<true:x,c>' }
      })

    assert.deepEqual(j('y:x:{a:1}'),
      { $: '<>', y: { $: '<y>', x: { $: '<y,x>', a: '<1:y,x,a>' } } })
    assert.deepEqual(j('y:x:{a:1,b:B}'),
      {
        $: '<>', y: { $: '<y>', x: { $: '<y,x>', a: '<1:y,x,a>', b: '<B:y,x,b>' } }
      })
    assert.deepEqual(j('y:x:{a:1,b:B,c:true}'),
      {
        $: '<>', y: {
          $: '<y>',
          x: { $: '<y,x>', a: '<1:y,x,a>', b: '<B:y,x,b>', c: '<true:y,x,c>' }
        }
      })

    assert.deepEqual(j('z:y:x:{a:1}'),
      {
        $: '<>',
        z: { $: '<z>', y: { $: '<z,y>', x: { $: '<z,y,x>', a: '<1:z,y,x,a>' } } }
      })
    assert.deepEqual(j('z:y:x:{a:1,b:B}'),
      {
        $: '<>',
        z: {
          $: '<z>',
          y: { $: '<z,y>', x: { $: '<z,y,x>', a: '<1:z,y,x,a>', b: '<B:z,y,x,b>' } }
        }
      })
    assert.deepEqual(j('z:y:x:{a:1,b:B,c:true}'),
      {
        $: '<>',
        z: {
          $: '<z>',
          y: {
            $: '<z,y>',
            x: {
              $: '<z,y,x>',
              a: '<1:z,y,x,a>', b: '<B:z,y,x,b>', c: '<true:z,y,x,c>'
            }
          }
        }
      })

  })


  test('array', () => {
    const j = Jsonic.make().use(Path).use((jsonic) => {
      jsonic.rule('val', rs => {
        rs
          .ac(false, (r) => {
            if ('object' !== typeof (r.node)) {
              r.node = `<${r.node}:${r.k.path}>`
            }
            else {
              r.node = { ...r.node }
              r.node.$ = `<${r.k.path}>`
            }
          })
      })
    })

    assert.deepEqual(j('[]'), { $: '<>' })
    assert.deepEqual(j('[1]'), { $: '<>', 0: '<1:0>' })
    assert.deepEqual(j('[1,2]'), { $: '<>', 0: '<1:0>', 1: '<2:1>' })
    assert.deepEqual(j('[1,2,3]'), { $: '<>', 0: '<1:0>', 1: '<2:1>', 2: '<3:2>' })

    assert.deepEqual(j('[[]]'), { $: '<>', 0: { $: '<0>' } })
    assert.deepEqual(j('[[1]]'), { $: '<>', 0: { $: '<0>', 0: '<1:0,0>' } })
    assert.deepEqual(j('[[1,2]]'),
      { $: '<>', 0: { $: '<0>', 0: '<1:0,0>', 1: '<2:0,1>' } })
    assert.deepEqual(j('[[1,2,3]]'),
      { $: '<>', 0: { $: '<0>', 0: '<1:0,0>', 1: '<2:0,1>', 2: '<3:0,2>' } })

    assert.deepEqual(j('[[[]]]'), { $: '<>', 0: { $: '<0>', 0: { $: '<0,0>' } } })
    assert.deepEqual(j('[[[1]]]'),
      { $: '<>', 0: { $: '<0>', 0: { $: '<0,0>', 0: '<1:0,0,0>' } } })
    assert.deepEqual(j('[[[1,2]]]'),
      {
        $: '<>',
        0: { $: '<0>', 0: { $: '<0,0>', 0: '<1:0,0,0>', 1: '<2:0,0,1>' } }
      })
    assert.deepEqual(j('[[[1,2,3]]]'),
      {
        $: '<>',
        0: {
          $: '<0>',
          0: { $: '<0,0>', 0: '<1:0,0,0>', 1: '<2:0,0,1>', 2: '<3:0,0,2>' }
        }
      })

  })


  test('transform', () => {
    const j = Jsonic.make().use(Path).use((jsonic) => {
      jsonic.rule('val', rs => {
        rs
          .ac(false, (r) => {
            if ('object' !== typeof (r.node)) {
              r.node = {
                o: 'val',
                v: r.node,
                // NOTE: path must be copied — it is a mutable shared array
                p: r.k.path.slice(),
                k: r.k.key,
              }
            }
            else {
              r.node = {
                o: Array.isArray(r.node) ? 'arr' : 'obj',
                v: { ...r.node },
                p: r.k.path.slice(),
                k: r.k.key,
              }
            }
          })
      })
    })

    assert.deepEqual(j('{a:{b:1}}'), {
      k: undefined,
      o: 'obj',
      p: [],
      v: {
        a: {
          k: 'a',
          o: 'obj',
          p: ['a',],
          v: {
            b: {
              k: 'b',
              o: 'val',
              p: ['a', 'b',],
              v: 1,
            },
          },
        },
      },
    })

    assert.deepEqual(j('{a:{b:1,c:{d:{e:2}}},f:4}'), {
      k: undefined,
      o: 'obj',
      p: [],
      v: {
        a: {
          k: 'a',
          o: 'obj',
          p: ['a',],
          v: {
            b: {
              k: 'b',
              o: 'val',
              p: ['a', 'b',],
              v: 1,
            },
            c: {
              k: 'c',
              o: 'obj',
              p: ['a', 'c'],
              v: {
                d: {
                  k: 'd',
                  o: 'obj',
                  p: ['a', 'c', 'd'],
                  v: {
                    e: {
                      k: 'e',
                      o: 'val',
                      p: ['a', 'c', 'd', 'e'],
                      v: 2
                    }
                  }
                }
              }
            }
          },
        },
        f: {
          k: 'f',
          o: 'val',
          p: ['f',],
          v: 4,
        },
      },
    })

    assert.deepEqual(j('[a,b,c]'), {
      k: undefined,
      o: 'arr',
      p: [],
      v: {
        0: {
          k: 0,
          o: 'val',
          p: [0],
          v: 'a',
        },
        1: {
          k: 1,
          o: 'val',
          p: [1],
          v: 'b',
        },
        2: {
          k: 2,
          o: 'val',
          p: [2],
          v: 'c',
        },
      }
    })

    assert.deepEqual(j('[a,[b],{c:1,d:[2,3]}]'), {
      k: undefined,
      o: 'arr',
      p: [],
      v: {
        0: {
          k: 0,
          o: 'val',
          p: [0],
          v: 'a',
        },
        1: {
          k: 1,
          o: 'arr',
          p: [1],
          v: {
            0: {
              k: 0,
              o: 'val',
              p: [1, 0],
              v: 'b',
            }
          }
        },
        2: {
          k: 2,
          o: 'obj',
          p: [2],
          v: {
            c: {
              k: 'c',
              o: 'val',
              p: [2, 'c'],
              v: 1,

            },
            d: {
              k: 'd',
              o: 'arr',
              p: [2, 'd'],
              v: {
                0: {
                  k: 0,
                  o: 'val',
                  p: [2, 'd', 0],
                  v: 2,
                },
                1: {
                  k: 1,
                  o: 'val',
                  p: [2, 'd', 1],
                  v: 3,
                },
              }
            },
          }
        },
      }
    })

  })


  test('value', () => {
    const j = Jsonic.make()
      .use(Path)
      .use((jsonic) => {
        jsonic.options({
          value: {
            def: {
              AAA: {
                val: (r: Rule) => {
                  // NOTE: path must be copied
                  return { AAA: 1, k: r.k.key, p: r.k.path.slice() }
                }
              }
            }
          }
        })
      })

    assert.deepEqual(j('a:AAA'), { a: { AAA: 1, k: 'a', p: ['a'] } })
  })


  test('expr', () => {
    const j = Jsonic.make()
      .use(Path)
      .use(ExprLite)

    assert.deepEqual(j('{a:2+3*4}'), { a: { expr: 14, k: 'a', p: ['a'] } })
    assert.deepEqual(j('a:2+3*4'), { a: { expr: 14, k: 'a', p: ['a'] } })
    assert.deepEqual(j('a:2*3+4'), { a: { expr: 10, k: 'a', p: ['a'] } })
    assert.deepEqual(j('a:2+3'), { a: { expr: 5, k: 'a', p: ['a'] } })
    assert.deepEqual(j('a:2*3'), { a: { expr: 6, k: 'a', p: ['a'] } })
  })


  test('path-is-mutable', () => {
    // Verify that r.k.path is a shared mutable array.
    // Client code that needs to retain it must copy.
    const captured: any[] = []
    const j = Jsonic.make().use(Path).use((jsonic) => {
      jsonic.rule('val', rs => {
        rs.ac(false, (r) => {
          if ('object' !== typeof r.node) {
            // Store both a live ref and a snapshot
            captured.push({
              live: r.k.path,
              snapshot: r.k.path.slice(),
              value: r.node,
            })
          }
        })
      })
    })

    j('{a:1,b:2,c:{d:3}}')

    // Snapshots should have correct values at capture time
    const snaps = captured.map(c => ({ v: c.value, p: c.snapshot }))
    assert.deepEqual(snaps, [
      { v: 1, p: ['a'] },
      { v: 2, p: ['b'] },
      { v: 3, p: ['c', 'd'] },
    ])

    // Live refs at same depth share the same array instance
    // (a and b are both depth 1)
    assert.strictEqual(captured[0].live, captured[1].live)
  })

})
