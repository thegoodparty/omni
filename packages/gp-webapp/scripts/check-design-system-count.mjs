#!/usr/bin/env node
// Design-system ratchet.
//
// Counts three things in non-test source under app/ that the Styleguide
// section of AGENTS.md forbids, and fails (exit 1) if any count rises above
// its committed baseline:
//
//   - raw <button>, <input>, <select> and <textarea> elements, instead of the
//     @styleguide Button, Input, Select and Textarea
//   - hardcoded hex colors in arbitrary Tailwind classes (`bg-[#2563eb]`),
//     instead of a design token utility
//   - files importing straight from lucide-react, instead of the approved set
//     in @styleguide/components/ui/icons
//
// An instruction in a doc is skipped once a model stops reading it; a failing
// check is not. The existing uses are grandfathered; new ones fail.
//
// RATCHET POLICY:
//   - When you remove uses, lower the matching baseline to the count this
//     script prints. That locks in the win.
//   - Do not raise a baseline to turn a red build green. If a raw element is
//     the only way (a hidden or file input the styleguide doesn't cover),
//     raise it in the same PR with a note saying why.
//
// Run: `npm run check:design-system -w packages/gp-webapp`

import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

// 2026-10-28: initial baselines, measured on main.
const BASELINES = {
  rawElements: 135,
  hexClasses: 25,
  lucideImporters: 62,
}

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const IGNORED_DIRS = new Set(['node_modules', '.next', 'dist'])
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']

const RAW_ELEMENT_RE = /<(?:button|input|select|textarea)[\s/>]/g
const HEX_CLASS_RE = /-\[#[0-9a-fA-F]{3,8}\]/g
const LUCIDE_IMPORT_RE = /from\s+['"]lucide-react['"]/

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      yield* walk(fullPath)
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      yield fullPath
    }
  }
}

const counts = { rawElements: 0, hexClasses: 0, lucideImporters: 0 }
for await (const file of walk(join(PACKAGE_ROOT, 'app'))) {
  const relPath = relative(PACKAGE_ROOT, file)
  if (relPath.includes('.test.') || relPath.includes('.stories.')) continue
  const contents = await readFile(file, 'utf8')
  counts.rawElements += (contents.match(RAW_ELEMENT_RE) ?? []).length
  counts.hexClasses += (contents.match(HEX_CLASS_RE) ?? []).length
  if (LUCIDE_IMPORT_RE.test(contents)) counts.lucideImporters++
}

const FIXES = {
  rawElements:
    'Use Button, Input, Select or Textarea from @styleguide instead of the raw element.',
  hexClasses:
    'Use a design token utility (see packages/styleguide/src/tailwind-theme.css) instead of a hex value.',
  lucideImporters:
    'Import icons from @styleguide/components/ui/icons. If the icon is missing, add it there first.',
}

let failed = false
for (const [key, count] of Object.entries(counts)) {
  const baseline = BASELINES[key]
  console.log(`${key}: ${count} (baseline ${baseline})`)
  if (count > baseline) {
    failed = true
    console.error(
      `  ERROR: ${count} exceeds baseline ${baseline}. ${FIXES[key]}`,
    )
  } else if (count < baseline) {
    console.log(
      `  ${baseline - count} below baseline. Lower BASELINES.${key} to ${count} in scripts/check-design-system-count.mjs to lock it in.`,
    )
  }
}
if (failed) process.exit(1)
