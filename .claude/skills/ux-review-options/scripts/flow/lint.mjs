// The design-system rules for a flow file, read off its syntax tree.
//
// Usage: node lint.mjs <flow/option-x.tsx>
// Prints JSON: { problems: [{ line, message }], screens, states, markers: [{ kind, text, line }] }.
// check.py runs it on every flow file and owns the exit code.
//
// The rules mirror gp-webapp's check:design-system (packages/gp-webapp/scripts/
// check-design-system-count.mjs) plus what a design must not invent:
// - imports only from react, gp-flow and the styleguide, never lucide-react;
// - no raw <button>, <input>, <select>, <textarea>, <svg>, <img>, or <a> outside
//   Button asChild;
// - a styleguide component restyled through className (color, border, radius,
//   shadow, type, a sized control's height and padding) carries
//   data-mutation="product <path>:<line>" or "no-component <closest>; proposes <what>";
// - a plain element with a visual class sits under data-source="<path>:<line>"
//   (copied from the product as shipped) or carries data-gap="<what>; proposes <what>";
// - no hex colors in classes, no style={}, no shrinking (scale under 0.75, zoom),
//   no odd px spacing; the one exception is rendered content a look-and-feel
//   ticket is about: inside data-content="<what>", an element with
//   data-content-source="<path>:<line>" may use style={} and literal values that
//   line contains;
// - a muted paragraph (<p> with text-muted-foreground) and an Alert are earned:
//   data-earned="<why>" on it, or copied from the product under data-source;
// - every literal data-go names a screen, and there is an entry screen.
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../../..')
const ts = createRequire(path.join(repo, 'package.json'))('typescript')
const file = process.argv[2]
if (!file) {
  console.error('usage: node lint.mjs <flow/option-x.tsx>')
  process.exit(2)
}
const text = readFileSync(file, 'utf8')
const sf = ts.createSourceFile(
  file,
  text,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)
const problems = []
const markers = []
const lineOf = (node) =>
  sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
const fail = (node, message) => problems.push({ line: lineOf(node), message })

// Copied from check-design-system-count.mjs, so a flow restyles exactly what the product would.
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
const SIZED = new Set([
  'Button',
  'IconButton',
  'Badge',
  'Input',
  'Textarea',
  'SelectTrigger',
])
const SIZE_RE = /^(?:h-|min-h-|size-|px-|py-|p-|pl-|pr-|pt-|pb-)/
const PALETTE_RE =
  /^(?:bg|text|border|ring|fill|stroke|outline|divide|from|to|via|placeholder|decoration)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/
const HEX_RE = /\[#[0-9a-fA-F]{3,8}\]|\[(?:rgb|rgba|hsl|hsla)\(/
const RAW = new Set([
  'button',
  'input',
  'select',
  'textarea',
  'svg',
  'img',
  'a',
])
const ALLOWED_IMPORTS =
  /^(?:react|gp-flow|@styleguide(?:\/.*)?|@goodparty_org\/styleguide)$/

const tokens = (value) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.split(':').pop().replace(/^!|!$/g, ''))
const restyles = (name, list) =>
  list.filter(
    (t) =>
      RESTYLE_RES.some((re) => re.test(t)) ||
      (SIZED.has(name) && SIZE_RE.test(t)),
  )

const sourceLine = (ref) => {
  const m = /^(\S+?):(\d+)$/.exec(ref.trim())
  if (!m) return null
  const p = path.join(repo, m[1])
  if (!existsSync(p)) return null
  return readFileSync(p, 'utf8').split('\n')[Number(m[2]) - 1] ?? null
}

for (const st of sf.statements) {
  if (ts.isImportDeclaration(st)) {
    const from = st.moduleSpecifier.text
    if (from === 'lucide-react')
      fail(
        st,
        'icons come from @styleguide/components/ui/icons, never lucide-react',
      )
    else if (!ALLOWED_IMPORTS.test(from))
      fail(
        st,
        `import from "${from}": a flow imports only react, gp-flow and the styleguide; copy product markup instead`,
      )
  }
}

const styleguideNames = new Set()
for (const st of sf.statements) {
  if (
    ts.isImportDeclaration(st) &&
    /^@styleguide|^@goodparty_org\/styleguide/.test(st.moduleSpecifier.text)
  ) {
    st.importClause?.namedBindings?.elements?.forEach((e) =>
      styleguideNames.add(e.name.text),
    )
  }
}

