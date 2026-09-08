import { useRef } from 'react'
import { PAGE_STYLE, PageHeader, STORY_PARAMS } from './_storyShell'

const meta = {
  title: 'Foundations/Motion',
  parameters: {
    docs: {
      description: {
        component:
          'Reusable animation and micro-interaction tokens. Attach the utility class on the row (or the CSS class for the text effects) and read the "When to use" line to see whether the token fits — a shared token exists so the same feedback reads the same across the product, so reach for one before writing a new keyframes block.',
      },
    },
  },
}

export default meta

// One row per named token. Two categories, each in its own story below:
// utilities a caller composes with (attention shake, gradient border, caret,
// indeterminate progress) and text effects (the two shimmer variants).
// Radix-managed tokens (accordion/collapsible) get their own reference row
// at the bottom — they can't be triggered on demand here, but naming them
// is what keeps someone from re-inventing a height animation.

// =============================================================================
// Utility animations — callers attach the class
// =============================================================================

const ShakeSample = () => {
  const ref = useRef(null)
  const trigger = () => {
    const el = ref.current
    if (!el) return
    // Same restart trick the door-knocking Undo button uses: React seeing the
    // same class on a re-render is a no-op, so the reflow read is what lets
    // the animation fire again on a rapid re-press. Without it a second tap
    // would visually swallow.
    el.classList.remove('animate-shake')
    void el.offsetWidth
    el.classList.add('animate-shake')
  }
  return (
    <button
      ref={ref}
      type="button"
      onClick={trigger}
      onAnimationEnd={(e) => e.currentTarget.classList.remove('animate-shake')}
      className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted"
    >
      Trigger shake
    </button>
  )
}

const CaretSample = () => (
  <span className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-card px-2 text-sm font-mono text-foreground">
    3 4
    <span className="ml-0.5 inline-block h-4 w-px animate-caret-blink bg-foreground" />
  </span>
)

const IndeterminateSample = () => (
  <div className="relative h-2 w-56 overflow-hidden rounded-full bg-muted">
    <div className="absolute inset-y-0 left-0 w-1/3 animate-indeterminate rounded-full bg-primary" />
  </div>
)

const SpinGradientSample = () => (
  <span
    className="inline-block size-16 rounded-full animate-spin-gradient"
    style={{
      background:
        'conic-gradient(from var(--gradient-angle), var(--ai-gradient-from), var(--ai-gradient-to), var(--ai-gradient-from))',
    }}
  />
)

const UTILITIES = [
  {
    token: 'animate-shake',
    sample: <ShakeSample />,
    useWhen:
      'An inline error alert when the user attempts something they cannot — the tap did reach the control and the app deliberately did nothing. Shake the element the action was aimed at (the disabled Undo, the required field, the pill that can\'t be removed), pair it with a toast or inline message that names the reason, and it reads as "no, and here\'s why" rather than a UI that seems broken. Attach the class, remove it in onAnimationEnd, and force reflow between removes and adds so a rapid re-trigger restarts.',
  },
  {
    token: 'animate-caret-blink',
    sample: <CaretSample />,
    useWhen:
      'The synthetic caret in an OTP or code input. Not for general text-input carets — the browser handles those.',
  },
  {
    token: 'animate-indeterminate',
    sample: <IndeterminateSample />,
    useWhen:
      'A progress bar for work with no known length. For a spinning indicator on a button or beside a label, reach for Spinner instead.',
  },
  {
    token: 'animate-spin-gradient',
    sample: <SpinGradientSample />,
    useWhen:
      'The rotating gradient border on the AI chat bar. Reserved for that surface — the motion reads as "the model is thinking" and reusing it elsewhere borrows an association that isn\'t yours to reassign.',
  },
]

const CodeToken = ({ children }) => (
  <code className="rounded bg-muted px-1.5 py-0.5 text-sm text-foreground">
    {children}
  </code>
)

