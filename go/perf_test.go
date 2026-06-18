/* Copyright (c) 2022-2026 Richard Rodger and other contributors, MIT License */

package tabnaspath

import (
	"testing"
	"time"
)

// TestReuseInstanceIsFast guards against the performance anti-pattern of
// rebuilding the (expensive) engine + grammar + Path plugin on every parse
// instead of building one instance and reusing it.
//
// Unlike a grammar package (e.g. @tabnas/yaml or @tabnas/json), `path` ships
// NO package-level convenience Parse(): it is a plugin a consumer installs on
// their own engine (Make -> installGrammar -> Use(Path)). So there is nothing
// for the package to cache. What the test instead guards is the consumer's
// usage: building the grammar dominates a parse, so reusing ONE instance for N
// parses must be dramatically faster than rebuilding the instance per parse. A
// consumer (or a future convenience wrapper) that rebuilds per call would lose
// that factor — this test makes that regression visible.
//
// The check is machine-INDEPENDENT: it compares rebuild-per-call against
// instance reuse on the SAME machine in the SAME run, so a slow CI box cannot
// make it flaky (both sides scale together). There is deliberately NO
// wall-clock budget.
func TestReuseInstanceIsFast(t *testing.T) {
	// A tiny but representative structured input (a map with one pair and a
	// scalar) exercises the val/map/pair path-tracking hooks. Keeping it small
	// makes the fixed grammar-build cost the dominant term, so reuse shows a
	// large, stable speedup (~5x here) over rebuild-per-call.
	const src = "{a:1}"
	const n = 3000

	// Warm both paths so the comparison is steady-state.
	for i := 0; i < 50; i++ {
		j := newParser()
		if _, err := j.Parse(src); err != nil {
			t.Fatalf("warm rebuild parse error: %v", err)
		}
	}
	shared := newParser()
	for i := 0; i < 50; i++ {
		if _, err := shared.Parse(src); err != nil {
			t.Fatalf("warm reuse parse error: %v", err)
		}
	}

	// rebuild-per-call: builds the engine + grammar + plugin every iteration,
	// then parses — the slow anti-pattern.
	t0 := time.Now()
	for i := 0; i < n; i++ {
		j := newParser()
		if _, err := j.Parse(src); err != nil {
			t.Fatalf("rebuild parse error: %v", err)
		}
	}
	rebuild := time.Since(t0)

	// reuse: builds the instance once, parses N times.
	t1 := time.Now()
	for i := 0; i < n; i++ {
		if _, err := shared.Parse(src); err != nil {
			t.Fatalf("reuse parse error: %v", err)
		}
	}
	reuse := time.Since(t1)

	// Reusing one instance must be meaningfully cheaper than rebuilding per
	// call. For this tiny input the fixed grammar-build cost dominates, so
	// reuse is observed ~5x faster than rebuild-per-call (a heavy grammar like
	// yaml would show 25x+). We require reuse to be at least 1.5x faster —
	// comfortably below the observed margin, yet it fails decisively if a
	// regression made every parse (re)build the grammar (reuse would then
	// equal rebuild, speedup ~1x). The check is machine-independent: it
	// depends only on the ratio of two timings from the same run.
	if rebuild*2 < reuse*3 { // rebuild < 1.5 * reuse
		t.Errorf("reusing one instance is not meaningfully faster than "+
			"rebuilding per parse: %d reuse parses took %v vs %v rebuilding "+
			"the instance each call (speedup %.2fx, want >=1.5x). Building the "+
			"grammar should dominate — reuse one instance instead of "+
			"newParser() per parse.",
			n, reuse, rebuild, float64(rebuild)/float64(reuse))
	}
	t.Logf("rebuild-per-call=%v  reuse=%v  speedup=%.2fx", rebuild, reuse, float64(rebuild)/float64(reuse))
}