// Every string a className can produce, from literals, templates and cn()/ternaries.
const strings = (expr) => {
  const out = []
  const visit = (n) => {
    if (ts.isStringLiteralLike(n)) out.push(n.text)
    else if (ts.isTemplateExpression(n)) {
      out.push(n.head.text)
      n.templateSpans.forEach((s) => out.push(s.literal.text))
    }
    ts.forEachChild(n, visit)
  }
  visit(expr)
  return out.join(' ')
}

const attrs = (el) => {
  const map = {}
  for (const a of el.attributes.properties) {
    if (!ts.isJsxAttribute(a)) continue
    const name = a.name.getText(sf)
    const init = a.initializer
    let value = true
    if (init && ts.isStringLiteral(init)) value = init.text
    else if (init && ts.isJsxExpression(init) && init.expression) {
      value = ts.isStringLiteralLike(init.expression)
        ? init.expression.text
        : { expr: init.expression }
    }
    map[name] = { value, node: a }
  }
  return map
}
const str = (a) => (a && typeof a.value === 'string' ? a.value : null)

const goTargets = []
// Walk JSX with the chain of ancestors' attributes, so data-source and data-content cover a subtree.
const walk = (node, ctx) => {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const open = ts.isJsxElement(node) ? node.openingElement : node
    const name = open.tagName.getText(sf)
    const a = attrs(open)
    const source = str(a['data-source'])
    const contentSource = str(a['data-content-source'])
    const next = {
      source: ctx.source || source,
      content: ctx.content || 'data-content' in a,
      contentSource: contentSource ?? ctx.contentSource,
      parentAsChild: 'asChild' in a,
    }
    for (const [key, kind] of [
      ['data-source', 'source'],
      ['data-content-source', 'content'],
    ]) {
      const ref = str(a[key])
      if (ref !== null && sourceLine(ref) === null)
        fail(open, `${key}="${ref}" is not <repo path>:<line> of a real line`)
      if (key === 'data-source' && ref !== null)
        markers.push({ kind, text: ref, line: lineOf(open) })
    }
    const mutation = str(a['data-mutation'])
    const gap = str(a['data-gap'])
    if (mutation !== null) {
      const m = /^(product|no-component)\s+(.+)$/.exec(mutation)
      if (!m)
        fail(
          open,
          `data-mutation="${mutation}": start with "product <path>:<line>" or "no-component <closest>; proposes <what>"`,
        )
      else {
        markers.push({ kind: m[1], text: m[2].trim(), line: lineOf(open) })
        if (m[1] === 'product' && sourceLine(m[2]) === null)
          fail(
            open,
            `data-mutation="${mutation}" does not point at a real line`,
          )
        if (m[1] === 'no-component' && !/;\s*proposes\s+\S/.test(m[2]))
          fail(
            open,
            `data-mutation="${mutation}": say "; proposes <variant, component or C-xx>"`,
          )
      }
    }
    if (gap !== null) {
      if (!/;\s*proposes\s+\S/.test(gap))
        fail(
          open,
          `data-gap="${gap}": say "<what>; proposes <component or C-xx>"`,
        )
      markers.push({ kind: 'gap', text: gap, line: lineOf(open) })
    }
    const go = a['data-go']
    if (go && typeof go.value === 'string')
      goTargets.push({ step: go.value, node: open })

    const plain = /^[a-z]/.test(name)
    const earned = 'data-earned' in a || next.source
    if (name === 'Alert' && !earned)
      fail(
        open,
        'unearned banner <Alert>: add data-earned="<why>" or copy it from the product under data-source',
      )
    if (name === 'p' && a.className) {
      const c = a.className.value
      if (
        /\btext-muted-foreground\b/.test(
          typeof c === 'string' ? c : strings(c.expr),
        ) &&
        !earned
      )
        fail(
          open,
          'unearned muted paragraph: add data-earned="<why>" or copy it from the product under data-source',
        )
    }
    if (plain && RAW.has(name)) {
      const allowed =
        (name === 'a' && ctx.parentAsChild) || (name === 'img' && next.content)
      if (!allowed)
        fail(
          open,
          `raw <${name}>: use the styleguide component (Button, Input, Select, Textarea, an icon from icons.tsx, GoodPartyOrgLogo; a link is Button asChild)`,
        )
    }
    if ('style' in a) {
      if (!next.contentSource)
        fail(
          open,
          'style={}: draw with the components and token classes; only rendered content with data-content-source may use style',
        )
      else {
        const line = (sourceLine(next.contentSource) ?? '').toLowerCase()
        const expr = a.style.value?.expr
        const lits = []
        const visit = (n) => {
          if (
            ts.isPropertyAssignment(n) &&
            (ts.isStringLiteralLike(n.initializer) ||
              ts.isNumericLiteral(n.initializer))
          )
            lits.push(n.initializer.text)
          ts.forEachChild(n, visit)
        }
        if (expr) visit(expr)
        for (const v of lits)
          if (!line.includes(v.toLowerCase()))
            fail(open, `style value "${v}" is not on ${next.contentSource}`)
      }
      const zoom = /zoom\s*:\s*['"]?0?\.\d|scale\(\s*0?\.[0-6]/.exec(
        a.style.node.getText(sf),
      )
      if (zoom)
        fail(
          open,
          'shrunk with zoom or scale(): keep preview text 12px or larger',
        )
    }
    if (a.className) {
      const cls = a.className.value
      const list = tokens(typeof cls === 'string' ? cls : strings(cls.expr))
      const raw = typeof cls === 'string' ? cls : strings(cls.expr)
      if (HEX_RE.test(raw) && !next.contentSource)
        fail(
          open,
          `hardcoded color in className on <${name}>: use a token class`,
        )
      for (const t of list) {
        const n =
          /^-?(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-\[(\d+(?:\.\d+)?)px\]$/.exec(
            t,
          )
        if (n && Number(n[1]) % 2)
          fail(
            open,
            `off-scale spacing ${t}: Tailwind spacing moves in 2px steps`,
          )
        const s = /^scale-(?:\[(0?\.\d+)\]|(\d+))$/.exec(t)
        if (s && (s[1] ? Number(s[1]) : Number(s[2]) / 100) < 0.75)
          fail(open, `${t} shrinks the preview: keep text 12px or larger`)
      }
      if (!plain && styleguideNames.has(name.split('.')[0])) {
        const r = restyles(name, list)
        if (r.length && mutation === null && !next.contentSource)
          fail(
            open,
            `<${name}> restyled through className (${r.join(' ')}): use a variant or prop, or mark data-mutation="product <path>:<line>" / "no-component <closest>; proposes <what>"`,
          )
      } else if (plain) {
        const visual = list.filter((t) => RESTYLE_RES.some((re) => re.test(t)))
        if (
          visual.length &&
          !next.source &&
          gap === null &&
          mutation === null &&
          !next.content
        )
          fail(
            open,
            `<${name}> draws its own look (${visual.join(' ')}): copy it from the product under data-source="<path>:<line>", or mark data-gap="<what>; proposes <component or C-xx>"`,
          )
        const palette = list.filter((t) => PALETTE_RE.test(t))
        if (palette.length && !next.source && !next.content)
          fail(
            open,
            `raw palette color (${palette.join(' ')}): use a theme token class`,
          )
      }
    }
    if (ts.isJsxElement(node)) node.children.forEach((c) => walk(c, next))
    open.attributes.properties.forEach((p) => walk(p, ctx))
    return
  }
  ts.forEachChild(node, (c) => walk(c, ctx))
}
walk(sf, {
  source: null,
  content: false,
  contentSource: null,
  parentAsChild: false,
})

