/* Copyright (c) 2026 Richard Rodger, MIT License */

// The exported VERSION must equal package.json "version".
//
// This is the CI check for version drift. It exists because the constant HAS
// drifted: @tabnas/json exported Version = '1.0.0' for several releases while
// the package shipped 0.4.x, and jsonic-cli shipped 0.4.1 and 0.4.2 with its
// Go const stuck at 0.4.0. Nothing rewrote them and nothing checked them, so
// both were invisible until someone read the file. A release that bumps
// package.json and forgets the constant now fails here.

import { describe, test } from 'node:test'
import assert from 'node:assert'

// Loaded with require, not import: package.json and the package root both sit
// outside this tsconfig's rootDir. A throw here fails the file loudly — the
// check is never silently skipped, which is the failure mode it guards.
const pkg = require('../package.json')
const api = require('..')

describe('version', () => {

  test('VERSION matches package.json', () => {
    assert.equal(
      api.VERSION,
      pkg.version,
      `VERSION drift: ${pkg.name} exports ${api.VERSION} but package.json is ` +
        `${pkg.version}. Both are rewritten by admin/publish.sh at release; ` +
        `if you bumped one by hand, bump the other.`,
    )
  })

  test('VERSION is exported and looks like a semver', () => {
    assert.equal(typeof api.VERSION, 'string', 'VERSION must be exported as a string')
    assert.match(api.VERSION, /^\d+\.\d+\.\d+/, 'VERSION must be a semver')
  })

})
