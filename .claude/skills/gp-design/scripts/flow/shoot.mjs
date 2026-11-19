// Screenshot every screen and state of a built page, and report what breaks.
//
// Usage: node shoot.mjs <index.html> <out-dir>
// Reads the screen and state keys from build.py's snapshots, then writes:
//   page-<width>.png                       the review page at 375, 1280 and 320
//   <option>-screen-<key>-phone.png        each screen alone at 375 x 812
//   <option>-screen-<key>-desktop.png      each screen alone at 1280 x 800
//   <option>-screen-<key>-1023.png, -1024.png  each screen either side of lg:
//   <option>-state-<key>-phone.png         each state alone at 375 x 812
//   ...-full.png                           the same shot at the screen's full height, when
//                                          something in the frame scrolls (below the fold)
// It clicks every visible data-go on every screen at 375 and checks it opens the
// screen it names. It waits for open overlays to finish animating, and prints one
// line per page error, blank icon, sideways scroll, dead data-go, or two different
// screens that came out identical (none: "clean").
// It runs axe-core inside the frame on every phone and desktop shot and prints one
// line per serious or critical accessibility rule broken, with the shots and the
// elements (selector and markup) it broke on.
// Shots run several at a time (GP_SHOOT_JOBS, default 6).
// Hover, focus, disabled, and state kept across a path of several screens stay with
// the person or agent checking the design (gp-design options-workflow.md step 7).
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
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
let axeSource = null
try {
  axeSource = readFileSync(
    createRequire(path.join(repo, 'package.json')).resolve(
      'axe-core/axe.min.js',
    ),
    'utf8',
  )
} catch {
  found.push('axe-core not found under the repo: accessibility not checked')
}
// rule id -> { impact, help, shots }
const a11y = new Map()
// The frame is a fragment of a page, so page-level rules don't apply to it.
const pageRules = [
  'region',
  'landmark-one-main',
  'page-has-heading-one',
  'html-has-lang',
  'document-title',
  'bypass',
]
const audit = async (page, shot) => {
  if (!axeSource) return
  await page.addScriptTag({ content: axeSource })
  const violations = await page.evaluate(async (off) => {
    const res = await window.axe.run(
      { include: [['[data-gp-frame]']] },
      {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag22aa'] },
        rules: Object.fromEntries(off.map((r) => [r, { enabled: false }])),
        resultTypes: ['violations'],
      },
    )
    return res.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.map(
          (n) =>
            `${n.target.join(' ')} ${n.html.replace(/\s+/g, ' ').slice(0, 80)}`,
        ),
      }))
  }, pageRules)
  for (const v of violations) {
    const seen = a11y.get(v.id) ?? { ...v, shots: [], elements: new Set() }
    seen.shots.push(shot)
    for (const n of v.nodes) seen.elements.add(n)
    a11y.set(v.id, seen)
  }
}
// Run jobs a few at a time; each opens its own context, so they don't share state.
const pool = async (jobs, size = Number(process.env.GP_SHOOT_JOBS) || 6) => {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, jobs.length) }, async () => {
      while (next < jobs.length) await jobs[next++]()
    }),
  )
}

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
  // Drawers and dialogs slide in: shoot once nothing is still running, up to 3 s.
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .every(
            (a) =>
              a.playState !== 'running' ||
              a.effect?.getTiming().iterations === Infinity,
          ),
      undefined,
      { timeout: 3000 },
    )
    .catch(() => {})
  await page.waitForTimeout(150)
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
  // Below 375 the review page squeezes its frames under any real phone's width, so
  // the frames are checked in their own ?view= shots instead.
  if (r.frame > 0 && (query || width >= 375))
    found.push(`a frame scrolls sideways by ${r.frame}px on ${where}`)
  return { ctx, page }
}

const pageJobs = [
  [375, 812],
  [1280, 900],
  [320, 700],
].map(([width, height]) => async () => {
  const { ctx, page } = await open(width, height, '')
  await page.screenshot({
    path: path.join(out, `page-${width}.png`),
    fullPage: true,
  })
  await ctx.close()
})
// How far the tallest scrolling area inside the frame runs past its box.
const overflow = (page) =>
  page.evaluate(() => {
    const frame = document.querySelector('[data-gp-frame]')
    if (!frame) return 0
    let most = 0
    for (const el of [frame, ...frame.querySelectorAll('*')]) {
      const o = getComputedStyle(el).overflowY
      if (o === 'auto' || o === 'scroll')
        most = Math.max(most, el.scrollHeight - el.clientHeight)
    }
    return most
  })
