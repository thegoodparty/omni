#!/usr/bin/env node
// Builds COMPONENTS.md, the index agents read to pick a styleguide component,
// from the `@summary` JSDoc tag on each component in src/components/ui/.
// The summary lives next to the code so it can't drift from it.
//
//   node scripts/components-doc.mjs          write COMPONENTS.md
//   node scripts/components-doc.mjs --check  fail if it is stale, or if a
//                                            component file has no @summary

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const UI_DIR = join(PACKAGE_ROOT, 'src/components/ui')
const OUT = join(PACKAGE_ROOT, 'COMPONENTS.md')
const check = process.argv.includes('--check')

// A block tags the component declared right after it. A block above a bare
// `export {` list (icons.tsx) is named after its file.
const BLOCK_RE =
  /\/\*\*([\s\S]*?)\*\/\s*\n\s*(?:export\s+)?(?:(?:const|function)\s+([A-Z][A-Za-z0-9]*)|\{)/g

const pascal = (file) =>
  file
    .replace(/\.tsx$/, '')
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('')

// pie-chart.tsx only re-exports a sibling; the sibling's summary covers it.
const isReExport = (source) =>
  source
    .split('\n')
    .filter((line) => line.trim())
    .every((line) => /^export\s.*\sfrom\s+'\.\//.test(line))

const files = (await readdir(UI_DIR))
  .filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
  .sort()

const entries = []
const missing = []
for (const file of files) {
  const source = await readFile(join(UI_DIR, file), 'utf8')
  let found = 0
  if (isReExport(source)) continue
  for (const [, body, declared] of source.matchAll(BLOCK_RE)) {
    const name = declared ?? pascal(file)
    const text = body
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, '').trim())
      .join('\n')
    const match = text.match(/@summary\s+([\s\S]*?)(?=\n\s*@\w|$)/)
    if (!match) continue
    found++
    entries.push({ name, file, summary: match[1].replace(/\s+/g, ' ').trim() })
  }
  if (found === 0) missing.push(file)
}

entries.sort((a, b) => a.name.localeCompare(b.name))

const doc = `# Styleguide components

Every component in \`src/components/ui/\` and when to use it. Pick from this list
before you build UI, and import from \`@styleguide\`. For variants and props, read
the component's source. For examples, search \`packages/gp-webapp/app\` for real uses.

Generated from the \`@summary\` JSDoc tag on each component. Do not edit by hand:
change the tag, then run \`npm run docs:components -w packages/styleguide\`.

${entries.map((e) => `- **${e.name}** (\`${e.file}\`): ${e.summary}`).join('\n')}
`

if (!check) {
  await writeFile(OUT, doc)
  console.log(`Wrote COMPONENTS.md: ${entries.length} components`)
  if (missing.length) {
    console.log(`No @summary yet in: ${missing.join(', ')}`)
  }
  process.exit(0)
}

let failed = false
if (missing.length) {
  failed = true
  console.error(
    `These component files have no @summary JSDoc tag on a component:\n  ${missing.join('\n  ')}\n` +
      'Add one directly above the component a consumer would import, saying when to use it.',
  )
}
const current = await readFile(OUT, 'utf8').catch(() => '')
if (current !== doc) {
  failed = true
  console.error(
    'COMPONENTS.md is out of date. Run `npm run docs:components -w packages/styleguide` and commit the result.',
  )
}
if (failed) process.exit(1)
console.log(`COMPONENTS.md is current: ${entries.length} components`)
