#!/usr/bin/env node
// Animation-asset ratchet.
//
// Counts the Lottie JSON assets shipped from this package and fails (exit 1)
// if that count exceeds the committed baseline below. Unlike the other
// ratchets here, the point is NOT primarily bundle size. It is that reaching
// for an animation should be a deliberate design decision rather than a
// default, and nothing in the repo used to make that decision visible.
//
// What went wrong without it: nine Lottie files accumulated over eighteen
// months, one every six weeks or so. Five of them ended up with no callers at
// all and nobody noticed, and survey.json sat at 2.4MB for eighteen months
// decorating an empty state a user sees once. None of that was a bad call by
// anyone; a large JSON blob in a PR diff simply looks like every other
// collapsed blob, so there was no moment where a reviewer was asked the
// question.
//
// RATCHET POLICY:
//   - When you REMOVE an animation, lower BASELINE to the count this script
//     prints. That locks in the win.
//   - Do NOT raise BASELINE to make a red build green. A new animation is a
//     design decision: get a designer to make it, then raise the baseline in
//     the SAME PR with a one-line note saying who asked for it and what it
//     does that a static icon cannot.
//
// Before adding one, the escalation is: a motion token from
// `Foundations/Motion` in Storybook, then a styleguide component, then a
// static icon from the approved set, and only then an animation.
//
// Scope note: this counts Lottie JSON only. Static illustrations (SVG, PNG)
// are deliberately out of scope, because the same rule over every image in
// the package would fire on icons and logos and get ignored. The judgment
// call for those lives in AGENTS.md rather than here.
//
// Run: `npm run check:animation-assets -w packages/gp-webapp`

import { readdir, readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

// Lower this when you remove animations; never raise it without a designer's
// sign-off (see RATCHET POLICY above).
// 2026-09-21: 4 -> 2. Removed SurveyAnimation (2.4MB) and QuestionAnimation
// (237KB) along with the two door-knocking empty states that rendered them,
// which now use the standard Card empty state. The five already-dead
// animations went in a separate PR.
const BASELINE = 2

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const IGNORED_DIRS = new Set(['node_modules', '.next', 'dist', 'e2e-tests'])

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.git')) continue
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      yield* walk(fullPath)
    } else if (entry.name.endsWith('.json')) {
      yield fullPath
    }
  }
}

// A Lottie file is identified by its own required fields rather than by
// living in a particular directory, so moving one somewhere else does not
// take it out of scope. `v` is the bodymovin version, `layers` the timeline,
// `fr`/`op` the frame rate and out point.
async function isLottie(file) {
  // Cheap guard first: no Lottie export is this small, and parsing every JSON
  // in the package would be slow for no reason.
  const { size } = await stat(file)
  if (size < 512) return false
  try {
    const data = JSON.parse(await readFile(file, 'utf8'))
    return (
      data !== null &&
      typeof data === 'object' &&
      typeof data.v === 'string' &&
      Array.isArray(data.layers) &&
      typeof data.fr === 'number' &&
      typeof data.op === 'number'
    )
  } catch {
    return false
  }
}

const found = []
for await (const file of walk(PACKAGE_ROOT)) {
  if (await isLottie(file)) {
    const { size } = await stat(file)
    found.push({ path: relative(PACKAGE_ROOT, file), size })
  }
}

const count = found.length
const totalKb = Math.round(found.reduce((sum, f) => sum + f.size, 0) / 1024)
console.log(
  `Lottie animations: ${count} (baseline ${BASELINE}), ${totalKb}KB total`,
)
for (const f of found.sort((a, b) => b.size - a.size)) {
  console.log(
    `  ${Math.round(f.size / 1024)
      .toString()
      .padStart(6)}KB  ${f.path}`,
  )
}

if (count > BASELINE) {
  console.error(`\nERROR: ${count} animations exceeds baseline ${BASELINE}.`)
  console.error(
    'An animation is a design decision, not a default. Try a motion token ' +
      '(Foundations/Motion in Storybook), a styleguide component, or a static ' +
      'icon from the approved set first.',
  )
  console.error(
    'If a designer has asked for this one, raise BASELINE in ' +
      'scripts/check-animation-assets.mjs in this PR and note who asked and ' +
      'what it does that a static icon cannot.',
  )
  process.exit(1)
}

if (count < BASELINE) {
  console.log(
    `\nNice — ${BASELINE - count} below baseline. Lower BASELINE to ${count} ` +
      'in scripts/check-animation-assets.mjs to lock in the win.',
  )
}
