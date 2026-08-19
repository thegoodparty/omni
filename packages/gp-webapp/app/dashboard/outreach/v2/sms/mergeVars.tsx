import type { ReactNode } from 'react'

// Renders {merge_var} tokens as inline pills — light-blue tint that stays
// readable on both the light editor card and the dark (bg-primary) preview
// bubble, per the design prototype's renderWithMergeVars.
export const renderWithMergeVars = (text: string): ReactNode =>
  text.split(/(\{[a-zA-Z0-9_ ]+\})/g).map((part, i) => {
    if (/^\{[a-zA-Z0-9_ ]+\}$/.test(part)) {
      const label = part
        .slice(1, -1)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
      return (
        <span
          key={i}
          className="mx-0.5 inline-flex items-center rounded-full bg-primary-light px-2 py-0.5 align-baseline text-xs font-medium text-primary-dark"
        >
          {label}
        </span>
      )
    }
    return <span key={i}>{part}</span>
  })
