/* Copyright (c) 2022-2026 Richard Rodger, MIT License */

import { Tabnas, Plugin, Rule, Context } from '@tabnas/parser'

type PathOptions = {}

// The host-grammar rules the plugin hooks. The Tabnas engine ships no
// grammar of its own, so these names must match the rules supplied by
// whatever grammar plugin the consumer installs. The standard
// value/map/pair/list/elem rule set uses these names. Each empty rule
// entry causes tabnas.grammar() to auto-wire any matching
// @<rulename>-<phase> function refs as state actions.
const HOOKED_RULES = ['val', 'map', 'pair', 'list', 'elem']

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
const Path: Plugin = (tabnas: Tabnas, _options: PathOptions) => {
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

  // Declare the rules to hook and attach the refs. The empty rule specs
  // leave the host grammar's rules intact; only the @<rule>-<phase> refs
  // are wired in as state actions.
  const grammarDef: any = {
    rule: Object.fromEntries(HOOKED_RULES.map((name) => [name, {}])),
    ref: refs,
  }
  tabnas.grammar(grammarDef)
}

Path.defaults = {} as PathOptions

export { Path }

export type { PathOptions }
