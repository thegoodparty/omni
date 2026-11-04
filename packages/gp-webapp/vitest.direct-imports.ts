import { existsSync, readFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, resolve } from 'path'
import { parseAst, transformWithOxc, type Plugin } from 'vite'

type Origin = { module: string; name: string }

const BARRELS = ['@styleguide', '@goodparty_org/contracts', 'date-fns']
const BARREL_PATTERN = BARRELS.map((barrel) => barrel.replace('/', '\\/')).join(
  '|',
)
const MENTIONS_BARREL = new RegExp(`['"](?:${BARREL_PATTERN})['"]`)
const BARREL_IMPORT = new RegExp(
  `import\\s*\\{([^}]*)\\}\\s*from\\s*['"](${BARREL_PATTERN})['"]`,
  'g',
)
const BARREL_MOCK = new RegExp(
  `vi\\.(?:do)?[mM]ock\\(\\s*['"](${BARREL_PATTERN})['"]`,
)

const requireFromHere = createRequire(__filename)

const resolveRelative = (fromDir: string, specifier: string) => {
  const base = resolve(fromDir, specifier)
  const candidates = ['.tsx', '.ts', '/index.ts'].map((ext) => base + ext)
  return candidates.find((file) => existsSync(file)) ?? base
}

const moduleExports = new Map<string, Promise<Map<string, Origin>>>()

// Maps each value a module exports to the module and name that define it,
// following `export *` and `export { x as y } from './z'` down to the source.
const exportsOf = (file: string): Promise<Map<string, Origin>> => {
  const cached = moduleExports.get(file)
  if (cached) return cached
  const collected = (async () => {
    const origins = new Map<string, Origin>()
    const { code } = await transformWithOxc(readFileSync(file, 'utf8'), file)
    for (const node of parseAst(code).body) {
      if (node.type === 'ExportAllDeclaration' && !node.exported) {
        const target = resolveRelative(dirname(file), String(node.source.value))
        for (const [name, origin] of await exportsOf(target)) {
          origins.set(name, origin)
        }
      }
      if (node.type !== 'ExportNamedDeclaration') continue
      const { declaration } = node
      if (declaration?.type === 'VariableDeclaration') {
        for (const { id } of declaration.declarations) {
          if (id.type === 'Identifier') {
            origins.set(id.name, { module: file, name: id.name })
          }
        }
      } else if (
        (declaration?.type === 'FunctionDeclaration' ||
          declaration?.type === 'ClassDeclaration') &&
        declaration.id
      ) {
        const { name } = declaration.id
        origins.set(name, { module: file, name })
      }
      const source = node.source ? String(node.source.value) : undefined
      const target = source?.startsWith('.')
        ? resolveRelative(dirname(file), source)
        : undefined
      const targetExports = target ? await exportsOf(target) : undefined
      for (const { local, exported } of node.specifiers) {
        const localName =
          local.type === 'Identifier' ? local.name : String(local.value)
        const exportedName =
          exported.type === 'Identifier'
            ? exported.name
            : String(exported.value)
        origins.set(
          exportedName,
          targetExports?.get(localName) ??
            (target
              ? { module: target, name: localName }
              : { module: file, name: exportedName }),
        )
      }
    }
    return origins
  })()
  moduleExports.set(file, collected)
  return collected
}

const originOf = async (
  barrel: string,
  name: string,
): Promise<Origin | undefined> => {
  if (barrel === 'date-fns') {
    try {
      requireFromHere.resolve(`date-fns/${name}`)
      return { module: `date-fns/${name}`, name }
    } catch {
      return undefined
    }
  }
  const entry =
    barrel === '@styleguide'
      ? resolve(__dirname, '../styleguide/src/index.ts')
      : resolve(__dirname, '../contracts/src/index.ts')
  return (await exportsOf(entry)).get(name)
}

// Every test file gets a fresh module graph, so a barrel import pays for every
// module behind the barrel, in every file: `import { Button } from
// '@styleguide'` loaded recharts, react-day-picker and tiptap, and
// `import { format } from 'date-fns'` loaded all of date-fns. Next tree-shakes
// that away in the app; this does the same for tests by importing each name
// from the module that defines it.
export const directImports = (): Plugin => ({
  name: 'gp:direct-imports',
  enforce: 'pre',
  async transform(code) {
    if (!MENTIONS_BARREL.test(code)) return
    const mock = BARREL_MOCK.exec(code)
    if (mock) {
      this.error(
        `vi.mock('${mock[1]}') no longer reaches the code under test, which ` +
          'imports each name from the module that defines it. Mock that ' +
          "module instead, e.g. vi.mock('@styleguide/components/ui/calendar').",
      )
    }
    let rewritten = code
    for (const [statement, list = '', barrel = ''] of code.matchAll(
      BARREL_IMPORT,
    )) {
      const byModule = new Map<string, string[]>()
      const rest: string[] = []
      for (const raw of list.split(',')) {
        const specifier = raw.trim()
        if (!specifier) continue
        const [imported = '', alias = imported] = specifier.split(/\s+as\s+/)
        const origin = specifier.startsWith('type ')
          ? undefined
          : await originOf(barrel, imported)
        if (!origin) {
          rest.push(specifier)
          continue
        }
        const binding =
          origin.name === alias ? alias : `${origin.name} as ${alias}`
        byModule.set(origin.module, [
          ...(byModule.get(origin.module) ?? []),
          binding,
        ])
      }
      if (!byModule.size) continue
      const imports = [...byModule].map(
        ([module, bindings]) =>
          `import { ${bindings.join(', ')} } from ${JSON.stringify(module)}`,
      )
      if (rest.length) {
        imports.push(`import { ${rest.join(', ')} } from '${barrel}'`)
      }
      const lineBreaks = '\n'.repeat(statement.split('\n').length - 1)
      rewritten = rewritten.replace(statement, imports.join('; ') + lineBreaks)
    }
    return rewritten === code ? undefined : { code: rewritten, map: null }
  },
})
