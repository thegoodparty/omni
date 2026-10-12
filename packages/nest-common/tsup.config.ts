import { defineConfig } from 'tsup'

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: {
    compilerOptions: { ignoreDeprecations: '6.0' },
  },
  clean: !options.watch,
  sourcemap: true,
  minify: false,
  splitting: false,
}))
