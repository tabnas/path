/* Copyright (c) 2022-2024 Richard Rodger, MIT License */

import { Jsonic, Plugin, Rule, Context } from 'jsonic'

type PathOptions = {}

// --- BEGIN EMBEDDED path-grammar.jsonic ---
const grammarText = `
# Path Grammar Definition
# Declares rule names so @<rulename>-<phase> refs auto-wire as state actions.
# Parsed by a standard Jsonic instance and passed to jsonic.grammar().

{
  rule: {
    val:  {}
    map:  {}
    pair: {}
    list: {}
    elem: {}
  }
}
`
// --- END EMBEDDED path-grammar.jsonic ---

// Preallocated array pool for path tracking. Each depth level gets
// a reusable array of that length. The arrays are mutated in place
// as the parser traverses the tree — no allocation per pair/elem.
//
// IMPORTANT: r.k.path is a mutable, shared array. Client code that
// needs to retain the path beyond the current parse callback MUST
// copy it (e.g. r.k.path.slice() or [...r.k.path]).
const MAX_PATH_DEPTH = 64
const pathPool: any[][] = []
for (let i = 0; i <= MAX_PATH_DEPTH; i++) {
  pathPool[i] = new Array(i)
}


/* Keeps track of the property path to the current location.
 * Example: {a:{b:1 ## path=["a","b"]
 * Use the Rule.k key-value store so that the path is propagated to children and followers.
 * Depth must be greater than 0 - ensures path only starts once top level implicit is set up.
 */
const Path: Plugin = (jsonic: Jsonic, _options: PathOptions) => {
  const refs: Record<string, Function> = {
    '@val-bo': (r: Rule, ctx: Context) => {
      // At top level, create path array, or inherit from meta context.
      if (0 === r.d) {
        const base = ctx.meta.path?.base
        if (base && base.length > 0) {
          const arr = pathPool[base.length] || new Array(base.length)
          for (let i = 0; i < base.length; i++) arr[i] = base[i]
          r.k.path = arr
          r.k.pathDepth = base.length
        }
        else {
          r.k.path = pathPool[0]
          r.k.pathDepth = 0
        }
      }
    },

    '@map-bo': (r: Rule) => {
      // Not in an array, so no need to track element index.
      r.k.index = undefined
    },

    '@pair-ao': (r: Rule) => {
      if (0 < r.d && r.u.pair) {
        const depth = (r.k.pathDepth || 0) + 1
        const arr = pathPool[depth] || (pathPool[depth] = new Array(depth))
        const parent = r.k.path
        const parentLen = depth - 1
        for (let i = 0; i < parentLen; i++) arr[i] = parent[i]
        arr[parentLen] = r.u.key
        r.child.k.path = arr
        r.child.k.pathDepth = depth
        r.child.k.key = r.u.key
      }
    },

    '@list-bo': (r: Rule) => {
      // In array, the path property is the element index.
      r.k.index = -1
    },

    '@elem-ao': (r: Rule) => {
      if (0 < r.d) {
        r.k.index = 1 + r.k.index
        const depth = (r.k.pathDepth || 0) + 1
        const arr = pathPool[depth] || (pathPool[depth] = new Array(depth))
        const parent = r.k.path
        const parentLen = depth - 1
        for (let i = 0; i < parentLen; i++) arr[i] = parent[i]
        arr[parentLen] = r.k.index
        r.child.k.path = arr
        r.child.k.pathDepth = depth
        r.child.k.key = r.k.index
        r.child.k.index = r.k.index
      }
    },
  }

  // Parse embedded grammar definition using a separate standard Jsonic instance.
  const grammarDef: any = Jsonic.make()(grammarText)
  grammarDef.ref = refs
  jsonic.grammar(grammarDef)
}

Path.defaults = {} as PathOptions

export { Path }

export type { PathOptions }
