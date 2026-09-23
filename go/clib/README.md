# libtabnaspath — the path parser as a C ABI

<!-- tabnas-clib-template: v3 — stamped by admin tasks/adopt-clib.sh;
     edit the template and re-stamp, not this file. -->

The path format parser as a C shared library, so languages with no
tabnas port can parse and validate path input. This is one of the
per-format tabnas clibs sharing the **uniform ABI** decided by ADR-12:
every such library exports the same five symbols, and which library you
load decides which format you parse — so one generic binding per
language covers the whole fleet. Two format clibs consequently cannot
be statically linked into one binary; load them dynamically.

```sh
./build.sh            # host, into ./dist
ZIG=/path/to/zig ./build.sh all
```

## The contract

| Function | Returns |
|---|---|
| `tabnas_version()` | `{"ok":true,"lib":"libtabnaspath","format":"path","template":"v3"}` |
| `tabnas_grammar(opts, len)` | `{"ok":true,"handle":N}` — opts reserved, pass `(NULL, 0)`, unless the format notes below define them |
| `tabnas_parse(handle, src, len)` | `{"ok":true,"accept":true[,"value":…]}` or `{"ok":true,"accept":false,"error":{…}}` |
| `tabnas_grammar_free(handle)` | — |
| `tabnas_free(str)` | — |

The rules every tabnas clib shares, each load-bearing:

1. **Every call returns JSON.** A C ABI has one return value and no
   exceptions; each entry point returns a document, so a binding in any
   language is *call, decode* and the error contract is identical
   everywhere.
2. **Three outcomes, not two.** A broken call is `ok:false` with a
   code; input outside the language is `ok:true, accept:false`; an
   accepted input is `ok:true, accept:true` — plus `value` where the
   parse result is JSON-representable.
3. **A rejection is an answer, not a failure.**
4. **Lengths are explicit.** Buffers are not read as NUL-terminated C
   strings; input may legitimately contain a zero byte.
5. **The caller owns what it is given.** Every `char*` must be released
   with `tabnas_free` (malloc'd — `free(3)`); every handle with
   `tabnas_grammar_free`.

Handles are safe to use from several threads: each carries a mutex,
because the underlying engine is not safe for concurrent Parse and an
FFI caller is under no obligation to serialise.

The grammar is installed **natively** — compiled in-process, not
serialized and reloaded. Lexing configuration is part of the accepted
language, and format plugins keep format-specific behaviour as
closures, which cannot cross a data boundary; see
`admin/notes/2026-08-16-clib-ffi-strategy.md` for the full account.

## Consuming without a binding

C, C++, Zig, Swift, Nim and D consume `include/tabnas.h` directly — no
binding layer exists or is needed. Zig example:

```zig
const c = @cImport(@cInclude("tabnas.h"));
// link against libtabnaspath; every call returns a JSON []u8 to free with
// c.tabnas_free.
```

## Format notes

Path does not change which inputs are accepted. It records the key/index path from the root to each value, so strict JSON decides acceptance (`jsonic.MakeJSON`, the JSON-plus-Path pairing path's README documents). The reply's `value` is not the document. It is the document's leaves in source order, `[{"path":[...],"value":v}]`, one per scalar or empty container (map keys as strings, list indices as integers), and the document can be rebuilt from them. Lenient jsonic is deliberately not the host: Path gets the path wrong for a top-level implicit list (`x,y,z` puts `x` at `[]` and `y` at `[0]`) in both TS and Go, and this ABI must not return wrong paths. The meta `path.base` seed cannot be reached while options are reserved. A value that reaches the capture with no tracked path is a plugin fault and returns `ok:false` (`internal`). Handle creation runs a test parse, so a build without Path fails `tabnas_grammar`.

## Layout

- `core.go` — the behaviour, in plain Go (testable).
- `tabnas_c.go` — the cgo shim: `(pointer, length)` in, malloc'd string
  out, nothing else. (Go forbids cgo in `_test.go`, which is why the
  behaviour lives in `core.go`.)
- `core_test.go` — the contract: accept/reject samples, unknown-handle,
  reserved options, double-free, concurrency under `-race`.
- `include/tabnas.h`, `tabnas.pc.in` — the header and pkg-config file
  for C-header-native consumers.
