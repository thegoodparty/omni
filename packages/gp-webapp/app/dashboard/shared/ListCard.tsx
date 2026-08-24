'use client'

import type { ReactNode } from 'react'
import { Card, cn } from '@styleguide'

export interface ListCardMetaItem {
  key: string
  icon: ReactNode
  value: ReactNode
  // The visible figure leaves its noun to the icon and the column layout, and a
  // screen reader has neither — so every item names its own quantity.
  label: string
}

export interface ListCardProps {
  // The list's own colour, drawn as a bar down the leading edge. Optional
  // because not every surface that reuses this card colours its rows.
  accentColor?: string
  // The eyebrow above the title: a lifecycle badge, a progress line, whatever
  // the surface's vocabulary is. This card never invents one.
  eyebrow?: ReactNode
  title: string
  // Selecting is a real button on the title rather than a click handler on the
  // card, because the card carries other controls: a clickable container around
  // them needs stopPropagation on every one and reads to a screen reader as a
  // button holding five buttons.
  onSelect?: () => void
  selected?: boolean
  // Top-right cluster — the controls that act on the row rather than on the
  // thing it names (visibility, delete).
  controls?: ReactNode
  meta?: ListCardMetaItem[]
  // The footer row, right-aligned. The primary CTA goes last.
  actions?: ReactNode
  // Rendered below the actions, and only while the card is selected. The
  // session-ending control lives here rather than in the always-visible footer:
  // it is the least frequent thing anyone does to a list and the most final.
  expandedActions?: ReactNode
  // Quieter presentation for a row the surface is de-emphasising (a hidden
  // outline, an archived list) without removing any of its affordances.
  dimmed?: boolean
  'data-testid'?: string
}

export function ListCard({
  accentColor,
  eyebrow,
  title,
  onSelect,
  selected = false,
  controls,
  meta,
  actions,
  expandedActions,
  dimmed = false,
  'data-testid': testId,
}: ListCardProps) {
  return (
    <Card
      data-testid={testId}
      className={cn(
        'relative gap-0 overflow-hidden p-3',
        accentColor && 'pl-4',
        selected ? 'border-2 border-tertiary-dark' : 'border-border',
        dimmed && 'opacity-70',
      )}
    >
      {accentColor && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1.5"
          style={{ backgroundColor: accentColor }}
        />
      )}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {eyebrow}
          {onSelect ? (
            <button
              type="button"
              aria-pressed={selected}
              className="block w-full truncate text-left text-sm font-semibold hover:underline"
              onClick={onSelect}
            >
              {title}
            </button>
          ) : (
            <h3 className="truncate text-sm font-semibold">{title}</h3>
          )}
        </div>
        {controls && (
          <div className="flex shrink-0 items-center gap-0.5">{controls}</div>
        )}
      </div>
      {meta && meta.length > 0 && (
        <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
          {meta.map((item) => (
            <li key={item.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-flex">
                {item.icon}
              </span>
              <span>
                {item.value} <span className="sr-only">{item.label}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {actions && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      )}
      {selected && expandedActions && (
        <div className="mt-3 border-t border-border pt-3">
          {expandedActions}
        </div>
      )}
    </Card>
  )
}
