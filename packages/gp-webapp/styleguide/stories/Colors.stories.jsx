import { useState, useEffect, useRef } from 'react'
import { useGlobals } from 'storybook/preview-api'
import { PAGE_STYLE, PageHeader, STORY_PARAMS } from './_storyShell'

// design-tokens.css is the source of truth. The chain label under each swatch
// (e.g. "↳ --theme-primary → --tw-blue-600") is extracted directly from the
// live stylesheet — getComputedStyle resolves to the final hex, but raw
// `cssRules[*].style.getPropertyValue(...)` returns the un-resolved `var(--…)`
// reference, which is what we want.
//
// Light-mode tokens live in :root (design-tokens.css). Dark-mode overrides
// live under `.dark [data-slot]…` (styleguide-scope.css). When isDark is
// true, prefer the dark-mode value and fall back to light if the token has
// no dark override.
function readVarChain(varName, isDark) {
  let darkChain = null
  let lightChain = null

  // inLight/inDark track whether we're inside a :root or .dark ancestor rule.
  // PostCSS wraps color-mix() focus tokens in @supports blocks, which causes
  // properties after those blocks to land in CSSNestedDeclarations rather than
  // the parent rule's .style. We propagate context so those nested declarations
  // are read regardless of their rule type.
  function scan(rules, inLight, inDark) {
    for (const rule of rules) {
      let ruleLight = inLight
      let ruleDark = inDark
      if (rule instanceof CSSStyleRule) {
        const selector = rule.selectorText || ''
        if (/(^|,\s*):root\b/.test(selector)) ruleLight = true
        if (/\.dark\b/.test(selector)) ruleDark = true
      }
      if ((ruleLight || ruleDark) && rule.style) {
        const raw = rule.style.getPropertyValue(varName).trim()
        if (raw) {
          const match = raw.match(/^var\(\s*(--[a-zA-Z0-9-]+)/)
          if (match) {
            if (ruleDark) darkChain = match[1]
            else lightChain = match[1]
          }
        }
      }
      if (rule.cssRules) scan(rule.cssRules, ruleLight, ruleDark)
    }
  }

  for (const sheet of document.styleSheets) {
    let rules
    try {
      rules = sheet.cssRules || []
    } catch {
      // Cross-origin stylesheet — skip (won't have our tokens anyway).
      continue
    }
    scan(rules, false, false)
  }

  return isDark ? (darkChain ?? lightChain) : lightChain
}

function buildBaseRefMap(prefix, names, isDark) {
  const map = {}
  for (const name of names) {
    const chain = readVarChain(`--${prefix}-${name}`, isDark)
    if (chain) map[name] = chain
  }
  return map
}

const meta = {
  title: 'Foundations/Colors',
  parameters: {
    docs: {
      description: {
        component:
          'Color tokens from the GoodParty Figma Design System. All values are defined in design-tokens.css and mapped to Tailwind utilities via tailwind-theme.css.',
      },
    },
  },
}

export default meta

function hexToRgba(hex) {
  const clean = hex.replace('#', '')
  if (clean.length !== 6 && clean.length !== 8) return hex
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  const a =
    clean.length === 8
      ? (parseInt(clean.slice(6, 8), 16) / 255).toFixed(2)
      : '1.00'
  return `rgba(${r},${g},${b},${a})`
}

function formatHex(hex) {
  const clean = hex.replace('#', '')
  if (clean.length !== 8) return hex.toUpperCase()
  const alpha = Math.round((parseInt(clean.slice(6, 8), 16) / 255) * 100)
  return `#${clean.slice(0, 6).toUpperCase()} / ${alpha}%`
}

function resolveColor(cssValue) {
  if (!cssValue) return ''
  const trimmed = cssValue.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('#')) return trimmed
  const el = document.createElement('div')
  el.style.color = trimmed
  el.style.display = 'none'
  document.body.appendChild(el)
  const resolved = getComputedStyle(el).color
  document.body.removeChild(el)
  const toHex = (n) => Math.round(parseFloat(n)).toString(16).padStart(2, '0')

  const rgba = resolved.match(
    /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/,
  )
  if (rgba) {
    const hex = `#${toHex(rgba[1])}${toHex(rgba[2])}${toHex(rgba[3])}`
    if (rgba[4] !== undefined && parseFloat(rgba[4]) < 1) {
      return hex + toHex(String(parseFloat(rgba[4]) * 255))
    }
    return hex
  }

  const srgb = resolved.match(
    /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/,
  )
  if (srgb) {
    const hex = `#${toHex(String(parseFloat(srgb[1]) * 255))}${toHex(
      String(parseFloat(srgb[2]) * 255),
    )}${toHex(String(parseFloat(srgb[3]) * 255))}`
    if (srgb[4] !== undefined && parseFloat(srgb[4]) < 1) {
      return hex + toHex(String(parseFloat(srgb[4]) * 255))
    }
    return hex
  }

  return trimmed
}

