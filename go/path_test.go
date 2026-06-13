/* Copyright (c) 2022-2025 Richard Rodger and other contributors, MIT License */

package path

import (
	"fmt"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"testing"

	jsonic "github.com/jsonicjs/jsonic/go"
)

func assert(t *testing.T, name string, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s:\n  got:  %#v\n  want: %#v", name, got, want)
	}
}

// addPathCapture adds a val AC callback that annotates nodes with path info.
func addPathCapture(j *jsonic.Jsonic) {
	j.Rule("val", func(rs *jsonic.RuleSpec, p *jsonic.Parser) {
		rs.AC = append(rs.AC, func(r *jsonic.Rule, ctx *jsonic.Context) {
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
	j := MakeJsonic()
	result, err := j.Parse("{a:{b:1,c:[2,3]}}")
	if err != nil {
		t.Fatal(err)
	}
	m := result.(map[string]any)
	a := m["a"].(map[string]any)
	assert(t, "b", a["b"], float64(1))
}

func TestPathTracking(t *testing.T) {
	j := jsonic.Make()
	j.Use(Path, nil)
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
	j := jsonic.Make()
	j.Use(Path, nil)

	j.Rule("val", func(rs *jsonic.RuleSpec, p *jsonic.Parser) {
		rs.AC = append(rs.AC, func(r *jsonic.Rule, ctx *jsonic.Context) {
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
	j := jsonic.Make()
	j.Use(Path, nil)
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
	j := jsonic.Make()
	j.Use(Path, nil)
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
	j := jsonic.Make()
	j.Use(Path, nil)
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
// arrays, mirroring the TypeScript `transform` test.
func TestDeepMixedPaths(t *testing.T) {
	j := jsonic.Make()
	j.Use(Path, nil)
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

// evalExpr evaluates a sum-of-products integer expression like "2+3*4".
// `*` binds tighter than `+`; there are no parentheses.
func evalExpr(src string) int {
	sum := 0
	for _, term := range strings.Split(src, "+") {
		prod := 1
		for _, f := range strings.Split(term, "*") {
			n, _ := strconv.Atoi(f)
			prod *= n
		}
		sum += prod
	}
	return sum
}

// TestLocalGrammar exercises the plugin with a small grammar that is not JSON:
// integer arithmetic expressions. A custom value matcher lexes a whole
// expression as one value token; a `val` action then evaluates it and records
// the path the Path plugin tracked. This mirrors the TypeScript `expr` test and
// confirms path tracking works for non-JSON value syntax. It depends only on
// the Jsonic parser itself — no other production dependency.
func TestLocalGrammar(t *testing.T) {
	const exprMark = "__expr__"
	expr := regexp.MustCompile(`^\d+(?:[+*]\d+)+`)

	newParser := func() *jsonic.Jsonic {
		j := jsonic.Make()
		j.Use(Path, nil)
		if err := j.Grammar(&jsonic.GrammarSpec{Options: &jsonic.Options{
			Match: &jsonic.MatchOptions{
				Value: map[string]*jsonic.MatchValueSpec{
					"exprLite": {
						Match: expr,
						Val: func(m []string) any {
							return map[string]any{exprMark: true, "src": m[0]}
						},
					},
				},
			},
		}}); err != nil {
			t.Fatal(err)
		}
		j.Rule("val", func(rs *jsonic.RuleSpec, _ *jsonic.Parser) {
			rs.AC = append(rs.AC, func(r *jsonic.Rule, ctx *jsonic.Context) {
				node, ok := r.Node.(map[string]any)
				if !ok {
					return
				}
				if mark, _ := node[exprMark].(bool); !mark {
					return
				}
				path := toPathSlice(r.K["path"])
				cp := make([]any, len(path))
				copy(cp, path)
				r.Node = map[string]any{
					"expr": evalExpr(node["src"].(string)),
					"k":    r.K["key"],
					"p":    cp,
				}
			})
		})
		return j
	}

	cases := []struct {
		src  string
		want int
	}{
		{"{a:2+3*4}", 14},
		{"a:2+3*4", 14},
		{"a:2*3+4", 10},
		{"a:2+3", 5},
		{"a:2*3", 6},
	}
	for _, tc := range cases {
		result, err := newParser().Parse(tc.src)
		if err != nil {
			t.Fatalf("%s: %v", tc.src, err)
		}
		want := map[string]any{
			"a": map[string]any{"expr": tc.want, "k": "a", "p": []any{"a"}},
		}
		assert(t, tc.src, result, want)
	}
}

func TestMakeJsonic(t *testing.T) {
	j := MakeJsonic()
	result, err := j.Parse("{a:1}")
	if err != nil {
		t.Fatal(err)
	}
	m, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("expected map, got %T", result)
	}
	assert(t, "a", m["a"], float64(1))
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
