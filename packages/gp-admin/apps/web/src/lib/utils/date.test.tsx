import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { formatDate, formatTimestampString } from './date'

describe('formatDate', () => {
  it('should format a Date object', () => {
    // Use explicit UTC date to avoid timezone issues
    const date = new Date(2024, 2, 15) // March 15, 2024 in local timezone
    const { container } = render(<>{formatDate(date)}</>)
    expect(container.textContent).toBe('Mar 15, 2024')
  })

  it('should format a date string with time component', () => {
    const { container } = render(<>{formatDate('2024-03-15T12:00:00')}</>)
    expect(container.textContent).toBe('Mar 15, 2024')
  })

  it('should format a timestamp number', () => {
    const timestamp = new Date(2024, 2, 15).getTime() // March 15, 2024
    const { container } = render(<>{formatDate(timestamp)}</>)
    expect(container.textContent).toBe('Mar 15, 2024')
  })

  it('should return default empty state for null', () => {
    const { container } = render(<>{formatDate(null)}</>)
    expect(container.textContent).toBe('—')
  })

  it('should return default empty state for undefined', () => {
    const { container } = render(<>{formatDate(undefined)}</>)
    expect(container.textContent).toBe('—')
  })

  it('should return custom empty state when provided', () => {
    const { container } = render(<>{formatDate(null, 'N/A')}</>)
    expect(container.textContent).toBe('N/A')
  })

  it('should return empty state for invalid date string', () => {
    const { container } = render(<>{formatDate('invalid-date')}</>)
    expect(container.textContent).toBe('—')
  })
})

describe('formatTimestampString', () => {
  it('should format a valid timestamp string', () => {
    const timestamp = new Date(2024, 2, 15).getTime().toString() // March 15, 2024
    const { container } = render(<>{formatTimestampString(timestamp)}</>)
    expect(container.textContent).toBe('Mar 15, 2024')
  })

  it('should return default empty state for undefined', () => {
    const { container } = render(<>{formatTimestampString(undefined)}</>)
    expect(container.textContent).toBe('—')
  })

  it('should return custom empty state when provided', () => {
    const { container } = render(<>{formatTimestampString(undefined, 'N/A')}</>)
    expect(container.textContent).toBe('N/A')
  })

  it('should return original string if not a valid number', () => {
    const { container } = render(<>{formatTimestampString('not-a-number')}</>)
    expect(container.textContent).toBe('not-a-number')
  })
})