function readCSSVar(el, name) {
  return resolveColor(getComputedStyle(el).getPropertyValue(name).trim())
}

function readCSSScale(el, prefix, steps) {
  return steps.map((step) => ({
    step,
    hex: readCSSVar(el, `--${prefix}-${step}`),
  }))
}

function readCSSTokenGroup(el, prefix, names) {
  const result = {}
  for (const name of names) {
    const varName = `--${prefix}-${name}`
    result[name] = { hex: readCSSVar(el, varName), ref: varName }
  }
  return result
}

// Reads the Tailwind palette from --tw-{scale}-{step} vars, which are always
// present on :root via design-tokens.css regardless of which utility classes
// the codebase references.
function readTailwindScale(scaleName, steps) {
  const el = document.documentElement
  return steps.flatMap((step) => {
    const hex = readCSSVar(el, `--tw-${scaleName}-${step}`)
    return hex ? [{ step, hex }] : []
  })
}

const SCALE_STEPS = [
  '50',
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '700',
  '800',
  '900',
  '950',
]

function Swatch({
  name,
  hex,
  alias,
  tailwindClass,
  isDark,
  cardBg,
  borderColor,
  foregroundColor,
  mutedForegroundColor,
  cardHeight,
}) {
  const _cardBg = cardBg ?? (isDark ? '#171717' : '#ffffff')
  const _borderColor = borderColor ?? (isDark ? '#404040' : '#e5e5e5')
  const _foregroundColor = foregroundColor ?? (isDark ? '#ffffff' : '#0a0a0a')
  const _mutedForegroundColor =
    mutedForegroundColor ?? (isDark ? '#a3a3a3' : '#737373')

  return (
    <div
      style={{
        width: 200,
        height: cardHeight ?? 220,
        border: `1px solid ${_borderColor}`,
        borderRadius: 4,
        overflow: 'hidden',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          backgroundColor: hex,
          height: 100,
          width: '100%',
          flexShrink: 0,
          borderBottom: `1px solid ${_borderColor}`,
        }}
      />
      <div
        style={{
          padding: 8,
          backgroundColor: _cardBg,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flexGrow: 1,
        }}
      >
        <p
          style={{
            fontSize: 14,
            fontWeight: 400,
            color: _foregroundColor,
            margin: 0,
            lineHeight: '20px',
          }}
        >
          {tailwindClass ?? name}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <p
            style={{
              fontSize: 9,
              fontFamily: 'monospace',
              color: _mutedForegroundColor,
              margin: 0,
            }}
          >
            {formatHex(hex)}
          </p>
          <p
            style={{
              fontSize: 9,
              fontFamily: 'monospace',
              color: _mutedForegroundColor,
              margin: 0,
            }}
          >
            {hexToRgba(hex)}
          </p>
          {alias && (
            <p
              style={{
                fontSize: 9,
                fontFamily: 'monospace',
                color: _mutedForegroundColor,
                margin: '4px 0 0',
                opacity: 0.6,
                borderTop: `1px solid ${_borderColor}`,
                paddingTop: 4,
              }}
            >
              ↳ {alias}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, description, children }) {
  return (
    <div className="space-y-4">
      <div>
        <h3
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: 'var(--color-foreground)',
            margin: 0,
          }}
        >
          {title}
        </h3>
        {description && (
          <p
            style={{
              fontSize: 14,
              color: 'var(--color-muted-foreground)',
              margin: '4px 0 0',
            }}
          >
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  )
}

function SwatchRow({ children }) {
  return <div className="flex flex-wrap gap-2">{children}</div>
}

function ScaleRow({ scaleName, prefix, colors }) {
  return (
    <Section title={scaleName}>
      <SwatchRow>
        {colors.map(({ step, hex }) => (
          <Swatch
            key={step}
            name={`${step}`}
            hex={hex}
            tailwindClass={`${prefix}-${step}`}
          />
        ))}
      </SwatchRow>
    </Section>
  )
}

// =============================================================================
// Token name arrays (CSS variable suffixes for each group)
// =============================================================================

const BASE_TOKEN_NAMES = [
  'foreground',
  'background',
  'muted-foreground',
  'muted',
  'inactive',
  'border',
  'accent',
  'accent-foreground',
  'surface',
  'surface-foreground',
  'focus-ring',
  'ring-offset',
  'foreground-dark',
  'background-dark',
]

const THEME_TOKEN_NAMES = [
  'primary',
  'primary-light',
  'primary-dark',
  'primary-foreground',
  'primary-focus',
  'secondary',
  'secondary-light',
  'secondary-dark',
  'secondary-foreground',
  'secondary-focus',
  'tertiary',
  'tertiary-light',
  'tertiary-dark',
  'tertiary-foreground',
  'tertiary-focus',
  'destructive',
  'destructive-light',
  'destructive-dark',
  'destructive-foreground',
  'destructive-focus',
  'success',
  'success-light',
  'success-dark',
  'success-foreground',
  'success-focus',
  'info',
  'info-light',
  'info-dark',
  'info-foreground',
  'info-focus',
  'warning',
  'warning-light',
  'warning-dark',
  'warning-foreground',
  'warning-focus',
]

const COMPONENT_TOKEN_NAMES = [
  'card-base',
  'card-foreground',
  'card-border',
  'input-base',
  'input-foreground',
  'input-border',
  'input-active',
  'input-focus',
  'input-inactive',
  'input-inactive-focus',
  'tooltip-base',
  'tooltip-foreground',
  'link',
]

const DATA_TOKEN_NAMES = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
  'chart-7',
]

const SIDEBAR_TOKEN_NAMES = [
  'background',
  'foreground',
  'primary',
  'primary-foreground',
  'accent',
  'accent-foreground',
  'border',
  'ring',
]

// =============================================================================
// Theme Colors
// =============================================================================

const SIDEBAR_EXCLUDED = new Set(['primary', 'primary-foreground', 'ring'])

const THEME_GROUPS = [
  [
    'primary',
    'primary-light',
    'primary-dark',
    'primary-foreground',
    'primary-focus',
  ],
  [
    'secondary',
    'secondary-light',
    'secondary-dark',
    'secondary-foreground',
    'secondary-focus',
  ],
  [
    'tertiary',
    'tertiary-light',
    'tertiary-dark',
    'tertiary-foreground',
    'tertiary-focus',
  ],
  [
    'destructive',
    'destructive-light',
    'destructive-dark',
    'destructive-foreground',
    'destructive-focus',
  ],
  [
    'success',
    'success-light',
    'success-dark',
    'success-foreground',
    'success-focus',
  ],
  ['info', 'info-light', 'info-dark', 'info-foreground', 'info-focus'],
  [
    'warning',
    'warning-light',
    'warning-dark',
    'warning-foreground',
    'warning-focus',
  ],
]

// Sub-section labels rendered above the group whose first key matches.
const THEME_GROUP_SUB_LABELS = {
  primary: 'Branding',
  destructive: 'Semantic',
}

const BASE_GROUPS = [
  ['background', 'foreground', 'surface', 'surface-foreground', 'border'],
  ['muted', 'muted-foreground', 'inactive', 'accent', 'accent-foreground'],
  ['focus-ring', 'ring-offset'],
]

const COMPONENT_GROUPS = [
  ['card-base', 'card-foreground', 'card-border'],
  ['input-base', 'input-foreground', 'input-border'],
  ['input-active', 'input-focus', 'input-inactive', 'input-inactive-focus'],
  ['tooltip-base', 'tooltip-foreground', 'link'],
]

const TOKEN_GROUP_META = {
  theme: {
    title: 'Theme',
    description:
      'Branding tokens (primary, secondary, tertiary) and semantic action colors (destructive, success, info, warning) with light/dark variants.',
  },
  base: {
    title: 'Base',
    description:
      'Foundational surface tokens — backgrounds, foregrounds, borders, focus rings.',
  },
  component: {
    title: 'Components',
    description: 'Component-specific tokens — link, cards, inputs, tooltips.',
  },
  sidebar: {
    title: 'Sidebar',
    description: 'Tokens scoped to the sidebar navigation.',
  },
  data: {
    title: 'Data / Chart',
    description: 'Colors for data visualization and charts.',
  },
}

export const ThemeColors = () => {
  const containerRef = useRef(null)
  const [tokens, setTokens] = useState(null)
  const [globals] = useGlobals()
  const isDark = globals.colorScheme === 'dark'

  const baseRefs = {
    base: buildBaseRefMap('base', BASE_TOKEN_NAMES, isDark),
    theme: buildBaseRefMap('theme', THEME_TOKEN_NAMES, isDark),
    component: buildBaseRefMap('component', COMPONENT_TOKEN_NAMES, isDark),
    data: buildBaseRefMap('data', DATA_TOKEN_NAMES, isDark),
    sidebar: buildBaseRefMap('component-sidebar', SIDEBAR_TOKEN_NAMES, isDark),
  }

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    setTokens({
      base: readCSSTokenGroup(el, 'base', BASE_TOKEN_NAMES),
      theme: readCSSTokenGroup(el, 'theme', THEME_TOKEN_NAMES),
      component: readCSSTokenGroup(el, 'component', COMPONENT_TOKEN_NAMES),
      data: readCSSTokenGroup(el, 'data', DATA_TOKEN_NAMES),
      sidebar: readCSSTokenGroup(el, 'component-sidebar', SIDEBAR_TOKEN_NAMES),
    })
  }, [isDark])

  const pageBg =
    tokens?.base?.['background']?.hex ?? (isDark ? '#0a0a0a' : '#ffffff')
  const cardBg =
    tokens?.component?.['card-base']?.hex ?? (isDark ? '#171717' : '#ffffff')
  const borderColor =
    tokens?.base?.['border']?.hex ?? (isDark ? '#525252' : '#e5e5e5')
  const foregroundColor =
    tokens?.base?.['foreground']?.hex ?? (isDark ? '#ffffff' : '#0a0a0a')
  const mutedForegroundColor =
    tokens?.base?.['muted-foreground']?.hex ?? (isDark ? '#a3a3a3' : '#737373')

  return (
    <div
      ref={containerRef}
      data-slot="theme-colors"
      className={isDark ? 'dark' : undefined}
      style={{ backgroundColor: pageBg, padding: 24, minHeight: '100vh' }}
    >
      <div className="space-y-10">
        <div>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: foregroundColor,
              margin: 0,
            }}
          >
            Theme Colors — {isDark ? 'Dark' : 'Light'} Mode
          </h2>
          <p
            style={{
              fontSize: 14,
              color: mutedForegroundColor,
              marginTop: 4,
            }}
          >
            Core theme tokens read from CSS custom properties. Use the toolbar
            color scheme switcher to toggle between light and dark.
          </p>
        </div>

        {tokens &&
          Object.entries(TOKEN_GROUP_META).map(
            ([groupKey, { title, description }]) => (
              <Section key={groupKey} title={title} description={description}>
                {groupKey === 'theme' ||
                groupKey === 'base' ||
                groupKey === 'component' ? (
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                  >
                    {(groupKey === 'theme'
                      ? THEME_GROUPS
                      : groupKey === 'base'
                        ? BASE_GROUPS
                        : COMPONENT_GROUPS
                    ).map((keys) => (
                      <div key={keys[0]}>
                        {groupKey === 'theme' &&
                          THEME_GROUP_SUB_LABELS[keys[0]] && (
                            <p
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                letterSpacing: '0.08em',
                                color: mutedForegroundColor,
                                margin: '12px 0 6px',
                              }}
                            >
                              {THEME_GROUP_SUB_LABELS[keys[0]]}
                            </p>
                          )}
                        <SwatchRow>
                          {keys.map((name) => {
                            const token = tokens[groupKey]?.[name]
                            if (!token) return null
                            const baseRef = baseRefs[groupKey]?.[name]
                            const alias = baseRef ?? null
                            return (
                              <Swatch
                                key={name}
                                name={name}
                                hex={token.hex}
                                alias={alias}
                                isDark={isDark}
                                cardBg={cardBg}
                                borderColor={borderColor}
                                foregroundColor={foregroundColor}
                                mutedForegroundColor={mutedForegroundColor}
                                cardHeight={260}
                              />
                            )
                          })}
                        </SwatchRow>
                      </div>
                    ))}
                  </div>
                ) : (
                  <SwatchRow>
                    {Object.entries(tokens[groupKey] || {})
                      .filter(
                        ([name]) =>
                          groupKey !== 'sidebar' || !SIDEBAR_EXCLUDED.has(name),
                      )
                      .map(([name, { hex, ref: tokenRef }]) => {
                        const baseRef = baseRefs[groupKey]?.[name]
                        const alias = baseRef ?? null
                        return (
                          <Swatch
                            key={name}
                            name={name}
                            hex={hex}
                            alias={alias}
                            isDark={isDark}
                            cardBg={cardBg}
                            borderColor={borderColor}
                            foregroundColor={foregroundColor}
                            mutedForegroundColor={mutedForegroundColor}
                            cardHeight={260}
                          />
                        )
                      })}
                  </SwatchRow>
                )}
              </Section>
            ),
          )}
      </div>
    </div>
  )
}

