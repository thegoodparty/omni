import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

const styleguideRoot = path.resolve(__dirname, 'src')

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
    ],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
})
