// Pre-commit checks for staged files. Scope mirrors what the repo actually
// enforces — ESLint + Prettier on TypeScript/JavaScript source. We deliberately
// don't Prettier-check yaml/json/markdown here: those (GitHub workflows,
// package-lock, etc.) were never formatted to the repo's Prettier style, so
// checking them would block unrelated commits.
//
// ESLint flat-config lookup is relative to the working directory, but
// lint-staged runs from the repo root while each package owns its own
// eslint.config.* — so --flag v10_config_lookup_from_file makes ESLint resolve
// the nearest package config for each staged file.
module.exports = {
  '*.{ts,tsx,mts,cts}': [
    'eslint --flag v10_config_lookup_from_file',
    'prettier --check',
  ],
  '*.{js,jsx,mjs,cjs}': ['prettier --check'],
}
