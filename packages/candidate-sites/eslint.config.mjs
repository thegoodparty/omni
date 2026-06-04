import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

const eslintConfig = [
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
]

export default eslintConfig
