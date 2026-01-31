import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { formatNumberForDisplay } from './number'

describe('formatNumberForDisplay', () => {
  it('should format a number with locale string', () => {
    const { container } = render(<>{formatNumberForDisplay(1234567)}</>)
    expect(container.textContent).toBe('1,234,567')
  })

  it('should format a string number', () => {
    const { container } = render(<>{formatNumberForDisplay('1234567')}</>)
    expect(container.textContent).toBe('1,234,567')
  })

  it('should format decimal numbers', () => {
    const { container } = render(<>{formatNumberForDisplay(1234.56)}</>)
    expect(container.textContent).toBe('1,234.56')
  })

  it('should return default empty state for null', () => {
    const { container } = render(<>{formatNumberForDisplay(null)}</>)
    expect(container.textContent).toBe('—')
  })

  it('should return default empty state for undefined', () => {
    const { container } = render(<>{formatNumberForDisplay(undefined)}</>)
    expect(container.textContent).toBe('—')
  })

  it('should return custom empty state when provided', () => {
    const { container } = render(<>{formatNumberForDisplay(null, 'N/A')}</>)
    expect(container.textContent).toBe('N/A')
  })

  it('should return empty state for non-numeric string', () => {
    const { container } = render(<>{formatNumberForDisplay('not-a-number')}</>)
    expect(container.textContent).toBe('—')
  })

  it('should handle zero', () => {
    const { container } = render(<>{formatNumberForDisplay(0)}</>)
    expect(container.textContent).toBe('0')
  })

  it('should handle negative numbers', () => {
    const { container } = render(<>{formatNumberForDisplay(-1234)}</>)
    expect(container.textContent).toBe('-1,234')
  })
})
