// Screenshot every screen and state of a built page, and report what breaks.
//
// Usage: node shoot.mjs <index.html> <out-dir>
// Reads the screen and state keys from build.py's snapshots, then writes:
//   page-<width>.png                       the review page at 375, 1280 and 320
//   <option>-screen-<key>-phone.png        each screen alone at 375 x 812
//   <option>-screen-<key>-desktop.png      each screen alone at 1280 x 800
//   <option>-state-<key>-phone.png         each state alone at 375 x 812
// and prints one line per page error, blank icon or sideways scroll (none: "clean").
// It screenshots; clicking through, hover, focus and disabled stay with the person
// or agent checking the design (gp-design options-workflow.md step 7).
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../../..')
const [index, out] = process.argv.slice(2).map((p) => path.resolve(p))
if (!index || !out) {
  console.error('usage: node shoot.mjs <index.html> <out-dir>')
  process.exit(2)
}
let chromium
try {
  ;({ chromium } = createRequire(path.join(repo, 'package.json'))('playwright'))
} catch {
  console.error(
    `shoot.mjs: playwright not found under ${repo}; run npm ci there first`,
  )
  process.exit(1)
}
mkdirSync(out, { recursive: true })
const html = readFileSync(index, 'utf8')
const keys = [
  ...html.matchAll(/data-gp-snapshot="(option-[abc]) (screen|state) ([^"]+)"/g),
].map((m) => ({
  oid: m[1],
  kind: m[2],
  key: m[3],
}))
const url = pathToFileURL(index).href
const found = []

const browser = await chromium.launch({ channel: 'chromium' })
const open = async (width, height, query) => {
  const ctx = await browser.newContext({ viewport: { width, height } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) =>
    found.push(`page error at ${query || 'page'} ${width}: ${e.message}`),
  )
  await page.goto(url + query)
  await page
    // A screen renders in the frame's scroll area; an open overlay portals into the frame itself.
    .waitForSelector(
      '[data-gp-frame-scroll] *, [data-gp-frame] > :not([data-gp-frame-scroll])',
      { timeout: 10000 },
    )
    .catch(() => {
      found.push(`nothing rendered at ${query || 'page'} ${width}`)
    })
  await page.mouse.move(0, 0)
  const where = `${query || 'page'} at ${width}`
  const r = await page.evaluate(() => ({
    blank: [...document.querySelectorAll('svg')].filter(
      (s) =>
        s.getBoundingClientRect().width > 0 &&
        !s.querySelector('path,circle,rect,line,polyline,polygon,ellipse'),
    ).length,
    page:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
    frame: Math.max(
      0,
      ...[...document.querySelectorAll('[data-gp-frame-scroll]')].map(
        (f) => f.scrollWidth - f.clientWidth,
      ),
    ),
  }))
  if (r.blank) found.push(`${r.blank} blank icon(s) on ${where}`)
  if (r.page > 0)
    found.push(`the page scrolls sideways by ${r.page}px on ${where}`)
  if (r.frame > 0)
    found.push(`a frame scrolls sideways by ${r.frame}px on ${where}`)
  return { ctx, page }
}

for (const [width, height] of [
  [375, 812],
  [1280, 900],
  [320, 700],
]) {
  const { ctx, page } = await open(width, height, '')
  await page.screenshot({
    path: path.join(out, `page-${width}.png`),
    fullPage: true,
  })
  await ctx.close()
}
for (const { oid, kind, key } of keys) {
  const views =
    kind === 'screen'
      ? [
          ['phone', 375, 812],
          ['desktop', 1280, 800],
        ]
      : [['phone', 375, 812]]
  for (const [view, width, height] of views) {
    const query = `?view=${view}&option=${oid.slice(-1)}&${kind === 'screen' ? 'step' : 'state'}=${encodeURIComponent(key)}`
    const { ctx, page } = await open(width, height, query)
    await page.screenshot({
      path: path.join(out, `${oid}-${kind}-${key}-${view}.png`),
    })
    await ctx.close()
  }
}
await browser.close()
console.log(found.length ? found.join('\n') : 'clean')
console.log(`${keys.length} screens and states, screenshots in ${out}`)
process.exit(found.length ? 1 : 0)