// Grow the frame until nothing in it scrolls, so a screen that fills the viewport
// (h-dvh, a scrolling body) shows everything below the fold.
const shootFull = async (page, file) => {
  let extra = await overflow(page)
  if (extra <= 1) return null
  for (let i = 0; i < 4 && extra > 1; i++) {
    await page.evaluate((add) => {
      const frame = document.querySelector('[data-gp-frame]')
      const h = frame.getBoundingClientRect().height
      frame.style.height = `${h + add}px`
      frame.style.maxHeight = 'none'
    }, extra)
    await page.waitForTimeout(150)
    extra = await overflow(page)
  }
  const frame = await page.$('[data-gp-frame]')
  return frame.screenshot({ path: file })
}
// Options may share a screen (the entry, a landing step), so compare within one option.
const hashes = new Map()
const remember = (buf, name, oid) => {
  const h = oid + createHash('sha256').update(buf).digest('hex')
  if (hashes.has(h))
    found.push(
      `${name} looks exactly like ${hashes.get(h)}: check that it opens what its key says`,
    )
  else hashes.set(h, name)
}
const shotJobs = []
for (const { oid, kind, key } of keys) {
  // 1023 and 1024 sit either side of lg:, where a Drawer becomes a Dialog.
  const views =
    kind === 'screen'
      ? [
          ['phone', 'phone', 375, 812],
          ['desktop', 'desktop', 1280, 800],
          ['desktop', '1023', 1023, 800],
          ['desktop', '1024', 1024, 800],
        ]
      : [['phone', 'phone', 375, 812]]
  for (const [view, label, width, height] of views)
    shotJobs.push(async () => {
      const query = `?view=${view}&option=${oid.slice(-1)}&${kind === 'screen' ? 'step' : 'state'}=${encodeURIComponent(key)}`
      const { ctx, page } = await open(width, height, query)
      const name = `${oid}-${kind}-${key}-${label}`
      const shot = await page.screenshot({
        path: path.join(out, `${name}.png`),
      })
      const full = await shootFull(page, path.join(out, `${name}-full.png`))
      if (label === 'phone' || label === 'desktop') {
        remember(full ?? shot, `${name}${full ? '-full' : ''}.png`, oid)
        await audit(page, name)
      }
      await ctx.close()
    })
}
// Click every visible data-go on every screen, each from a fresh load at 375, and
// check it opens the screen it names: a covered, disabled or dead control shows here.
let clicks = 0
const clickJobs = keys
  .filter((k) => k.kind === 'screen')
  .map(({ oid, key }) => async () => {
    const query = `?view=phone&option=${oid.slice(-1)}&step=${encodeURIComponent(key)}`
    const probe = await open(375, 812, query)
    const targets = await probe.page.$$eval(
      '[data-gp-frame] [data-go]',
      (els) =>
        els.map((e, i) => {
          // Under an open dialog or drawer only its own controls can be clicked.
          const modal = document.querySelector(
            '[data-gp-frame] [role="dialog"], [data-gp-frame] [role="alertdialog"]',
          )
          return {
            i,
            go: e.getAttribute('data-go'),
            visible:
              e.getClientRects().length > 0 && (!modal || modal.contains(e)),
          }
        }),
    )
    await probe.ctx.close()
    for (const t of targets.filter((t) => t.visible)) {
      const { ctx, page } = await open(375, 812, query)
      const el = (await page.$$('[data-gp-frame] [data-go]'))[t.i]
      clicks++
      try {
        await el.click({ timeout: 3000 })
        await page.waitForTimeout(250)
        const now = await page
          .$eval('[data-gp-step]', (e) => e.getAttribute('data-gp-step'))
          .catch(() => null)
        if (now !== t.go)
          found.push(
            `${oid} screen ${key}: data-go="${t.go}" opened ${now ?? 'nothing'}`,
          )
      } catch (e) {
        found.push(
          `${oid} screen ${key}: can't click data-go="${t.go}" (${String(e.message).split('\n')[0]})`,
        )
      }
      await ctx.close()
    }
  })
await pool([...pageJobs, ...shotJobs, ...clickJobs])
await browser.close()
for (const [id, v] of a11y) {
  found.push(
    `accessibility ${v.impact}: ${id} (${v.help}) on ${v.shots.length} shot(s): ${v.shots.slice(0, 4).join(', ')}${v.shots.length > 4 ? ', ...' : ''}`,
  )
  // The element to fix: its selector inside the frame and the start of its markup.
  for (const el of [...v.elements].slice(0, 5)) found.push(`  at ${el}`)
}
console.log(found.length ? found.join('\n') : 'clean')
console.log(`${clicks} data-go clicks checked`)
console.log(`${keys.length} screens and states, screenshots in ${out}`)
process.exit(found.length ? 1 : 0)
