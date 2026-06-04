#!/usr/bin/env node
/* eslint-disable */
// Initializes the `ai-rules` git submodule on `npm install`.
// - No-op if `.gitmodules` is missing (e.g. tarball / non-git contexts).
// - On failure, prints a one-line warning and exits 0 so `npm install` still succeeds.
//   `ai-rules/` is only consumed by the `code-critic` agent locally; the Next build
//   does not depend on it.

const fs = require('fs')
const { execSync } = require('child_process')

if (!fs.existsSync('.gitmodules')) {
  process.exit(0)
}

try {
  execSync('git submodule update --init --recursive', { stdio: 'inherit' })
} catch (err) {
  console.warn(
    '[postinstall] Warning: failed to initialize git submodules. ' +
      '`ai-rules/` will be empty. Run `git submodule update --init --recursive` manually. ' +
      `(${err && err.message ? err.message : err})`,
  )
  process.exit(0)
}
