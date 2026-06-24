import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

const styleguideRoot = path.resolve(__dirname, '../styleguide/src')
const prototypesRoot = path.resolve(__dirname, 'app')

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@styleguide\/(.*)$/,
        replacement: `${styleguideRoot}/$1`,
      },
      {
        find: '@styleguide',
        replacement: styleguideRoot,
      },
      {
        find: /^@\/(.*)$/,
        replacement: `${prototypesRoot}/$1`,
      },
    ],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
})
