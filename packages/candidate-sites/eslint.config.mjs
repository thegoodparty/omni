import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

const eslintConfig = [
  {
    ignores: ['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'ai-rules/**'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  ...compat.config({
    plugins: ['react', 'unused-imports', '@stylistic'],
    settings: {
      'react-hooks/exhaustive-deps': false,
    },
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
    },
  }),
  {
    rules: {
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'unused-imports/no-unused-imports': 'error',
      '@stylistic/semi': ['error', 'never'],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // CommonJS config files (e.g. tailwind.config.js) legitimately use require().
    files: ['**/*.config.{js,cjs}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]

export default eslintConfig