ThemeColors.parameters = {
  layout: 'fullscreen',
  backgrounds: { disable: true },
}

// =============================================================================
// Branding Colors
// =============================================================================
export const BrandingColors = () => {
  const [data, setData] = useState(null)

  useEffect(() => {
    const el = document.documentElement
    const readScale = (prefix) => readCSSScale(el, prefix, SCALE_STEPS)
    const read = (name) => readCSSVar(el, name)

    setData({
      coreBrand: [
        {
          name: 'Cream',
          hex: read('--goodparty-cream'),
          tailwindClass: 'bg-brand-cream',
        },
      ],
      brandRed: readScale('goodparty-red'),
      brandBlue: readScale('goodparty-blue'),
      midnight: readScale('color-midnight'),
      lavender: readScale('color-lavender'),
      waxflower: readScale('color-waxflower'),
      haloGreen: readScale('color-halo-green'),
      brightYellow: readScale('color-bright-yellow'),
    })
  }, [])

  if (!data) return null

  return (
    <div style={PAGE_STYLE} className="space-y-10">
      <PageHeader
        title="Branding Colors"
        description="Colors that represent GoodParty.org's visual identity. Read from CSS custom properties defined in design-tokens.css."
      />

      <Section title="Neutrals">
        <SwatchRow>
          {data.coreBrand.map(({ name, hex, tailwindClass }) => (
            <Swatch
              key={name}
              name={name}
              hex={hex}
              tailwindClass={tailwindClass}
            />
          ))}
        </SwatchRow>
      </Section>

      <ScaleRow
        scaleName="Brand Red"
        prefix="bg-brand-red"
        colors={data.brandRed}
      />
      <ScaleRow
        scaleName="Waxflower"
        prefix="bg-brand-waxflower"
        colors={data.waxflower}
      />
      <ScaleRow
        scaleName="Bright Yellow"
        prefix="bg-brand-bright-yellow"
        colors={data.brightYellow}
      />
      <ScaleRow
        scaleName="Halo Green"
        prefix="bg-brand-halo-green"
        colors={data.haloGreen}
      />
      <ScaleRow
        scaleName="Brand Blue"
        prefix="bg-brand-blue"
        colors={data.brandBlue}
      />
      <ScaleRow
        scaleName="Lavender"
        prefix="bg-brand-lavender"
        colors={data.lavender}
      />
      <ScaleRow
        scaleName="Midnight"
        prefix="bg-brand-midnight"
        colors={data.midnight}
      />
    </div>
  )
}
BrandingColors.parameters = STORY_PARAMS

