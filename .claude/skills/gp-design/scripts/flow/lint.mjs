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
// - no hex colors in classes, no raw palette colors, no literal type sizes or
//   radii, no sm:/md:/max-*: breakpoints in new markup, no style={}, no shrinking
//   (scale under 0.75, zoom), no odd px spacing; icons from icons.tsx may take
//   color and size classes. The one exception is rendered content a
//   look-and-feel ticket is about: inside data-content="<what>", a plain element
//   with data-content-source="<path>:<line>" may use style={} and bracketed
//   values that line contains;
// - a muted paragraph (<p> with text-muted-foreground) and an Alert are earned:
//   data-earned="<why>" on it, or copied from the product under data-source;
// - no ScrollArea inside a DrawerBody or DrawerContent, which already scroll;
// - every literal data-go names a screen, and there is an entry screen.
// On a three-option page, flow/shared.tsx holds the screens and parts every option
// draws the same; an option imports them from './shared'. shared.tsx gets every rule
// above except the screens, states, entry and data-go checks, which belong to the
// options that use it.
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
// Spacing and size inside rendered content, which the content's source decides.
const CONTENT_SIZE_RE =
  /^-?(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y|w|h|size|max-w|min-w|max-h|min-h)-/
const PALETTE_RE =
  /^(?:bg|text|border|ring|fill|stroke|outline|divide|from|to|via|placeholder|decoration)-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d|white$|black$)/
