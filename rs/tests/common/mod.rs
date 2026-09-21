// Shared test scaffolding: the local host grammar and the path-capture
// hook the suites parse against.
//
// Cargo compiles this module into EVERY integration test binary, so a
// helper only one of them uses reads as dead code in the others. The
// allow is about that compilation model, not about unused code.
#![allow(dead_code)]

pub mod fixture;
