// Build the flows of a review page from real styleguide components.
//
// Usage: node build.mjs <work-dir> <out-dir>
// Reads <work>/flow/option-[abc].tsx and writes to <out-dir>:
//   flow.js        the flows and the page runtime (mount.tsx), one IIFE
//   flow.css       gp-webapp's globals.css compiled by Tailwind v4 for what the flows use,
//                  with width media queries turned into container queries on the frame
//   snapshot.json  every screen and state as static HTML at phone width, for check.py
// build.py inlines all three into index.html. Needs the repo's node_modules (npm ci).
import { createRequire } from 'node:module'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const runtime = path.join(here, 'runtime')
const repo = path.resolve(here, '../../../../..')
const [work, out] = process.argv.slice(2).map((p) => path.resolve(p))
if (!work || !out) {
  console.error('usage: node build.mjs <work-dir> <out-dir>')
  process.exit(2)
}
const webapp = path.join(repo, 'packages/gp-webapp')
const styleguide = path.join(repo, 'packages/styleguide/src')
const req = createRequire(path.join(webapp, 'package.json'))
let esbuild, postcss, tailwind
try {
  esbuild = req('esbuild')
  postcss = req('postcss')
  tailwind = req('@tailwindcss/postcss')
} catch {
  console.error(
    `build.mjs: esbuild, postcss or @tailwindcss/postcss not found under ${repo}; run npm ci there first`,
  )
  process.exit(1)
}

const flowDir = path.join(work, 'flow')
const files = existsSync(flowDir)
  ? readdirSync(flowDir)
      .filter((f) => /^option-[abc]\.tsx$/.test(f))
      .sort()
  : []
if (!files.length) {
  console.error(
    `build.mjs: no flow files in ${flowDir} (option-a.tsx, from assets/flow-template.tsx)`,
  )
  process.exit(1)
}
mkdirSync(out, { recursive: true })
const gen = path.join(out, '.gp-flow')
mkdirSync(gen, { recursive: true })
const imports = files
  .map(
    (f, i) => `import * as f${i} from ${JSON.stringify(path.join(flowDir, f))}`,
  )
  .join('\n')
const table = `{ ${files.map((f, i) => `${JSON.stringify(f.replace('.tsx', ''))}: f${i}`).join(', ')} }`
writeFileSync(
  path.join(gen, 'page.tsx'),
  `${imports}\nimport { mount } from ${JSON.stringify(path.join(runtime, 'mount.tsx'))}\nmount(${table} as never)\n`,
)
// A flow with no products export is the page's one product (<main data-product>).
const src = path.join(work, 'page/src.html')
const pageProduct =
  existsSync(src) &&
  /<main\b[^>]*\bdata-product="win"/.test(readFileSync(src, 'utf8'))
    ? 'win'
    : 'serve'
writeFileSync(
  path.join(gen, 'snapshot.tsx'),
  `${imports}\nimport { snapshot } from ${JSON.stringify(path.join(runtime, 'snapshot.tsx'))}\nexport default snapshot(${table} as never, '${pageProduct}')\n`,
)

// The frame stands in for the window: these imports resolve to runtime/ shims.
const realPortal = req
  .resolve('@radix-ui/react-portal')
  .replace(/index\.js$/, 'index.mjs')
