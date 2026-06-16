import { serwist } from '@serwist/next/config'

// Configurator mode: `serwist build` bundles app/sw.ts into public/sw.js after
// `next build`, injecting a precache manifest globbed from the Next output.
// Used instead of the webpack-based `withSerwistInit` because that doesn't
// support Turbopack (Next 16's default builder).
export default serwist({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  // Without this, the CLI downlevels the worker to Next's default browserslist
  // (chrome64/safari12/...), which esbuild can't transform some of Serwist's
  // modern syntax to. A service worker only runs in SW-capable (evergreen)
  // browsers, so target a modern baseline instead.
  esbuildOptions: { target: 'es2022' },
})
