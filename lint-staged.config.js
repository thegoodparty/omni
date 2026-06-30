// Pre-commit checks for staged files. Scope mirrors what the repo actually
// enforces — ESLint + Prettier on TypeScript/JavaScript source. We deliberately
// don't Prettier-check yaml/json/markdown here: those (GitHub workflows,
// package-lock, etc.) were never formatted to the repo's Prettier style, so
// checking them would block unrelated commits.
//
// ESLint flat-config lookup is relative to the working directory, but
// lint-staged runs from the repo root while each package owns its own
// eslint.config.* — so --flag v10_config_lookup_from_file makes ESLint resolve
// the nearest package config for each staged file. Packages without a config
// (nest-common, runbooks, styleguide) would make ESLint hard-error
// ("couldn't find an eslint.config file") and block an otherwise-valid commit,
// so we only hand ESLint the files whose package actually has one. Prettier
// needs no per-package config and runs on every matched file.
const { existsSync } = require('node:fs')
const path = require('node:path')

const repoRoot = __dirname
const eslintConfigNames = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
]

function hasEslintConfig(file) {
  let dir = path.dirname(file)
  while (true) {
    if (eslintConfigNames.some((name) => existsSync(path.join(dir, name)))) {
      return true
    }
    if (dir === repoRoot) return false
    const parent = path.dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

const quote = (files) => files.map((file) => `'${file}'`).join(' ')

module.exports = {
  '*.{ts,tsx,mts,cts}': (files) => {
    const tasks = []
    const lintable = files.filter(hasEslintConfig)
    if (lintable.length > 0) {
      tasks.push(`eslint --flag v10_config_lookup_from_file ${quote(lintable)}`)
    }
    tasks.push(`prettier --check ${quote(files)}`)
    return tasks
  },
  '*.{js,jsx,mjs,cjs}': (files) => `prettier --check ${quote(files)}`,
}
