# ci/

Staging area for GitHub Actions workflow changes.

This directory exists because session credentials cannot write
`.github/workflows/*` — see admin `DECISIONS.md` ADR-8. To change CI:

1. Put the intended workflow file in `workflows/`.
2. A maintainer promotes it with the admin `rollout/apply-ci-folders.sh`
   script.

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
