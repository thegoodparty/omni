import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The panel residents join is the "civic panel" everywhere: in prompts, tool
// descriptions, this product map, card titles and errors. gp-webapp's
// check:serve-vocabulary enforces it in the webapp; this is the same rule for
// gp-api and contracts, which that check cannot see. A plain text scan, so it
// catches a comment too: the next agent reads comments as context and copies
// the name it finds there. Rule: docs/product-vocabulary.md.

const JOIN_FILE = 'packages/contracts/src/outreach/CivicPanelJoin.ts'

const OLD_NAMES =
  /\bcitizens?(?:['’]|\\')?s?\s+panels?\b|\bcivics\s+panels?\b|\bconstituents?\s+panels?\b/i

// Sends already made carry the join line under the panel's old name, and the
// reply reader needs those exact words to recognize them.
const LEGACY_JOIN_LINE = /^\s*`Reply \$\{CIVIC_PANEL_JOIN_KEYWORD\} to join my /

const findRepoRoot = (): string => {
  let dir = process.cwd()
  while (!existsSync(resolve(dir, JOIN_FILE))) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`could not locate ${JOIN_FILE}`)
    dir = parent
  }
  return dir
}

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      return ['node_modules', 'generated', 'dist'].includes(entry.name)
        ? []
        : sourceFiles(full)
    }
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)
      ? [full]
      : []
  })

const oldNameLines = (root: string): string[] =>
  ['packages/gp-api/src', 'packages/contracts/src'].flatMap((dir) =>
    sourceFiles(resolve(root, dir)).flatMap((file) => {
      const path = relative(root, file)
      return readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          OLD_NAMES.test(line) &&
          !(path === JOIN_FILE && LEGACY_JOIN_LINE.test(line))
            ? [`${path}:${index + 1}: ${line.trim()}`]
            : [],
        )
    }),
  )

describe('the civic panel name', () => {
  it('never calls the civic panel by an old name in gp-api or contracts', () => {
    expect(oldNameLines(findRepoRoot())).toEqual([])
  })

  it('recognizes every old name, and passes the civic panel', () => {
    for (const old of [
      "citizens' panel",
      'citizens’ panel',
      "citizen's panel",
      'Citizens Panel',
      "THE CITIZENS\\' PANEL",
      'civics panel',
      'constituent panel',
    ]) {
      expect(OLD_NAMES.test(old), old).toBe(true)
    }
    expect(OLD_NAMES.test('Your civic panel')).toBe(false)
    expect(OLD_NAMES.test("'serve-citizen-panels'")).toBe(false)
  })
})
