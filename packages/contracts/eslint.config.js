const { defineConfig, globalIgnores } = require('eslint/config')

const tsParser = require('@typescript-eslint/parser')
const typescriptEslintEslintPlugin = require('@typescript-eslint/eslint-plugin')
const globals = require('globals')
const js = require('@eslint/js')

const { FlatCompat } = require('@eslint/eslintrc')

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
})

// Lint-only gate for the contracts package. Formatting is intentionally not
// enforced here: this source predates the repo's `semi: false` Prettier style,
// and reformatting it is out of scope for the CI-gates change. The rules below
// mirror the sibling library configs (gp-sdk) so the gate is consistent.
module.exports = defineConfig([
  {
    languageOptions: {
      parser: tsParser,
      sourceType: 'module',

      globals: {
        ...globals.node,
      },
    },

    plugins: {
      '@typescript-eslint': typescriptEslintEslintPlugin,
    },

    extends: compat.extends('plugin:@typescript-eslint/recommended'),

    rules: {
      semi: 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  // src/generated/** is emitted by `generate-enums`; never hand-edited or linted.
  globalIgnores(['dist/', 'src/generated/', 'eslint.config.js']),
])