const shims = (server) => ({
  name: 'gp-flow',
  setup(b) {
    b.onResolve({ filter: /^aria-hidden$/ }, () => ({
      path: path.join(runtime, 'aria-hidden.ts'),
    }))
    // vaul reads document while it renders; the snapshot draws a drawer's parts in place.
    if (server)
      b.onResolve({ filter: /^vaul$/ }, () => ({
        path: path.join(runtime, 'vaul-static.tsx'),
      }))
    b.onResolve({ filter: /^gp-flow$/ }, () => ({
      path: path.join(runtime, 'index.tsx'),
    }))
    b.onResolve({ filter: /^@styleguide\/hooks\/use-mobile$/ }, () => ({
      path: path.join(runtime, 'use-mobile.ts'),
    }))
    b.onResolve({ filter: /^@radix-ui\/react-portal$/ }, () => ({
      path: path.join(runtime, 'portal.tsx'),
    }))
    b.onResolve({ filter: /^gp-radix-portal$/ }, () => ({ path: realPortal }))
    b.onResolve({ filter: /^react-remove-scroll$/ }, () => ({
      path: path.join(runtime, 'remove-scroll.tsx'),
    }))
    b.onResolve(
      { filter: /^(@styleguide|@goodparty_org\/styleguide)$/ },
      () => ({ path: path.join(styleguide, 'index.ts') }),
    )
  },
})
const common = {
  bundle: true,
  write: false,
  jsx: 'automatic',
  alias: { '@styleguide': styleguide },
  nodePaths: [
    path.join(repo, 'node_modules'),
    path.join(webapp, 'node_modules'),
  ],
  logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"' },
}
const page = await esbuild.build({
  ...common,
  entryPoints: [path.join(gen, 'page.tsx')],
  plugins: [shims(false)],
  format: 'iife',
  minify: true,
  platform: 'browser',
})
const ssr = await esbuild.build({
  ...common,
  entryPoints: [path.join(gen, 'snapshot.tsx')],
  plugins: [shims(true)],
  format: 'cjs',
  platform: 'node',
})
const ssrFile = path.join(gen, 'snapshot.cjs')
writeFileSync(ssrFile, ssr.outputFiles[0].text)
const snap = createRequire(import.meta.url)(ssrFile).default

// gp-webapp's own globals.css, so the flows get the product's base layer, theme and
// utilities. Tailwind scans the styleguide, the runtime and these flows only.
const globalsPath = path.join(webapp, 'app/globals.css')
const appDir = path.dirname(globalsPath)
let css = readFileSync(globalsPath, 'utf8')
  .replace(
    /@import '(\.\.?\/[^']+)'/g,
    (_, p) => `@import '${path.resolve(appDir, p)}'`,
  )
  .replace(/^@source .*$/gm, '')
css += `\n@source "${styleguide}";\n@source "${runtime}";\n@source "${flowDir}";\n`
const compiled = (
  await postcss([tailwind({ base: appDir })]).process(css, {
    from: globalsPath,
  })
).css

// Width media queries become container queries on the frame, and viewport units
// container units, so lg:, md: and h-dvh answer to the frame, not the window.
const onlyWidth = (q) =>
  q
    .split(/\s+and\s+/)
    .every((p) =>
      /^\((?:min-|max-)?width\s*:[^()]*\)$|^\(width\s*[<>]=?[^()]*\)$|^\([^()]*[<>]=?\s*width\s*[<>]=?[^()]*\)$/.test(
        p.trim(),
      ),
    )
const font = readFileSync(
  path.join(appDir, 'fonts/open-sans-latin-wght-normal.woff2'),
).toString('base64')
// Rewrite only at-rule params and declaration values: a class name like
// max-h-[80vh] has to stay as Tailwind wrote it, or it no longer matches.
const root = postcss.parse(compiled)
root.walkAtRules('media', (rule) => {
  if (onlyWidth(rule.params)) {
    rule.name = 'container'
    rule.params = `gp-frame ${rule.params}`
  }
})
root.walkDecls((decl) => {
  decl.value = decl.value
    .replace(/(\d*\.?\d+)(?:d|s|l)?vh\b/g, '$1cqh')
    .replace(/(\d*\.?\d+)(?:d|s|l)?vw\b/g, '$1cqw')
})
const frameCss =
  `@font-face{font-family:'Open Sans';src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:300 800;font-style:normal;font-display:swap}\n` +
  `html{--open-sans-font:'Open Sans'}\n` +
  root.toString() +
  `\n[data-gp-frame]{container:gp-frame/size;transform:translateZ(0);overflow:hidden;position:relative;background:var(--color-background);color:var(--color-foreground);font-family:var(--open-sans-font)}\n` +
  `[data-gp-frame-scroll]{height:100%;overflow-y:auto;overflow-x:hidden}\n` +
  // Radix sets pointer-events:none on <body> under a modal; the review page stays usable.
  `body{pointer-events:auto!important}\n`

writeFileSync(path.join(out, 'flow.js'), page.outputFiles[0].text)
writeFileSync(path.join(out, 'flow.css'), frameCss)
writeFileSync(path.join(out, 'snapshot.json'), JSON.stringify(snap))
console.log(
  `built ${files.join(', ')}: js ${Math.round(page.outputFiles[0].text.length / 1024)} KB, css ${Math.round(frameCss.length / 1024)} KB`,
)
