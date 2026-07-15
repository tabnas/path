/* Copyright (c) 2022-2026 Richard Rodger and other contributors, MIT License */

package tabnaspath

import (
	tabnas "github.com/tabnas/parser/go"
)

const Version = "0.2.1"

type PathOptions struct{}

// hookedRules are the host-grammar rules the plugin attaches to. The
// Tabnas engine ships no grammar of its own, so these names must match
// the rules supplied by whatever grammar plugin the consumer installs.
// The standard value/map/pair/list/elem rule set uses these names.
var hookedRules = []string{"val", "map", "pair", "list", "elem"}

// Path is a Tabnas plugin that tracks the property path to the current
// location during parsing. The path is stored in Rule.K["path"] as a
// []any slice of string keys and int indices.
func Path(j *tabnas.Tabnas, opts map[string]any) error {
	refs := map[tabnas.FuncRef]any{
		"@val-bo": tabnas.StateAction(func(r *tabnas.Rule, ctx *tabnas.Context) {
			if r.D == 0 {
				var base []any
				if ctx.Meta != nil {
					if pm, ok := ctx.Meta["path"].(map[string]any); ok {
						if b, ok := pm["base"].([]any); ok {
							base = make([]any, len(b))
							copy(base, b)
						}
					}
				}
				if base == nil {
					base = []any{}
				}
				r.EnsureK()["path"] = base
			}
		}),

		"@map-bo": tabnas.StateAction(func(r *tabnas.Rule, ctx *tabnas.Context) {
			delete(r.K, "index")
		}),

		"@pair-ao": tabnas.StateAction(func(r *tabnas.Rule, ctx *tabnas.Context) {
			if r.D > 0 && r.U["pair"] != nil {
				key := r.U["key"]
				parentPath := toPathSlice(r.K["path"])
				childPath := make([]any, len(parentPath)+1)
				copy(childPath, parentPath)
				childPath[len(parentPath)] = key
				ck := r.Child.EnsureK()
				ck["path"] = childPath
				ck["key"] = key
			}
		}),

		"@list-bo": tabnas.StateAction(func(r *tabnas.Rule, ctx *tabnas.Context) {
			r.EnsureK()["index"] = -1
		}),

		"@elem-ao": tabnas.StateAction(func(r *tabnas.Rule, ctx *tabnas.Context) {
			if r.D > 0 {
				idx := 0
				if v, ok := r.K["index"].(int); ok {
					idx = v + 1
				}
				r.EnsureK()["index"] = idx
				parentPath := toPathSlice(r.K["path"])
				childPath := make([]any, len(parentPath)+1)
				copy(childPath, parentPath)
				childPath[len(parentPath)] = idx
				ck := r.Child.EnsureK()
				ck["path"] = childPath
				ck["key"] = idx
				ck["index"] = idx
			}
		}),
	}

	// Declare the rules to hook. Each empty rule spec causes Grammar to
	// auto-wire the matching @<rulename>-<phase> refs above as state
	// actions, without otherwise altering the host grammar's rules.
	gsRule := make(map[string]*tabnas.GrammarRuleSpec, len(hookedRules))
	for _, name := range hookedRules {
		gsRule[name] = &tabnas.GrammarRuleSpec{}
	}

	return j.Grammar(&tabnas.GrammarSpec{Ref: refs, Rule: gsRule})
}

func toPathSlice(v any) []any {
	if p, ok := v.([]any); ok {
		return p
	}
	return []any{}
}
