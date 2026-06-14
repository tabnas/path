package path

import (
	"testing"

	tabnas "github.com/tabnas/parser/go"
)

// TestNoPanicOnEdgeInputs feeds malformed, empty, deeply nested, and
// adversarial inputs through the grammar + Path plugin. The plugin must
// never panic: Parse may return an error, but it must return.
func TestNoPanicOnEdgeInputs(t *testing.T) {
	inputs := []string{
		"", " ", "\n", "{", "}", "[", "]", "[}", "{]", ":", ",", "::", ",,",
		"{a", "{a:", "{a:}", "{:1}", "{a:1", "a:1", "[1", "1,2", "[,]", "{,}",
		"{a:{b:{c:{d:{e:1}}}}}", "[[[[[1]]]]]", "[[[[", "}}}}", "{a:[1,{b:[2]}]}",
		"{a:1,a:2}", "{a:1 b:2}", "[1 2 3]", "{\"a\":1}", "{a:b:c:1}",
		"{1:2}", "[true,false,null]", "{a:[]}", "{a:{}}", "[{},[]]",
	}
	for _, in := range inputs {
		func() {
			defer func() {
				if rec := recover(); rec != nil {
					t.Errorf("panic on input %q: %v", in, rec)
				}
			}()
			j := newParser()
			addPathCapture(j)
			_, _ = j.Parse(in) // error is fine; panic is not
		}()
	}
}

// TestNoPanicDeepNesting checks very deep structures (no pool/depth limit in Go).
func TestNoPanicDeepNesting(t *testing.T) {
	for _, depth := range []int{1, 8, 64, 200, 1000} {
		src := ""
		for i := 0; i < depth; i++ {
			src += "{a:"
		}
		src += "1"
		for i := 0; i < depth; i++ {
			src += "}"
		}
		func() {
			defer func() {
				if rec := recover(); rec != nil {
					t.Errorf("panic at depth %d: %v", depth, rec)
				}
			}()
			j := newParser()
			_, _ = j.Parse(src)
		}()
	}
}

// FuzzPathPlugin fuzzes the grammar + Path plugin; it must never panic.
func FuzzPathPlugin(f *testing.F) {
	for _, s := range []string{"{a:1}", "[1,2]", "{a:{b:[1,{c:2}]}}", "", "{"} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, src string) {
		j := tabnas.Make()
		installGrammar(j)
		j.Use(Path, nil)
		_, _ = j.Parse(src) // must not panic
	})
}
