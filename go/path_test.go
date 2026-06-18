/* Copyright (c) 2022-2026 Richard Rodger and other contributors, MIT License */

package tabnaspath

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	tabnas "github.com/tabnas/parser/go"
)

func assert(t *testing.T, name string, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s:\n  got:  %#v\n  want: %#v", name, got, want)
	}
}

// installGrammar registers a small, deliberately-minimal grammar: brace
// maps with bare (unquoted) keys, bracket lists, and scalar values — just
// enough nested structure to exercise the Path plugin. The Tabnas engine
// ships no grammar of its own, so tests bring their own; this fixture
// depends on nothing but the Tabnas parser itself. The rule names
// (val/map/pair/list/elem) are the ones the Path plugin hooks.
func installGrammar(j *tabnas.Tabnas) {
	j.Rule("val", func(rs *tabnas.RuleSpec, _ *tabnas.Parser) {
		rs.AddBO(func(r *tabnas.Rule, ctx *tabnas.Context) {
			r.Node = tabnas.Undefined
		})
		rs.AddBC(func(r *tabnas.Rule, ctx *tabnas.Context) {
			if !tabnas.IsUndefined(r.Node) {
				return
			}
			if !tabnas.IsUndefined(r.Child.Node) {
				r.Node = r.Child.Node
				return
			}
			if r.OS == 0 {
				r.Node = tabnas.Undefined
				return
			}
			r.Node = r.O0.ResolveVal(r, ctx)
		})
		rs.AddOpen(
			&tabnas.AltSpec{S: [][]tabnas.Tin{{tabnas.TinOB}}, P: "map", B: 1},
			&tabnas.AltSpec{S: [][]tabnas.Tin{{tabnas.TinOS}}, P: "list", B: 1},
			&tabnas.AltSpec{S: [][]tabnas.Tin{tabnas.TinSetVAL}},
		)
		rs.AddClose(
			&tabnas.AltSpec{S: [][]tabnas.Tin{{tabnas.TinZZ}}},
			&tabnas.AltSpec{B: 1},
		)
	})

	j.Rule("map", func(rs *tabnas.RuleSpec, _ *tabnas.Parser) {
		rs.AddBO(func(r *tabnas.Rule, ctx *tabnas.Context) {
			r.Node = make(map[string]any)
		})
		rs.AddOpen(
			&tabnas.AltSpec{S: [][]tabnas.Tin{{tabnas.TinOB}, {tabnas.TinCB}}, B: 1},
			&tabnas.AltSpec{S: [][]tabnas.Tin{{tabnas.TinOB}}, P: "pair"},
		)
		rs.AddClose(&tabnas.AltSpec{S: [][]tabnas.Tin{{tabnas.TinCB}}})
	})

	j.Rule("list", func(rs *tabnas.RuleSpec, _ *tabnas.Parser) {
		rs.AddBO(func(r *tabnas.Rule, ctx *tabnas.Context) {
			r.Node = make([]any, 0)
		})
		rs.AddOpen(
			&tabnas.AltSpec{S: [][]tabnas.Tin{{tabnas.TinOS}, {tabnas.TinCS}}, B: 1},
			&tabnas.AltSpec{S: [][]tabnas.Tin{{tabnas.TinOS}}, P: "elem"},
		)
		rs.AddClose(&tabnas.AltSpec{S: [][]tabnas.Tin{{tabnas.TinCS}}})
	})

	j.Rule("pair", func(rs *tabnas.RuleSpec, _ *tabnas.Parser) {
		rs.AddBC(func(r *tabnas.Rule, ctx *tabnas.Context) {
			if _, ok := r.U["pair"]; !ok {
				return
			}
			key, _ := r.U["key"].(string)
			val := r.Child.Node
			if tabnas.IsUndefined(val) {
				val = nil
			}
			m, _ := r.Node.(map[string]any)
			m[key] = val
			r.Node = m
		})
		rs.AddOpen(&tabnas.AltSpec{
			S: [][]tabnas.Tin{tabnas.TinSetKEY, {tabnas.TinCL}},
			P: "val",
			U: map[string]any{"pair": true},
			A: func(r *tabnas.Rule, ctx *tabnas.Context) {
				r.U["key"] = fmt.Sprintf("%v", r.O0.ResolveVal(r, ctx))
			},
		})
		rs.AddClose(
			&tabnas.AltSpec{S: [][]tabnas.Tin{{tabnas.TinCA}}, R: "pair"},
			&tabnas.AltSpec{S: [][]tabnas.Tin{{tabnas.TinCB}}, B: 1},
		)
	})

	j.Rule("elem", func(rs *tabnas.RuleSpec, _ *tabnas.Parser) {
		rs.AddBC(func(r *tabnas.Rule, ctx *tabnas.Context) {
			if tabnas.IsUndefined(r.Child.Node) {
				return
			}
			s, _ := r.Node.([]any)
			r.Node = append(s, r.Child.Node)
			if r.Parent != tabnas.NoRule && r.Parent != nil {
				r.Parent.Node = r.Node
			}
		})
		rs.AddOpen(&tabnas.AltSpec{P: "val"})
		rs.AddClose(
			&tabnas.AltSpec{S: [][]tabnas.Tin{{tabnas.TinCA}}, R: "elem"},
			&tabnas.AltSpec{S: [][]tabnas.Tin{{tabnas.TinCS}}, B: 1},
		)
	})
}

