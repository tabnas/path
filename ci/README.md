# ci/

The scripts the CI workflows run, kept here so that you can run the same
gate locally: `rust/run.sh` is the Rust gate, and
`.github/workflows/rust.yml` runs it (see "What still lives here").

To change CI, edit `.github/workflows/` in a reviewed pull request.
Session credentials push workflow files (admin `DECISIONS.md` ADR-8, as
amended 2026-09-24), so staging a workflow here first for a maintainer
to promote is optional. Two cases also involve admin:

- A workflow admin keeps a template for
  (`rollout/workflows/path__<file>`) is mirrored in that template at
  the same time, or admin `scripts/verify.sh` reports the drift and a
  maintainer's next `rollout/apply-workflows.sh --apply` would push the
  old text back.
- The stamped `clib.yml` and `clib-release.yml` (each carries a
  `tabnas-clib-template` marker) are never edited by hand. Change admin
  `tasks/clib-template/` and re-stamp with `tasks/adopt-clib.sh`, which
  writes both workflows straight into `.github/workflows/`. The new stamp
  lands in this repository's own reviewed pull request. Admin
  `scripts/verify.sh` reports a stamped file that differs from its
  template.

Sessions still cannot push tags, so a maintainer pushes any tag that a
tag-triggered workflow needs.

## Promoted, 2026-09-22

Both files that were staged here are now live, moved by the rollout
script rather than edited: `workflows/docs.yml` is
`.github/workflows/docs.yml` and `workflows/rust.yml` is
`.github/workflows/rust.yml`. Nothing is pending. Read the workflows
themselves rather than a description of them here.

## What still lives here

- **`rust/run.sh`** is the Rust gate itself: `rs/` built, tested
  (fixtures, in-language cases and doctests), `rustfmt`-checked, and
  clippy-clean at `-D warnings`, with a lockfile check.
  `.github/workflows/rust.yml` calls it and you can run it too;
  `make test-rs` stays the fast inner loop.

  The workflow clones three siblings itself: `tabnas/parser` (the
  engine, the crate's only dependency), `tabnas/support` (the shared
  fixture runner), and `tabnas/json` (the grammar the README example is
  tested on), because `rs/Cargo.toml` takes each as a path dependency.
  That is also why the gate does **not** pass `--locked`: the lock
  records each sibling by version, so once one of them bumps, `--locked`
  would fail every pull request here, including ones touching no Rust.
  See the comment in `ci/rust/run.sh`.
