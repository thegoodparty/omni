import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { formatDate, formatDateTime, formatTimestampString } from './date'

describe('formatDate', () => {
  it('displays dates in "Mon D, YYYY" format', () => {
    const date = new Date(2024, 2, 15) // March 15, 2024
    const { container } = render(<>{formatDate(date)}</>)
    expect(container.textContent).toBe('Mar 15, 2024')
  })

  it('handles ISO date strings', () => {
    const { container } = render(<>{formatDate('2024-03-15T12:00:00')}</>)
    expect(container.textContent).toBe('Mar 15, 2024')
  })

  it('handles Unix timestamps', () => {
    const timestamp = new Date(2024, 2, 15).getTime()
    const { container } = render(<>{formatDate(timestamp)}</>)
    expect(container.textContent).toBe('Mar 15, 2024')
  })

  it('shows em-dash when date is missing', () => {
    const { container: nullContainer } = render(<>{formatDate(null)}</>)
    const { container: undefinedContainer } = render(
      <>{formatDate(undefined)}</>
    )
    expect(nullContainer.textContent).toBe('—')
    expect(undefinedContainer.textContent).toBe('—')
  })

  it('shows custom placeholder when date is missing', () => {
    const { container } = render(<>{formatDate(null, 'N/A')}</>)
    expect(container.textContent).toBe('N/A')
  })

  it('shows em-dash for invalid date strings', () => {
    const { container } = render(<>{formatDate('invalid-date')}</>)
    expect(container.textContent).toBe('—')
  })
})

describe('formatDateTime', () => {
  it('includes the time and Eastern zone label', () => {
    // 3pm UTC on a summer date is 11am EDT.
    const { container } = render(
      <>{formatDateTime(new Date('2026-09-10T15:00:00Z'))}</>
    )
    expect(container.textContent).toBe('Sep 10, 2026, 11:00 AM EDT')
  })

  it('shows em-dash when the value is missing', () => {
    const { container } = render(<>{formatDateTime(null)}</>)
    expect(container.textContent).toBe('—')
  })

  it('shows em-dash for invalid date strings', () => {
    const { container } = render(<>{formatDateTime('invalid-date')}</>)
    expect(container.textContent).toBe('—')
  })
})

describe('formatTimestampString', () => {
  it('converts string timestamps to readable dates', () => {
    const timestamp = new Date(2024, 2, 15).getTime().toString()
    const { container } = render(<>{formatTimestampString(timestamp)}</>)
    expect(container.textContent).toBe('Mar 15, 2024')
  })

  it('shows em-dash when timestamp is missing', () => {
    const { container } = render(<>{formatTimestampString(undefined)}</>)
    expect(container.textContent).toBe('—')
  })

  it('shows custom placeholder when timestamp is missing', () => {
    const { container } = render(<>{formatTimestampString(undefined, 'N/A')}</>)
    expect(container.textContent).toBe('N/A')
  })

  it('preserves non-numeric strings as-is', () => {
    const { container } = render(<>{formatTimestampString('not-a-number')}</>)
    expect(container.textContent).toBe('not-a-number')
  })
})