// newParser builds a Tabnas instance with the local grammar and the Path
// plugin. The grammar is installed first so the plugin's @<rule>-<phase>
// refs wire onto the existing rules.
func newParser() *tabnas.Tabnas {
	j := tabnas.Make()
	installGrammar(j)
	j.Use(Path, nil)
	return j
}

// addPathCapture adds a val AC callback that annotates nodes with path info.
func addPathCapture(j *tabnas.Tabnas) {
	j.Rule("val", func(rs *tabnas.RuleSpec, p *tabnas.Parser) {
		rs.AddAC(func(r *tabnas.Rule, ctx *tabnas.Context) {
			path := toPathSlice(r.K["path"])
			switch node := r.Node.(type) {
			case map[string]any:
				node["$"] = fmtPath(path)
			case []any:
				// Leave arrays as-is; elements are already annotated.
			default:
				r.Node = fmtValPath(r.Node, path)
			}
		})
	})
}

func TestHappy(t *testing.T) {
	j := newParser()
	result, err := j.Parse("{a:{b:1,c:[2,3]}}")
	if err != nil {
		t.Fatal(err)
	}
	m := result.(map[string]any)
	a := m["a"].(map[string]any)
	assert(t, "b", a["b"], float64(1))
	assert(t, "c", a["c"], []any{float64(2), float64(3)})
}

func TestPathTracking(t *testing.T) {
	j := newParser()
	addPathCapture(j)

	result, err := j.Parse("{a:{b:1}}")
	if err != nil {
		t.Fatal(err)
	}

	m := result.(map[string]any)
	assert(t, "root-path", m["$"], "<>")

	a := m["a"].(map[string]any)
	assert(t, "a-path", a["$"], "<a>")
	assert(t, "b-val", a["b"], "<1:a,b>")
}

