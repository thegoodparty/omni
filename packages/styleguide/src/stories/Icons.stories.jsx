import { icons } from 'lucide-react'
import { createElement, useState } from 'react'
import { AiIcon } from '../components/ui/ai-icon'
import { PAGE_STYLE, PageHeader, STORY_PARAMS } from './_storyShell'

const meta = {
  title: 'Foundations/Icons',
  parameters: {
    docs: {
      description: {
        component:
          'Icon library powered by Lucide React. Search by name, adjust size, and click any icon to copy its import name. See lucide.dev for the full catalog.',
      },
    },
  },
}

export default meta

// lucide-react's `icons` export is a plain object of { PascalCaseName: IconComponent }
// This is more reliable than namespace imports in Vite's ESM bundler
const ALL_ICONS = Object.entries(icons).sort(([a], [b]) => a.localeCompare(b))

const SIZES = [16, 20, 24, 32]

// =============================================================================
// Icon Gallery
// =============================================================================
export const IconGallery = () => {
  const [search, setSearch] = useState('')
  const [size, setSize] = useState(24)
  const [copied, setCopied] = useState(null)

  const filtered = search.trim()
    ? ALL_ICONS.filter(([name]) =>
        name.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : ALL_ICONS

  function handleCopy(name) {
    navigator.clipboard.writeText(name).then(() => {
      setCopied(name)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  return (
    <div style={PAGE_STYLE} className="space-y-8">
      <PageHeader
        title="Icons"
        description={`Lucide React icon library. ${ALL_ICONS.length} icons available. Click any icon to copy its name.`}
      />

      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-64 max-w-sm">
          <input
            type="text"
            placeholder="Search icons…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-border bg-background rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary-focus"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-sm leading-none"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 border border-border rounded-md p-0.5">
          {SIZES.map((s) => (
            <button
              key={s}
              onClick={() => setSize(s)}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                size === s
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <p className="text-sm text-muted-foreground">
          {filtered.length === ALL_ICONS.length
            ? `${ALL_ICONS.length} icons`
            : `${filtered.length} of ${ALL_ICONS.length}`}
        </p>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-muted-foreground text-sm">
            No icons match &ldquo;{search}&rdquo;
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
            gap: 32,
          }}
        >
          {filtered.map(([name, Icon]) => {
            const isCopied = copied === name
            return (
              <div
                key={name}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <button
                  onClick={() => handleCopy(name)}
                  title={`Click to copy: ${name}`}
                  className={`flex items-center justify-center rounded-2xl border transition-all w-full group ${
                    isCopied
                      ? 'border-primary/40 bg-primary/10'
                      : 'border-border bg-muted hover:border-input hover:bg-card'
                  }`}
                  style={{ aspectRatio: '1', cursor: 'pointer' }}
                >
                  {isCopied ? (
                    <span
                      className="text-primary font-medium"
                      style={{ fontSize: 11 }}
                    >
                      Copied!
                    </span>
                  ) : (
                    createElement(Icon, {
                      size,
                      strokeWidth: 1.5,
                      style: { color: 'var(--color-foreground)' },
                    })
                  )}
                </button>
                <span
                  className="text-muted-foreground text-center w-full font-mono"
                  style={{
                    fontSize: 11,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: 'block',
                  }}
                >
                  {name}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

IconGallery.storyName = 'Icon Gallery'
IconGallery.parameters = STORY_PARAMS

// =============================================================================
// Custom Icons — hand-authored GoodParty glyphs not in the Lucide set.
// Add new entries here as they are ported from Figma.
// =============================================================================
const CUSTOM_ICONS = [{ name: 'AiIcon', Icon: AiIcon }]

// The 16/20/24/32 scale maps exactly onto Tailwind size utilities, so custom
// icons preview at the same sizes as the Lucide gallery.
const SIZE_CLASS = { 16: 'size-4', 20: 'size-5', 24: 'size-6', 32: 'size-8' }

export const CustomIcons = () => {
  const [size, setSize] = useState(24)

  return (
    <div style={PAGE_STYLE} className="space-y-8">
      <PageHeader
        title="Custom Icons"
        description="GoodParty glyphs outside the Lucide catalog. Filled icons that inherit color via currentColor. Import from @styleguide."
      />

      <div className="flex items-center gap-1 border border-border rounded-md p-0.5 w-fit">
        {SIZES.map((s) => (
          <button
            key={s}
            onClick={() => setSize(s)}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${
              size === s
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
          gap: 32,
        }}
      >
        {CUSTOM_ICONS.map(({ name, Icon }) => (
          <div
            key={name}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <div
              className="flex items-center justify-center rounded-2xl border border-border bg-muted w-full text-foreground"
              style={{ aspectRatio: '1' }}
            >
              <Icon className={SIZE_CLASS[size]} aria-hidden />
            </div>
            <span
              className="text-muted-foreground text-center w-full font-mono"
              style={{ fontSize: 11 }}
            >
              {name}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

CustomIcons.storyName = 'Custom Icons'
CustomIcons.parameters = STORY_PARAMS
