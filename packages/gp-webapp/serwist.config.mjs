import fs from 'node:fs'
import vm from 'node:vm'
import { serwist } from '@serwist/next/config'

// The pages a canvasser or caller keeps working on with no signal: the walk
// and the phone-bank caller, each on the manager and the volunteer surface.
// The precache holds only the code these four need, so a reload with no
// signal still boots them. Everything else is cached as it is fetched.
const OFFLINE_ROUTES = [
  'dashboard/door-knocking',
  'volunteer/door-knocking/[turfId]',
  'dashboard/outreach/phone-banking/[listId]',
  'volunteer/phone-banking/[listId]',
]

// The walk's shell logos, and the worklet the dictation mic loads once its
// socket opens, which can be a second before the signal drops.
const OFFLINE_PUBLIC_FILES = [
  'images/logo/heart.svg',
  'images/logo/heart-white.svg',
  'dictation/pcm-worklet.js',
]

const readClientManifest = (route) => {
  const context = { globalThis: {} }
  vm.runInNewContext(
    fs.readFileSync(
      `.next/server/app/${route}/page_client-reference-manifest.js`,
      'utf8',
    ),
    context,
  )
  return Object.values(context.globalThis.__RSC_MANIFEST)[0]
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

// Paths relative to .next/, e.g. static/chunks/abc.js. Throws when a route's
// manifest is missing, so renaming an offline route fails the build instead
// of quietly shipping a worker that cannot boot the walk offline.
const offlineChunks = () => {
  const files = new Set()
  for (const route of OFFLINE_ROUTES) {
    const client = readClientManifest(route)
    for (const mod of Object.values(client.clientModules)) {
      for (const chunk of mod.chunks) files.add(chunk.replace(/^\/_next\//, ''))
    }
    for (const chunks of Object.values(client.entryJSFiles)) {
      for (const chunk of chunks) files.add(chunk)
    }
    for (const chunks of Object.values(client.entryCSSFiles)) {
      for (const chunk of chunks) files.add(chunk.path)
    }
    const build = readJson(`.next/server/app/${route}/page/build-manifest.json`)
    for (const chunk of [...build.rootMainFiles, ...build.polyfillFiles]) {
      files.add(chunk)
    }
    const loadable = readJson(
      `.next/server/app/${route}/page/react-loadable-manifest.json`,
    )
    for (const entry of Object.values(loadable)) {
      for (const chunk of entry.files) files.add(chunk)
    }
  }
  // A chunk names the async chunks it can load (a lazy import() in the walk,
  // say), and those are in no manifest.
  const queue = [...files]
  while (queue.length > 0) {
    const chunk = queue.pop()
    if (!chunk.endsWith('.js')) continue
    const source = fs.readFileSync(`.next/${chunk}`, 'utf8')
    for (const [named] of source.matchAll(
      /static\/chunks\/[\w.~-]+\.(?:js|css)/g,
    )) {
      if (!files.has(named) && fs.existsSync(`.next/${named}`)) {
        files.add(named)
        queue.push(named)
      }
    }
  }
  return files
}

const keep = new Set([
  ...[...offlineChunks()].map((chunk) => `.next/${chunk}`),
  ...OFFLINE_PUBLIC_FILES.map((file) => `public/${file}`),
])

// Configurator mode: `serwist build` bundles app/sw.ts into public/sw.js after
// `next build`, injecting a precache manifest globbed from the Next output.
// Used instead of the webpack-based `withSerwistInit` because that doesn't
// support Turbopack (Next 16's default builder).
export default serwist({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  // The default globs every file in public/ and every chunk of the app,
  // which every browser downloads on its first visit.
  globPatterns: [
    '.next/static/**/*.{js,css}',
    ...OFFLINE_PUBLIC_FILES.map((file) => `public/${file}`),
  ],
  precachePrerendered: false,
  manifestTransforms: [
    (entries) => ({
      manifest: entries.filter((entry) => keep.has(entry.url)),
      warnings: [],
    }),
  ],
  // Without this, the CLI downlevels the worker to Next's default browserslist
  // (chrome64/safari12/...), which esbuild can't transform some of Serwist's
  // modern syntax to. A service worker only runs in SW-capable (evergreen)
  // browsers, so target a modern baseline instead.
  esbuildOptions: { target: 'es2022' },
})