// New code switches layout at lg: only (docs/product-design.md section 10).
const BREAKPOINT_RE = /(?:^|:)(?:sm|md|xl|2xl|max-[a-z0-9]+|min-\[[^\]]*\]):/
// A literal type size or radius is off the type scale or the radius tokens.
const LITERAL_RE =
  /^(?:text-\[(?:\d|length:)|leading-\[|rounded(?:-[a-z]+)?-\[)/
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
  /^(?:react|gp-flow|@styleguide(?:\/.*)?|@goodparty_org\/styleguide|\.\/shared)$/

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

const REF_RE = /^(\S+?):(\d+)$/
// The cited line and the three after it, where a value a content cite names must be.
const sourceWindow = (ref) => {
  const m = REF_RE.exec(ref.trim())
  if (!m) return null
  const p = path.join(repo, m[1])
  if (!existsSync(p)) return null
  const lines = readFileSync(p, 'utf8').split('\n')
  const i = Number(m[2]) - 1
  if (lines[i] === undefined) return null
  return lines.slice(i, i + 4)
}
const sourceLine = (ref) => sourceWindow(ref)?.[0] ?? null
// The cited line and the lines around it, lowercased: what a copied subtree may hold.
const sourceNear = (ref, up, down) => {
  const m = REF_RE.exec(ref.trim())
  const p = m && path.join(repo, m[1])
  if (!p || !existsSync(p)) return ''
  const lines = readFileSync(p, 'utf8').split('\n')
  const i = Number(m[2]) - 1
  return lines
    .slice(Math.max(0, i - up), i + down)
    .join('\n')
    .toLowerCase()
}
const windowText = (refs) =>
  refs
    .map((r) => (sourceWindow(r) ?? []).join('\n'))
    .join('\n')
    .toLowerCase()
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const hasToken = (hay, t) =>
  new RegExp(`(?:^|[\\s"'\`{:])${escapeRe(t)}(?:$|[\\s"'\`}])`).test(hay)
// A cite says "copied from here", so the lines around it must hold what was copied: the
// element's component tag on the cited line, one of its classes, or its text (up to the
// first expression); a plain tag only when it has neither. An import line holds none.
// The window runs 3 lines up and 8 down, because one JSX element spans several lines.
const citeHolds = (ref, el) => {
  const m = REF_RE.exec(ref.trim())
  const p = m && path.join(repo, m[1])
  if (!p || !existsSync(p)) return true
  const lines = readFileSync(p, 'utf8').split('\n')
  const i = Number(m[2]) - 1
  if (/^\s*import\b/.test(lines[i] ?? '')) return false
  const hay = lines.slice(Math.max(0, i - 3), i + 9).join('\n')
  if (/^[A-Z]/.test(el.name) && (lines[i] ?? '').includes(`<${el.name}`))
    return true
  if (el.classes.some((t) => hasToken(hay, t))) return true
  if (el.text.some((t) => hay.includes(t))) return true
  return !el.classes.length && !el.text.length && hay.includes(`<${el.name}`)
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
        `import from "${from}": a flow imports only react, gp-flow, the styleguide and ./shared; copy product markup instead`,
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

// The parts of an element a cite can be checked against: its classes and its own text.
const elementFacts = (node, open, name, a) => {
  const cls = a.className?.value
  const classes = cls
    ? (typeof cls === 'string' ? cls : strings(cls.expr))
        .split(/\s+/)
        .filter(Boolean)
    : []
  const text = ts.isJsxElement(node)
    ? node.children
        .filter(ts.isJsxText)
        .map((c) => c.text.replace(/\s+/g, ' ').trim())
        .map((t) =>
          t
            .split(/[{$\d]/)[0]
            .trim()
            .slice(0, 30),
        )
        .filter((t) => t.length >= 4)
    : []
  return { name, classes, text }
}

// Top-level consts and functions the file defines, by name, so a value cited as an
// identifier (data-content-source={SRC[theme]}) resolves to its strings.
const topLevel = new Map()
for (const st of sf.statements) {
  if (ts.isVariableStatement(st))
    for (const d of st.declarationList.declarations)
      if (ts.isIdentifier(d.name) && d.initializer)
        topLevel.set(d.name.text, { node: st, init: d.initializer })
  if (ts.isFunctionDeclaration(st) && st.name)
    topLevel.set(st.name.text, { node: st, init: st })
}
// The strings an expression can be: literals, templates and concatenations of them,
// ternaries, and top-level consts read through, down to the one property a
// SRC.blue or SRC['blue'] names (every property for SRC[color]).
const unwrap = (n) =>
  n &&
  (ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isSatisfiesExpression?.(n))
    ? unwrap(n.expression)
    : n
const objectOf = (n, seen) => {
  n = unwrap(n)
  if (!n) return null
  if (ts.isObjectLiteralExpression(n)) return n
  if (ts.isIdentifier(n) && topLevel.has(n.text) && !seen.has(n.text))
    return objectOf(topLevel.get(n.text).init, new Set(seen).add(n.text))
  if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
    const vals = memberValues(n, seen, true)
    return vals.length === 1 && ts.isObjectLiteralExpression(vals[0])
      ? vals[0]
      : null
  }
  return null
}
const propName = (p) =>
  p.name &&
  (ts.isIdentifier(p.name) ||
    ts.isStringLiteral(p.name) ||
    ts.isNumericLiteral(p.name))
    ? p.name.text
    : null
// The initializers obj.key, obj['key'] or obj[anything] can read.
const memberValues = (n, seen) => {
  const obj = objectOf(n.expression, seen)
  if (!obj) return []
  const props = obj.properties.filter(ts.isPropertyAssignment)
  const key = ts.isPropertyAccessExpression(n)
    ? n.name.text
    : ts.isStringLiteralLike(n.argumentExpression)
      ? n.argumentExpression.text
      : null
  const picked = key === null ? props : props.filter((p) => propName(p) === key)
  return picked.map((p) => unwrap(p.initializer))
}
const valuesOf = (n, seen = new Set()) => {
  n = unwrap(n)
  if (!n) return []
  if (ts.isStringLiteralLike(n)) return [n.text]
  if (ts.isNumericLiteral(n)) return [n.text]
  if (ts.isTemplateExpression(n)) {
    let acc = [n.head.text]
    for (const span of n.templateSpans) {
      const opts = valuesOf(span.expression, seen)
      if (!opts.length) return []
      acc = acc.flatMap((a) => opts.map((v) => a + v + span.literal.text))
    }
    return acc
  }
  if (ts.isConditionalExpression(n))
    return [...valuesOf(n.whenTrue, seen), ...valuesOf(n.whenFalse, seen)]
  if (
    ts.isBinaryExpression(n) &&
    n.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const l = valuesOf(n.left, seen)
    const r = valuesOf(n.right, seen)
    return l.flatMap((a) => r.map((b) => a + b))
  }
  if (ts.isIdentifier(n) && topLevel.has(n.text) && !seen.has(n.text)) {
    const init = topLevel.get(n.text).init
    return ts.isFunctionLike(init)
      ? []
      : valuesOf(init, new Set(seen).add(n.text))
  }
  if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n))
    return memberValues(n, seen).flatMap((v) => valuesOf(v, seen))
  if (ts.isArrayLiteralExpression(n))
    return n.elements.flatMap((e) => valuesOf(e, seen))
  if (ts.isObjectLiteralExpression(n))
    return n.properties
      .filter(ts.isPropertyAssignment)
      .flatMap((p) => valuesOf(p.initializer, seen))
  return []
}
const refsOf = (attr) => {
  if (!attr) return null
  if (typeof attr.value === 'string') return [attr.value]
  if (attr.value?.expr) {
    const refs = valuesOf(attr.value.expr).filter((t) => REF_RE.test(t.trim()))
    return refs.length ? refs : ['<unresolved>']
  }
  return null
}

// A helper component (const Header = () => <div .../>) is checked where it is used: an
// email part used inside data-content counts as content, with its user's cites.
const components = new Map()
for (const [name, { node, init }] of topLevel)
  if (/^[A-Z]/.test(name) && ts.isFunctionLike(init))
    components.set(name, { node, uses: [] })

const goTargets = []
// Walk JSX with the chain of ancestors' attributes, so data-source and data-content cover a subtree.
const walk = (node, ctx) => {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const open = ts.isJsxElement(node) ? node.openingElement : node
    const name = open.tagName.getText(sf)
    const a = attrs(open)
    const sourceRefs = refsOf(a['data-source']) ?? []
    const source = sourceRefs.find((r) => r !== '<unresolved>') ?? null
    const contentSources = refsOf(a['data-content-source'])
    const mutationRef =
      /^product\s+(\S+:\d+)/.exec(str(a['data-mutation']) ?? '')?.[1] ?? null
    // data-editor marks editor chrome sitting inside rendered content (a row of
    // controls over the email): its subtree is checked as product UI, not content.
    const editor = 'data-editor' in a
    const classText = a.className
      ? typeof a.className.value === 'string'
        ? a.className.value
        : a.className.value.expr.getText(sf)
      : ''
    const next = {
      // The nearest cite wins: an element copied from another file inside a copied
      // shell is checked against its own source, not the shell's.
      // A data-mutation="product <path>:<line>" cites where the product draws it, so it
      // stands in as the subtree's source.
      source: source ?? mutationRef ?? ctx.source,
      // Set only below an element that carries a cite: new markup there is checked
      // against the cited file, so a wrapper's cite does not excuse what it holds.
      inherited: source === null && mutationRef === null && Boolean(ctx.source),
      content: editor ? false : ctx.content || 'data-content' in a,
      contentSources: editor ? null : (contentSources ?? ctx.contentSources),
      gap: ctx.gap || 'data-gap' in a,
      parentAsChild: 'asChild' in a,
      host: ctx.host || /\bseamlessFieldHost\b/.test(classText),
      scrolls: ctx.scrolls || name === 'DrawerBody' || name === 'DrawerContent',
    }
    if (name === 'ScrollArea' && ctx.scrolls)
      fail(
        open,
        'ScrollArea inside a Drawer: DrawerBody already scrolls (COMPONENTS.md)',
      )
    if (
      (name === 'Textarea' || name === 'TokenField') &&
      str(a.variant) === 'seamless' &&
      !next.host
    )
      fail(
        open,
        `<${name} variant="seamless"> needs seamlessFieldHost on the card around it, or focus never shows (textarea.tsx)`,
      )
    const facts = elementFacts(node, open, name, a)
    for (const ref of sourceRefs) {
      if (ref === '<unresolved>') {
        fail(
          open,
          'data-source: write it as "<path>:<line>", or as an expression whose values are such strings in this file',
        )
        continue
      }
      if (sourceLine(ref) === null)
        fail(
          open,
          `data-source="${ref}" is not <repo path>:<line> of a real line`,
        )
      else if (!citeHolds(ref, facts))
        fail(
          open,
          `data-source="${ref}": the lines around the cite (3 up, 8 down) hold none of this element's tag, classes or text; cite the line it was copied from`,
        )
      markers.push({ kind: 'source', text: ref, line: lineOf(open) })
    }
    // Below a cite, an element with no cite of its own is the product's only when the
    // cited file holds its classes (copied markup keeps them; its text is often sample
    // data standing in for a variable), or its text when it has no classes.
    const fileText = next.source ? sourceNear(next.source, 1e6, 1e6) : ''
    const copiedText =
      !next.inherited ||
      (facts.classes.length
        ? facts.classes.every((c) => hasToken(fileText, c.toLowerCase()))
        : facts.text.every((t) => fileText.includes(t.toLowerCase())))
    for (const ref of contentSources ?? []) {
      if (ref === '<unresolved>')
        fail(
          open,
          'data-content-source: write it as "<path>:<line>", or as an expression whose values are such strings in this file',
        )
      else if (sourceLine(ref) === null)
        fail(
          open,
          `data-content-source="${ref}" is not <repo path>:<line> of a real line`,
        )
      else if (/^\s*import\b/.test(sourceLine(ref)))
        fail(
          open,
          `data-content-source="${ref}" is an import line; cite where the value is`,
        )
    }
    if (components.has(name)) components.get(name).uses.push(next)
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
        else if (m[1] === 'product' && !citeHolds(m[2].trim(), facts))
          fail(
            open,
            `data-mutation="${mutation}": the lines around the cite (3 up, 8 down) hold none of this element's tag, classes or text; cite the line where the product restyles it`,
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
    const earned = 'data-earned' in a || (next.source && copiedText)
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
      const styleComponent = !plain && styleguideNames.has(name.split('.')[0])
      if (styleComponent && mutation === null)
        fail(
          open,
          `<${name}> restyled through style={}: use a variant or prop, or mark data-mutation (a component inside content is still a component)`,
        )
      // Copied markup keeps the product's own inline style: its values are near the cite.
      const copiedStyle = next.source && !next.content
      if (!copiedStyle && !(next.content && next.contentSources))
        fail(
          open,
          'style={}: draw with the components and token classes; only rendered content (data-content with data-content-source) or markup copied under data-source may use style',
        )
      else {
        const line = copiedStyle
          ? sourceNear(next.source, 3, 40)
          : windowText(next.contentSources)
        const where = copiedStyle
          ? `${next.source} or the 40 lines after it`
          : next.contentSources.join(' or ')
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
            fail(open, `style value "${v}" is not on ${where}`)
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
      const copied = next.source || (plain && next.contentSources)
      if (!copied) {
        const bp = raw.split(/\s+/).filter((t) => BREAKPOINT_RE.test(t))
        if (bp.length)
          fail(
            open,
            `${bp.join(' ')}: new code switches layout at lg: only (docs/product-design.md section 10)`,
          )
        const lit = list.filter((t) => LITERAL_RE.test(t))
        if (lit.length)
          fail(
            open,
            `${lit.join(' ')}: a literal type size or radius; use the type scale (section 8) and radius tokens`,
          )
      }
      // Inside rendered content, every look a class gives is on the lines data-content-source
      // cites: a bracketed value by its value (an inline-styled template), any other look
      // and spacing class by name (a template drawn with the same classes).
      if (plain && next.contentSources) {
        const line = windowText(next.contentSources)
        const where = next.contentSources.join(' or ')
        // Values only: list has the variants (lg:, [&:focus-visible]:) stripped.
        for (const t of list) {
          const vals = [...t.matchAll(/-\[([^\]]+)\]/g)].map((m) => m[1])
          for (const v of vals) {
            const bare = v.toLowerCase().replace(/px$/, '')
            if (!line.includes(v.toLowerCase()) && !line.includes(bare))
              fail(open, `[${v}] is not on ${where}`)
          }
          if (
            !vals.length &&
            (RESTYLE_RES.some((re) => re.test(t)) || CONTENT_SIZE_RE.test(t)) &&
            !hasToken(line, t.toLowerCase())
          )
            fail(
              open,
              `${t} is not on ${where}: inside data-content, write the value the source has as a bracket (px-[40px]) or use the class it has`,
            )
        }
      }
      // A bracketed value (a hex, a width) in copied markup is the product's own only
      // when the source holds it.
      // On the element that carries data-source, the cited lines; below it, the cited file.
      // A data-gap covers its subtree: the missing component's own layout values.
      if (next.source && !next.gap && mutation === null) {
        const near =
          source !== null
            ? sourceNear(source, 3, 9)
            : sourceNear(next.source, 1e6, 1e6)
        for (const t of list.filter((t) => /\[[^\]]+\]/.test(t)))
          if (!hasToken(near, t.toLowerCase()))
            fail(
              open,
              `${t} is not near ${next.source}: a bracketed value under data-source is the product's only when the source holds it (the cited lines for the element that carries the cite, the cited file below it); cite the element's own line, or mark it data-gap or data-mutation`,
            )
      }
      if (HEX_RE.test(raw) && !next.source && !(plain && next.contentSources))
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
      // Icons from icons.tsx take their color and size from className, as the product does.
      const icon = /Icon$/.test(name) && styleguideNames.has(name)
      if (!plain && !icon && styleguideNames.has(name.split('.')[0])) {
        const r = restyles(name, list)
        if (r.length && mutation === null)
          fail(
            open,
            `<${name}> restyled through className (${r.join(' ')}): use a variant or prop, or mark data-mutation="product <path>:<line>" / "no-component <closest>; proposes <what>"`,
          )
      } else if (plain) {
        const visual = list.filter((t) => RESTYLE_RES.some((re) => re.test(t)))
        const unsourced = next.inherited
          ? visual.filter((t) => !hasToken(fileText, t.toLowerCase()))
          : visual
        if (
          unsourced.length &&
          (!next.source || next.inherited) &&
          !next.gap &&
          !('data-earned' in a) &&
          mutation === null &&
          !next.content
        )
          fail(
            open,
            `<${name}> draws its own look (${unsourced.join(' ')}): copy it from the product under data-source="<path>:<line>" (below a cite, the cited file must hold the class), or mark data-gap="<what>; proposes <component or C-xx>"`,
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
const ROOT = {
  gap: false,
  source: null,
  inherited: false,
  content: false,
  contentSources: null,
  parentAsChild: false,
  scrolls: false,
}
const defNodes = new Set([...components.values()].map((c) => c.node))
for (const st of sf.statements) if (!defNodes.has(st)) walk(st, ROOT)
// A helper used somewhere in JSX is checked only in the contexts it is used in; one
// never used as a tag (a screen passed to screens) is checked on its own. Each helper
// once per distinct context, until walking helpers finds no new use.
const usedAsTag = new Set()
const findTags = (n) => {
  if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n))
    usedAsTag.add(n.tagName.getText(sf))
  ts.forEachChild(n, findTags)
}
findTags(sf)
const done = new Set()
for (let changed = true; changed; ) {
  changed = false
  for (const [name, c] of components) {
    const ctxs = usedAsTag.has(name) ? c.uses : [ROOT]
    for (const ctx of [...ctxs]) {
      const key = `${name}|${JSON.stringify({ ...ctx, parentAsChild: false })}`
      if (done.has(key)) continue
      done.add(key)
      changed = true
      walk(c.node, { ...ctx, parentAsChild: false })
    }
  }
}
const seenProblem = new Set()
problems.splice(
  0,
  problems.length,
  ...problems.filter((p) => {
    const k = `${p.line}|${p.message}`
    if (seenProblem.has(k)) return false
    seenProblem.add(k)
    return true
  }),
)
const seenMarker = new Set()
markers.splice(
  0,
  markers.length,
  ...markers.filter((m) => {
    const k = `${m.kind}|${m.text}|${m.line}`
    if (seenMarker.has(k)) return false
    seenMarker.add(k)
    return true
  }),
)

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
const shared = path.basename(file) === 'shared.tsx'
const screens = keysOf('screens')
const states = keysOf('states')
if (shared) {
  // Checked where the options use it.
} else if (screens === null)
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
if (!shared && (states === null || !states.length))
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