const TokenTable = ({ rows, sampleWidth = 200 }) => (
  <table className="w-full border-collapse">
    <thead>
      <tr className="border-b border-border text-left">
        <th className="w-48 px-4 py-3 text-sm font-bold text-foreground">
          Token
        </th>
        <th
          className="px-4 py-3 text-sm font-bold text-foreground"
          style={{ width: sampleWidth }}
        >
          Sample
        </th>
        <th className="px-4 py-3 text-sm font-bold text-foreground">
          When to use
        </th>
      </tr>
    </thead>
    <tbody>
      {rows.map(({ token, sample, useWhen }) => (
        <tr key={token} className="border-b border-border align-middle">
          <td className="px-4 py-6">
            <CodeToken>{token}</CodeToken>
          </td>
          <td className="px-4 py-6">{sample}</td>
          <td className="px-4 py-6 text-sm text-muted-foreground">{useWhen}</td>
        </tr>
      ))}
    </tbody>
  </table>
)

export function Utilities() {
  return (
    <div style={PAGE_STYLE} className="space-y-10">
      <PageHeader
        title="Utility animations"
        description="Named animation tokens a caller attaches directly via a utility class. Defined in tailwind-theme.css alongside the color and shadow tokens. Add a new one here whenever the interaction is one somebody else will also want to reach for."
      />
      <TokenTable rows={UTILITIES} />
    </div>
  )
}

Utilities.storyName = 'Utility animations'
Utilities.parameters = STORY_PARAMS

// =============================================================================
// Text effects — a swept gradient across text
// =============================================================================

const TEXT_EFFECTS = [
  {
    token: '.text-shimmer',
    sample: (
      <span className="text-shimmer text-base font-medium">Thinking…</span>
    ),
    useWhen:
      'A chat-tool label or model-in-progress state where the surface is branded. The gradient is brand-blue; dark mode swaps to a darker blue so the wave stays visible against light text.',
  },
  {
    token: '.text-shimmer-muted',
    sample: (
      <span className="text-shimmer-muted text-base font-medium">
        Thinking…
      </span>
    ),
    useWhen:
      'A neutral in-progress label with no brand association. Muted foreground on both sides, black band swept across. Use for background/system work rather than for a user-visible tool.',
  },
]

export function TextEffects() {
  return (
    <div style={PAGE_STYLE} className="space-y-10">
      <PageHeader
        title="Text effects"
        description="Gradient-swept text effects. Applied via CSS class (not a Tailwind utility) because the effect needs -webkit-text-fill-color: transparent, which text-transparent doesn't set — without it WebKit paints solid text and the gradient never shows."
      />
      <TokenTable rows={TEXT_EFFECTS} />
    </div>
  )
}

TextEffects.storyName = 'Text effects'
TextEffects.parameters = STORY_PARAMS

// =============================================================================
// Radix-managed — auto-attached by the component
// =============================================================================

const RADIX_MANAGED = [
  {
    token: 'animate-accordion-down / up',
    componentName: 'Accordion',
    keyframes: 'height 0 ↔ --radix-accordion-content-height',
  },
  {
    token: 'animate-collapsible-down / up',
    componentName: 'Collapsible',
    keyframes: 'height 0 ↔ --radix-collapsible-content-height',
  },
]

export function RadixManaged() {
  return (
    <div style={PAGE_STYLE} className="space-y-10">
      <PageHeader
        title="Radix-managed"
        description="Height animations wired into the components that own them (via data-[state=open]:animate-* on the content node). Documented here so the tokens are discoverable — but don't apply them directly. Use the component instead, and the animation comes with it."
      />
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="w-64 px-4 py-3 text-sm font-bold text-foreground">
              Token
            </th>
            <th className="w-48 px-4 py-3 text-sm font-bold text-foreground">
              Attached by
            </th>
            <th className="px-4 py-3 text-sm font-bold text-foreground">
              Keyframes
            </th>
          </tr>
        </thead>
        <tbody>
          {RADIX_MANAGED.map(({ token, componentName, keyframes }) => (
            <tr key={token} className="border-b border-border align-middle">
              <td className="px-4 py-6">
                <CodeToken>{token}</CodeToken>
              </td>
              <td className="px-4 py-6 text-sm text-foreground">
                {componentName}
              </td>
              <td className="px-4 py-6 text-sm text-muted-foreground">
                {keyframes}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

RadixManaged.storyName = 'Radix-managed'
RadixManaged.parameters = STORY_PARAMS
