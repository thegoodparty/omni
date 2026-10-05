import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ThreatTierBadge, { threatTierLabel } from './ThreatTierBadge'

describe('ThreatTierBadge', () => {
  it.each([
    ['primary_threat', 'Main threat', 'text-primary', 'bg-primary'],
    ['watch_closely', 'Watch closely', 'text-foreground', 'bg-warning-600'],
    [
      'low_priority',
      'Low priority',
      'text-foreground',
      'bg-muted-foreground/50',
    ],
  ] as const)(
    'renders the %s tier with its label and dot/text color tokens',
    (tier, label, textClass, dotClass) => {
      render(<ThreatTierBadge tier={tier} />)

      // getByText matches the outer <span> (the only element whose own
      // normalized text equals the label — the dot span is empty).
      const badge = screen.getByText(label)
      expect(badge).toHaveClass(textClass)

      const dot = badge.querySelector('span[aria-hidden]')
      expect(dot).not.toBeNull()
      expect(dot).toHaveClass(dotClass)
    },
  )

  it('exposes the same labels via threatTierLabel for the PDF export', () => {
    expect(threatTierLabel('primary_threat')).toBe('Main threat')
    expect(threatTierLabel('watch_closely')).toBe('Watch closely')
    expect(threatTierLabel('low_priority')).toBe('Low priority')
  })
})
