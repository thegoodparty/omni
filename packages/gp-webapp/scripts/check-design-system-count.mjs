#!/usr/bin/env node
// Design-system ratchet.
//
// Counts four things in non-test source under app/ that the Styleguide
// section of AGENTS.md forbids, and fails (exit 1) if any count rises above
// its committed baseline:
//
//   - raw <button>, <input>, <select> and <textarea> elements, instead of the
//     @styleguide Button, Input, Select and Textarea
//   - hardcoded hex colors in arbitrary Tailwind classes (`bg-[#2563eb]`),
//     instead of a design token utility
//   - files importing straight from lucide-react, instead of the approved set
//     in @styleguide/components/ui/icons
//   - styleguide components restyled through className (color, border,
//     radius, shadow, type, or a sized control's height and padding), instead
//     of a variant or prop (docs/product-design.md section 7)
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
//   - restyledComponents: raise it only to copy an earlier screen's restyled
//     solution for the same job (section 7, step 1), with a note naming the
//     screen you copied, or for an exception the team granted in
//     #tmp-design-agent, with a note giving its end date. Raise it by the
//     number you add, and propose the component fix as section 7 says.
//   - List every restyled component with `--list-restyled`.
//
// Run: `npm run check:design-system -w packages/gp-webapp`

import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

// 2026-10-28: initial baselines, measured on main.
const BASELINES = {
  rawElements: 134,
  hexClasses: 25,
  lucideImporters: 62,
  // 2026-11-11: initial baseline, measured on main.
  restyledComponents: 478,
}

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const IGNORED_DIRS = new Set(['node_modules', '.next', 'dist'])
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']

const RAW_ELEMENT_RE = /<(?:button|input|select|textarea)[\s/>]/g
const HEX_CLASS_RE = /-\[#[0-9a-fA-F]{3,8}\]/g
const LUCIDE_IMPORT_RE = /from\s+['"]lucide-react['"]/
const STYLEGUIDE_IMPORT_RE =
  /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]@styleguide(?:\/[^'"]*)?['"]/g

// A restyled component is a styleguide component whose className changes how
// it looks. Layout (width, margin, flex, gap) is the caller's job and is not
// counted, and neither are icon and Skeleton sizes or a Card's padding, which
// is how those components are meant to be used.
const COLOR_WORDS =
  'primary|secondary|tertiary|destructive|success|info|warning|error|muted|accent|foreground|background|card|popover|border|input|ring|white|black|transparent|current|brand|base|neutral|grayscale|slate|gray|zinc|blue|red|green|yellow|orange|purple|indigo|components|tw|link|disabled|inherit'
const RESTYLE_RES = [
  new RegExp(
    `^(?:bg|text|border|ring|fill|stroke|outline|divide|from|to|via|placeholder|decoration)-(?:\\[|(?:${COLOR_WORDS})(?:-|/|$))`,
  ),
  /^(?:rounded|shadow)(?:-|$)/,
  /^border(?:-[0-9xytblrse]+)?$/,
  /^border-(?:solid|dashed|dotted|none)$/,
  /^(?:text-(?:xs|sm|base|lg|[0-9]?xl|\[)|font-|leading-|tracking-|uppercase$|lowercase$|italic$)/,
]
// Controls whose height and padding come from their size prop.
const SIZED_COMPONENTS = new Set([
  'Button',
  'IconButton',
  'Badge',
  'Input',
  'Textarea',
  'SelectTrigger',
])
const SIZE_RE = /^(?:h-|min-h-|size-|px-|py-|p-|pl-|pr-|pt-|pb-)/

const styleguideNames = (contents) => {
  const names = new Set()
  for (const match of contents.matchAll(STYLEGUIDE_IMPORT_RE)) {
    for (const part of match[1].split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
      if (name && /^[A-Z]/.test(name)) names.add(name)
    }
  }
  return names
}

// Walks JSX opening tags by hand: a regex stops at the first `>`, which is
// often the `=>` of an inline handler.
function* openingTags(contents) {
  const start = /<([A-Z][\w.]*)\b/g
  let match
  while ((match = start.exec(contents))) {
    let depth = 0
    let quote = null
    let i = start.lastIndex
    for (; i < contents.length; i++) {
      const ch = contents[i]
      if (quote) {
        if (ch === quote && contents[i - 1] !== '\\') quote = null
      } else if (ch === '"' || ch === "'" || ch === '`') quote = ch
      else if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (ch === '>' && depth === 0) break
    }
    yield {
      name: match[1],
      attrs: contents.slice(start.lastIndex, i),
      index: match.index,
    }
    start.lastIndex = i
  }
}

const classNameTokens = (attrs) => {
  const at = attrs.search(/\bclassName=/)
  if (at === -1) return []
  const rest = attrs.slice(at + 'className='.length)
  let value = rest
  if (rest[0] === '{') {
    let depth = 0
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '{') depth++
      else if (rest[i] === '}' && --depth === 0) {
        value = rest.slice(0, i + 1)
        break
      }
    }
  } else {
    value = rest.slice(0, rest.indexOf(rest[0], 1) + 1)
  }
  const literals = value.match(/(["'`])(?:(?!\1)[\s\S])*\1/g) ?? []
  return literals
    .join(' ')
    .replace(/["'`]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.split(':').pop().replace(/^!|!$/g, ''))
}

const restyles = (name, tokens) =>
  tokens.filter(
    (token) =>
      RESTYLE_RES.some((re) => re.test(token)) ||
      (SIZED_COMPONENTS.has(name) && SIZE_RE.test(token)),
  )

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

const listRestyles = process.argv.includes('--list-restyled')
const counts = {
  rawElements: 0,
  hexClasses: 0,
  lucideImporters: 0,
  restyledComponents: 0,
}
for await (const file of walk(join(PACKAGE_ROOT, 'app'))) {
  const relPath = relative(PACKAGE_ROOT, file)
  if (relPath.includes('.test.')) continue
  const contents = await readFile(file, 'utf8')
  counts.rawElements += (contents.match(RAW_ELEMENT_RE) ?? []).length
  counts.hexClasses += (contents.match(HEX_CLASS_RE) ?? []).length
  if (LUCIDE_IMPORT_RE.test(contents)) counts.lucideImporters++
  const names = styleguideNames(contents)
  if (names.size === 0) continue
  for (const tag of openingTags(contents)) {
    if (!names.has(tag.name.split('.')[0])) continue
    if (/Icon$/.test(tag.name) || tag.name === 'Skeleton') continue
    const found = restyles(tag.name, classNameTokens(tag.attrs))
    if (found.length === 0) continue
    counts.restyledComponents++
    if (listRestyles) {
      const line = contents.slice(0, tag.index).split('\n').length
      console.log(`${relPath}:${line} <${tag.name}> ${found.join(' ')}`)
    }
  }
}

const FIXES = {
  rawElements:
    'Use Button, Input, Select or Textarea from @styleguide instead of the raw element.',
  hexClasses:
    'Use a design token utility (see packages/styleguide/src/tailwind-theme.css) instead of a hex value.',
  lucideImporters:
    'Import icons from @styleguide/components/ui/icons. If the icon is missing, add it there first.',
  restyledComponents:
    'Use a variant or prop instead of restyling a styleguide component through className, or follow docs/product-design.md section 7. Run with --list-restyled to see them.',
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