// =============================================================================
// Tailwind Colors
// =============================================================================

const TW_SCALE_NAMES = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
]

const TW_BASE_STEPS = ['black', 'white']

export const TailwindColors = () => {
  const [data, setData] = useState(null)

  useEffect(() => {
    const el = document.documentElement
    setData({
      base: TW_BASE_STEPS.flatMap((step) => {
        const hex = readCSSVar(el, `--tw-${step}`)
        return hex ? [{ step, hex }] : []
      }),
      scales: TW_SCALE_NAMES.map((scaleName) => ({
        scaleName,
        colors: readTailwindScale(scaleName, SCALE_STEPS),
      })).filter(({ colors }) => colors.length > 0),
    })
  }, [])

  if (!data) return null

  return (
    <div style={PAGE_STYLE} className="space-y-10">
      <PageHeader
        title="Tailwind Colors"
        description="The complete standard Tailwind color palette — all 22 scales, 50–950. Read from --tw-{scale}-{step} CSS variables defined in design-tokens.css."
      />

      {data.base.length > 0 && (
        <Section title="Base">
          <SwatchRow>
            {data.base.map(({ step, hex }) => (
              <Swatch
                key={step}
                name={step}
                hex={hex}
                tailwindClass={`bg-${step}`}
              />
            ))}
          </SwatchRow>
        </Section>
      )}

      {data.scales.map(({ scaleName, colors }) => (
        <ScaleRow
          key={scaleName}
          scaleName={scaleName.charAt(0).toUpperCase() + scaleName.slice(1)}
          prefix={`bg-${scaleName}`}
          colors={colors}
        />
      ))}
    </div>
  )
}
TailwindColors.parameters = STORY_PARAMS
