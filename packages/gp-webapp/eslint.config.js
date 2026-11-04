// Oxlint (.oxlintrc.json) runs every rule it implements, type-aware rules
// included. This config keeps only the rules Oxlint has no equivalent for, so
// it needs no type information.
const globals = require('globals')
const tsParser = require('@typescript-eslint/parser')
const typescriptEslint = require('@typescript-eslint/eslint-plugin')
const react = require('eslint-plugin-react')
const unusedImports = require('eslint-plugin-unused-imports')
const oxlint = require('eslint-plugin-oxlint')
const { builtinRules } = require('eslint/use-at-your-own-risk')

module.exports = [
  {
    ignores: [
      'ai-rules/',
      'e2e-tests/playwright-report/',
      'e2e-tests/test-results/',
      'test-results/',
      'public/',
      '**/.next/**',
      'eslint.config.js',
      // Preserve legacy coverage: ESLint v8 only linted .ts/.tsx (via the
      // overrides). .js/.jsx/.mjs/.cjs were never linted.
      '**/*.js',
      '**/*.jsx',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },

  // eslint-config-next v16 ships a native flat config, so consume it directly.
  // The oxlint config at the end turns off every rule in it that Oxlint runs.
  ...require('eslint-config-next/core-web-vitals'),

  {
    plugins: {
      react,
      'unused-imports': unusedImports,
    },

    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },

    settings: {
      'react-hooks/exhaustive-deps': false,
    },

    // The eslint-disable comments for rules that moved to Oxlint stay in the
    // code, because Oxlint honors them. ESLint would call every one of them
    // unused, and Oxlint would say the same of the comments for rules that
    // stayed here, so neither tool reports unused directives.
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },

    rules: {
      // Automatic JSX runtime (tsconfig jsx: react-jsx) — JSX no longer needs
      // `React` in scope. Turn off the classic-runtime rules so they don't
      // mask the unused-imports rule from stripping vestigial `import React`
      // lines (and so tsc's noUnusedLocals and eslint agree).
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-vars': 'error',
      // Oxlint's no-unused-vars reports unused imports, but its `^_` ignore
      // pattern also exempts `_`-prefixed imports, which this rule never did.
      // Ignoring every other name leaves it reporting only those.
      'unused-imports/no-unused-imports': [
        'error',
        { varsIgnorePattern: '^(?!_)' },
      ],
    },
  },

  {
    files: ['**/*.ts', '**/*.tsx'],

    languageOptions: {
      parser: tsParser,
    },

    plugins: {
      '@typescript-eslint': typescriptEslint,
    },
  },

  {
    // E2E test state declares its dates (e2e-tests/AGENTS.md). A spec that
    // reads a real race's date, or pins a literal one, breaks the day that
    // date passes, on every PR and on the release train at once.
    files: ['e2e-tests/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'Literal[value=/races-by-year/], TemplateElement[value.raw=/races-by-year/]',
          message:
            'Resolve an office with resolveTestRace (GET /v1/test-fixtures/races/resolve), which works whatever the date. races-by-year lists upcoming races only.',
        },
        {
          selector:
            'Property[key.name=/[eE]lectionDate$/] > Literal[value=/^\\d{4}-\\d{2}-\\d{2}$/], VariableDeclarator[id.name=/[eE]lection/] > Literal[value=/^\\d{4}-\\d{2}-\\d{2}$/]',
          message:
            'Declare the election state with a preset (authenticateTestUser { election } or applyElectionPreset) instead of a literal date.',
        },
      ],
    },
  },

  {
    // eslint-config-next v16 bundles react-hooks v6, whose React Compiler
    // correctness rules newly flag ~114 pre-existing call sites (mostly in
    // vendored styleguide/ui components). Adopting them is a repo-wide cleanup
    // tracked separately, not part of the framework bump — so disable them
    // rather than gating CI. Re-enable (to 'error') as the violations are fixed.
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/set-state-in-render': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/globals': 'off',
      'react-hooks/use-memo': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },

  {
    // Both only validate React Compiler configuration, which this app does
    // not enable (gating needs a dynamicGating option, and none is set), yet
    // either one keeps ESLint running the compiler's analysis on every file.
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'react-hooks/config': 'off',
      'react-hooks/gating': 'off',
    },
  },

  {
    // Dev's database is long-lived and shared by every E2E worker, shard, PR
    // run and earlier run, so a literal EIN or phone number in a spec collides
    // across all of them (#3117). Generate one with
    // e2e-tests/src/helpers/testIdentifiers.helper.ts. A deliberately invalid
    // input a validation spec asserts on, or a value a vendor mock always
    // returns, takes an eslint-disable-next-line naming why.
    //
    // Its own name for the core no-restricted-syntax rule: flat config replaces
    // a rule's options per block rather than merging them, so sharing the core
    // name with another e2e guard would switch that guard off, and one disable
    // comment would silence both.
    files: ['e2e-tests/**/*.ts'],
    ignores: [
      // Owned by in-flight PRs that are reworking these files (release-train
      // reliability plan, report item M2). Drop each entry once its PR lands
      // and the literals move to the helper, or carry a disable comment.
      'e2e-tests/tests/app/dashboard/pro-upgrade/**',
      'e2e-tests/src/helpers/pro-upgrade.helper.ts',
    ],
    plugins: {
      'e2e-ids': {
        rules: {
          'no-literal-identifiers': builtinRules.get('no-restricted-syntax'),
        },
      },
    },
    rules: {
      'e2e-ids/no-literal-identifiers': [
        'error',
        ...[
          ['EIN', '^\\d{2}-\\d{7}$'],
          [
            'phone number',
            '^(\\+?1[ .-]?)?(\\(\\d{3}\\)|\\d{3})[ .-]?\\d{3}[ .-]?\\d{4}$',
          ],
        ].flatMap(([kind, pattern]) =>
          [
            `Literal[value=/${pattern}/]`,
            `TemplateLiteral[expressions.length=0] > TemplateElement[value.raw=/${pattern}/]`,
          ].map((selector) => ({
            // A placeholder is a selector for the field, not data.
            selector: `${selector}:not(CallExpression[callee.property.name='getByPlaceholder'] > Literal)`,
            message: `Literal ${kind} in an E2E spec. Dev's database is shared by every run, so generate one with src/helpers/testIdentifiers.helper.ts.`,
          })),
        ),
      ],
    },
  },
  ...oxlint.buildFromOxlintConfigFile(`${__dirname}/.oxlintrc.json`),
  {
    // Oxlint runs these too, but eslint-plugin-oxlint does not map them.
    rules: {
      'react/require-render-return': 'off',
      'react-hooks/rules-of-hooks': 'off',
    },
  },
]
