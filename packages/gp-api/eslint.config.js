// Oxlint (.oxlintrc.json) runs every rule it implements, type-aware rules
// included. This config keeps only the rules Oxlint has no equivalent for, so
// it needs no type information and stays fast.
const { defineConfig, globalIgnores } = require('eslint/config')

const tsParser = require('@typescript-eslint/parser')
const typescriptEslintEslintPlugin = require('@typescript-eslint/eslint-plugin')
const unusedImports = require('eslint-plugin-unused-imports')
const sonarjs = require('eslint-plugin-sonarjs')
const simpleImportSort = require('eslint-plugin-simple-import-sort')
const oxlint = require('eslint-plugin-oxlint')

module.exports = defineConfig([
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],

    languageOptions: {
      parser: tsParser,
      sourceType: 'module',
    },

    // The eslint-disable comments for rules that moved to Oxlint stay in the
    // code, because Oxlint honors them. ESLint would call every one of them
    // unused, and Oxlint would say the same of the comments for rules that
    // stayed here, so neither tool reports unused directives.
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },

    plugins: {
      '@typescript-eslint': typescriptEslintEslintPlugin,
      'unused-imports': unusedImports,
      sonarjs,
      'simple-import-sort': simpleImportSort,
    },

    rules: {
      // Oxlint's no-unused-vars reports unused imports, but its `^_` ignore
      // pattern also exempts `_`-prefixed imports, which this rule never did.
      // Ignoring every other name leaves it reporting only those.
      'unused-imports/no-unused-imports': [
        'error',
        { varsIgnorePattern: '^(?!_)' },
      ],

      // SonarJS Bug Detection (error - high confidence bugs)
      'sonarjs/no-all-duplicated-branches': 'error',
      'sonarjs/no-identical-expressions': 'error',
      'sonarjs/no-identical-conditions': 'error',
      'sonarjs/non-existent-operator': 'error',

      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'class',
          format: ['PascalCase'],
        },
        {
          selector: 'interface',
          format: ['PascalCase'],
        },
        {
          selector: 'typeAlias',
          format: ['PascalCase'],
        },
        {
          selector: 'enum',
          format: ['PascalCase'],
        },
        {
          selector: 'enumMember',
          format: ['PascalCase', 'UPPER_CASE', 'camelCase'],
        },
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase'],
        },
        {
          // Destructured variables often mirror external API or DB column names
          selector: 'variable',
          modifiers: ['destructured'],
          format: null,
        },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allowSingleOrDouble',
        },
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
      ],

      // Disabled Auto-Fix Rules (Phase 2):
      // The following rules are imported but not enabled due to auto-fix spam.
      // They will be re-enabled in a separate PR after team approval:
      //
      // "simple-import-sort/imports": "error",
      // "simple-import-sort/exports": "error",
      // "@typescript-eslint/consistent-type-definitions": ["error", "type"],
    },
  },
  globalIgnores([
    '**/.eslintrc.js',
    '**/.eslintrc.test.js',
    'eslint.config.js',
  ]),
  // The election schema is owned by ETL, not by us: every Prisma relation on it
  // is PascalCase (`Position`, `Race`, `OfficeHolder`). Destructuring a query
  // result therefore binds a PascalCase variable, which naming-convention
  // rejects for the variable/parameter selectors. We cannot rename the
  // relations, so scope the rule off here rather than scatter inline disables
  // through every ported service. The unsafe-* family stays on.
  {
    files: ['src/electionDb/**/*.ts'],

    rules: {
      '@typescript-eslint/naming-convention': 'off',
    },
  },
  {
    files: ['seed/**/*.ts'],

    rules: {
      '@typescript-eslint/naming-convention': 'off',
    },
  },
  // `deploy/` (Pulumi IaC) is excluded from tsconfig.json and from the `lint`
  // script's glob. Ignore it here so the pre-commit hook (which lints staged
  // files per package) stays consistent with the rest of the toolchain;
  // Prettier still formats these files via lint-staged.
  globalIgnores(['**/generated/', '**/dist/', 'deploy/']),
  ...oxlint.buildFromOxlintConfigFile(`${__dirname}/.oxlintrc.json`),
])
