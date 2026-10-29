import { defineConfig } from 'tsup'

export default defineConfig((options) => ({
  entry: {
    index: 'src/index.ts',
    'genui-a2ui': 'src/genui/a2uiCatalog.ts',
  },
  format: ['cjs', 'esm'],
  dts: {
    compilerOptions: { ignoreDeprecations: '6.0' },
  },
  clean: !options.watch,
  sourcemap: true,
  minify: false,
  splitting: false,
}))
