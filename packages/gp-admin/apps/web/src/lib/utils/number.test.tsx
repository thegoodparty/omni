import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { formatNumberForDisplay } from './number'

describe('formatNumberForDisplay', () => {
  it('adds thousands separators for readability', () => {
    const { container } = render(<>{formatNumberForDisplay(1234567)}</>)
    expect(container.textContent).toBe('1,234,567')
  })

  it('handles string numbers', () => {
    const { container } = render(<>{formatNumberForDisplay('1234567')}</>)
    expect(container.textContent).toBe('1,234,567')
  })

  it('preserves decimal places', () => {
    const { container } = render(<>{formatNumberForDisplay(1234.56)}</>)
    expect(container.textContent).toBe('1,234.56')
  })

  it('shows em-dash when value is missing', () => {
    const { container: nullContainer } = render(<>{formatNumberForDisplay(null)}</>)
    const { container: undefinedContainer } = render(<>{formatNumberForDisplay(undefined)}</>)
    expect(nullContainer.textContent).toBe('—')
    expect(undefinedContainer.textContent).toBe('—')
  })

  it('shows custom placeholder when value is missing', () => {
    const { container } = render(<>{formatNumberForDisplay(null, 'N/A')}</>)
    expect(container.textContent).toBe('N/A')
  })

  it('shows em-dash for non-numeric strings', () => {
    const { container } = render(<>{formatNumberForDisplay('not-a-number')}</>)
    expect(container.textContent).toBe('—')
  })

  it('displays zero correctly', () => {
    const { container } = render(<>{formatNumberForDisplay(0)}</>)
    expect(container.textContent).toBe('0')
  })

  it('handles negative numbers', () => {
    const { container } = render(<>{formatNumberForDisplay(-1234)}</>)
    expect(container.textContent).toBe('-1,234')
  })
})
