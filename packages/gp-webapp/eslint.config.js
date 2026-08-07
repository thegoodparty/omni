const js = require('@eslint/js')
const globals = require('globals')
const tsParser = require('@typescript-eslint/parser')
const typescriptEslint = require('@typescript-eslint/eslint-plugin')
const react = require('eslint-plugin-react')
const unusedImports = require('eslint-plugin-unused-imports')
const stylistic = require('@stylistic/eslint-plugin')

const { FlatCompat } = require('@eslint/eslintrc')

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
})

module.exports = [
  {
    ignores: [
      'ai-rules/',
      'e2e-tests/playwright-report/',
      'e2e-tests/test-results/',
      'e2e-tests/**/*.md',
      'test-results/',
      'styleguide/*.md',
      'public/',
      // Agent docs at any depth. AGENTS.md is the real file and CLAUDE.md a symlink
      // to it, so an unprefixed pattern would leave every nested pair linted twice.
      '**/AGENTS.md',
      '**/CLAUDE.md',
      'docs/*.md',
      '.claude/**/*.md',
      '**/.next/**',
      '**/.storybook/**',
      'eslint.config.js',
      // Preserve legacy coverage: ESLint v8 only linted .ts/.tsx (via the
      // overrides) and .md (via mdx). .js/.jsx/.mjs/.cjs were never linted.
      '**/*.js',
      '**/*.jsx',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },

  // eslint-config-next v16 ships a native flat config, so consume it directly.
  // mdx still lacks a flat preset, so it stays on FlatCompat.
  ...require('eslint-config-next/core-web-vitals'),
  ...compat.extends('plugin:mdx/recommended'),

  {
    plugins: {
      react,
      'unused-imports': unusedImports,
      '@stylistic': stylistic,
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
      'mdx/code-blocks': true,
      'react-hooks/exhaustive-deps': false,
      'mdx/language-mapper': {},
    },

    rules: {
      '@stylistic/semi': ['error', 'never'],
      // Automatic JSX runtime (tsconfig jsx: react-jsx) — JSX no longer needs
      // `React` in scope. Turn off the classic-runtime rules so they don't
      // mask the unused-imports rule from stripping vestigial `import React`
      // lines (and so tsc's noUnusedLocals and eslint agree).
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-vars': 'error',
      'unused-imports/no-unused-imports': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@mui/*', '@emotion/*'],
              message:
                'MUI and Emotion have been removed. Use @styleguide components instead.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['styleguide/stories/**'],

    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: true,
        tsconfigRootDir: __dirname,
      },
    },

    plugins: {
      '@typescript-eslint': typescriptEslint,
    },

    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-useless-constructor': 'error',
      '@typescript-eslint/no-empty-function': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          vars: 'all',
          args: 'all',
          ignoreRestSiblings: false,
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx'],

    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },

  {
    files: ['styleguide/stories/**/*.ts', 'styleguide/stories/**/*.tsx'],

    languageOptions: {
      parser: tsParser,
    },

    plugins: {
      '@typescript-eslint': typescriptEslint,
    },

    rules: {
      'react-hooks/rules-of-hooks': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-useless-constructor': 'error',
      '@typescript-eslint/no-empty-function': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          vars: 'all',
          args: 'all',
          ignoreRestSiblings: false,
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
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
]