func TestMetaBasePath(t *testing.T) {
	j := newParser()
	j.Rule("val", func(rs *tabnas.RuleSpec, p *tabnas.Parser) {
		rs.AddAC(func(r *tabnas.Rule, ctx *tabnas.Context) {
			path := toPathSlice(r.K["path"])
			if node, ok := r.Node.(map[string]any); ok {
				node["$"] = fmtPath(path)
			}
		})
	})

	result, err := j.ParseMeta("{a:1}", map[string]any{
		"path": map[string]any{
			"base": []any{"x", "y"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	m := result.(map[string]any)
	assert(t, "root", m["$"], "<x,y>")
}

func TestObjectPaths(t *testing.T) {
	j := newParser()
	addPathCapture(j)

	result, err := j.Parse("{a:1}")
	if err != nil {
		t.Fatal(err)
	}
	m := result.(map[string]any)
	assert(t, "root", m["$"], "<>")
	assert(t, "a", m["a"], "<1:a>")

	result, err = j.Parse("{a:1,b:B}")
	if err != nil {
		t.Fatal(err)
	}
	m = result.(map[string]any)
	assert(t, "root2", m["$"], "<>")
	assert(t, "a2", m["a"], "<1:a>")
	assert(t, "b2", m["b"], "<B:b>")
}

func TestNestedObjectPaths(t *testing.T) {
	j := newParser()
	addPathCapture(j)

	result, err := j.Parse("{x:{a:1}}")
	if err != nil {
		t.Fatal(err)
	}
	m := result.(map[string]any)
	assert(t, "root", m["$"], "<>")
	x := m["x"].(map[string]any)
	assert(t, "x", x["$"], "<x>")
	assert(t, "x-a", x["a"], "<1:x,a>")
}

func TestArrayPaths(t *testing.T) {
	j := newParser()
	addPathCapture(j)

	result, err := j.Parse("[1,2,3]")
	if err != nil {
		t.Fatal(err)
	}

	arr, ok := result.([]any)
	if !ok {
		t.Fatalf("expected []any, got %T", result)
	}
	assert(t, "elem-0", arr[0], "<1:0>")
	assert(t, "elem-1", arr[1], "<2:1>")
	assert(t, "elem-2", arr[2], "<3:2>")
}

// TestDeepMixedPaths checks paths through a deeply nested mix of objects and
// arrays.
func TestDeepMixedPaths(t *testing.T) {
	j := newParser()
	addPathCapture(j)

	// Deep object nesting.
	result, err := j.Parse("{a:{b:1,c:{d:{e:2}}},f:4}")
	if err != nil {
		t.Fatal(err)
	}
	m := result.(map[string]any)
	a := m["a"].(map[string]any)
	c := a["c"].(map[string]any)
	d := c["d"].(map[string]any)
	assert(t, "a.b", a["b"], "<1:a,b>")
	assert(t, "a.c.d.e", d["e"], "<2:a,c,d,e>")
	assert(t, "f", m["f"], "<4:f>")

	// Mixed objects and arrays.
	result, err = j.Parse("[a,[b],{c:1,d:[2,3]}]")
	if err != nil {
		t.Fatal(err)
	}
	arr := result.([]any)
	assert(t, "[0]", arr[0], "<a:0>")
	inner := arr[1].([]any)
	assert(t, "[1][0]", inner[0], "<b:1,0>")
	obj := arr[2].(map[string]any)
	assert(t, "[2].$", obj["$"], "<2>")
	assert(t, "[2].c", obj["c"], "<1:2,c>")
	dArr := obj["d"].([]any)
	assert(t, "[2].d[0]", dArr[0], "<2:2,d,0>")
	assert(t, "[2].d[1]", dArr[1], "<3:2,d,1>")
}

// fmtPath formats a path slice as "<a,b,c>".
func fmtPath(path []any) string {
	parts := make([]string, len(path))
	for i, p := range path {
		parts[i] = fmtKey(p)
	}
	return "<" + strings.Join(parts, ",") + ">"
}

// fmtValPath formats a value with its path as "<value:a,b>".
func fmtValPath(val any, path []any) string {
	parts := make([]string, len(path))
	for i, p := range path {
		parts[i] = fmtKey(p)
	}
	return "<" + fmtVal(val) + ":" + strings.Join(parts, ",") + ">"
}

func fmtKey(v any) string {
	switch k := v.(type) {
	case string:
		return k
	case int:
		return fmt.Sprintf("%d", k)
	case float64:
		if k == float64(int64(k)) {
			return fmt.Sprintf("%d", int64(k))
		}
		return fmt.Sprintf("%g", k)
	default:
		return fmt.Sprintf("%v", v)
	}
}

func fmtVal(v any) string {
	switch val := v.(type) {
	case string:
		return val
	case float64:
		if val == float64(int64(val)) {
			return fmt.Sprintf("%d", int64(val))
		}
		return fmt.Sprintf("%g", val)
	case bool:
		return fmt.Sprintf("%t", val)
	default:
		return fmt.Sprintf("%v", v)
	}
}
