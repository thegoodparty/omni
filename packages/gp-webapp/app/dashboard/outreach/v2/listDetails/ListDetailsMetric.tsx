import type { ReactNode } from 'react'
import { Badge, Card, Eyebrow } from '@styleguide'

// The Overview grid's cell, shared by both list details drawers. It is the
// union of what the two surfaces needed rather than the intersection: the
// outreach envelope's figures are always settled by the time the detail
// resolves, while a saved list's come from a pack that decodes on its own
// schedule and a route fetch that can fail, so `pending` and the progress bar
// are door knocking's and the outreach drawer simply never asks for them.
// Sharing the cell is what keeps a door count and a people count looking like
// the same kind of fact on both surfaces.
//
// min-w-0 belongs on the card as well as the inner text span: `grid-cols-2`
// lays down minmax(0,1fr) tracks, but a grid item's own min-width stays `auto`,
// so anything the card can't shrink below still pushes past its track.
export const Metric = ({
  icon,
  label,
  value,
  hint,
  pending,
  progress,
}: {
  icon: ReactNode
  label: string
  value: string
  hint?: string
  pending?: boolean
  // Percent 0-100, or undefined for a stat that isn't a proportion. Undefined
  // rather than null so the bar has to be asked for: most stats in this grid
  // report a quantity with no denominator to be a fraction of.
  progress?: number
}) => (
  <Card className="flex min-w-0 flex-row items-start gap-2 rounded-lg p-3">
    {/* Decorative on purpose: the label beside it already names the figure,
        and a screen reader repeating "door" adds nothing. */}
    <span
      aria-hidden="true"
      className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4"
    >
      {icon}
    </span>
    <span className="min-w-0">
      <span className="block text-xs text-muted-foreground">{label}</span>
      {pending ? (
        <span className="block py-0.5">
          <span className="block h-4 w-20 animate-pulse rounded bg-muted" />
          <span className="sr-only">Loading</span>
        </span>
      ) : (
        <span className="block truncate text-sm font-medium text-foreground">
          {value}
        </span>
      )}
      {/* Decorative, exactly like `Breakdown`'s: the value above already reads
          "12 of 40 · 30%", so a screen reader gains nothing from the bar and
          would only hear the same figure twice. Unlike `Breakdown`, this one
          is NOT floored to a visible sliver at zero — there a 0%-wide bar
          meant "fewer than one percent of the audience", here it means no
          door has been logged, and drawing a sliver would credit the walk
          with a door it never knocked. */}
      {progress !== undefined && !pending && (
        <span
          aria-hidden="true"
          className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <span
            className="block h-full rounded-full bg-info"
            style={{ width: `${progress}%` }}
          />
        </span>
      )}
      {hint && !pending && (
        <span className="block text-xs text-muted-foreground">{hint}</span>
      )}
    </span>
  </Card>
)

export const MetricGrid = ({ children }: { children: ReactNode }) => (
  <div className="grid grid-cols-2 gap-3">{children}</div>
)

// The canvas's Applied filters anatomy: a labelled pill group per dimension —
// "Audience" (the saved list this campaign was sent to) above "Filters" (the
// criteria that built it). Door knocking groups by voter-file field instead of
// by those two, but the group itself is the same object on both surfaces.
export const FilterGroup = ({
  title,
  values,
}: {
  title: string
  values: string[]
}) => (
  <div className="space-y-1.5">
    <p className="text-xs font-medium text-muted-foreground">{title}</p>
    {/* Purely presentational, so plain Badges rather than toggle pills —
        nothing here should read as clickable, and the canvas draws them in
        the outlined resting state, not the toggled-on fill. Labels repeat
        across fields — 'Unknown' is an option on eleven of the voter-file
        fields — so the label alone is not a stable key even inside one
        group. */}
    <div className="flex flex-wrap gap-2">
      {values.map((label, index) => (
        <Badge
          key={`${label}-${index}`}
          shape="pill"
          className="border-border bg-transparent px-3 py-1.5 text-sm font-medium text-foreground"
        >
          {label}
        </Badge>
      ))}
    </div>
  </div>
)

export const DetailsSection = ({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) => (
  <section className="space-y-3">
    <Eyebrow>{title}</Eyebrow>
    {children}
  </section>
)