// The exported screens and states objects: their keys.
const keysOf = (exportName) => {
  for (const st of sf.statements) {
    if (
      !ts.isVariableStatement(st) ||
      !st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    )
      continue
    for (const d of st.declarationList.declarations) {
      if (d.name.getText(sf) !== exportName) continue
      let init = d.initializer
      while (
        init &&
        (ts.isAsExpression(init) ||
          ts.isSatisfiesExpression?.(init) ||
          ts.isParenthesizedExpression(init))
      )
        init = init.expression
      if (init && ts.isObjectLiteralExpression(init)) {
        return init.properties
          .filter((p) => p.name)
          .map((p) =>
            ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name)
              ? p.name.text
              : p.name.getText(sf),
          )
      }
      return []
    }
  }
  return null
}
const screens = keysOf('screens')
const states = keysOf('states')
if (screens === null)
  problems.push({
    line: 1,
    message: 'no exported screens object (assets/flow-template.tsx)',
  })
else {
  if (!screens.includes('entry'))
    problems.push({
      line: 1,
      message: 'no entry screen: screens.entry is where the user starts',
    })
  for (const g of goTargets)
    if (!screens.includes(g.step))
      fail(
        g.node,
        `data-go="${g.step}" names no screen (screens has ${screens.join(', ')})`,
      )
}
if (states === null || !states.length)
  problems.push({
    line: 1,
    message:
      'no exported states: Other states needs at least one (wireframe-build.md, "Other states")',
  })

console.log(
  JSON.stringify({
    problems,
    screens: screens ?? [],
    states: states ?? [],
    markers,
  }),
)
