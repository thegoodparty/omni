import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LengthCounter } from './LengthCounter'

describe('LengthCounter', () => {
  it('stays quiet well under the limit', () => {
    const { container } = render(<LengthCounter length={899} max={1000} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('counts down from 90% of the limit', () => {
    render(<LengthCounter length={900} max={1000} />)
    expect(screen.getByRole('status')).toHaveTextContent('100 characters left')
  })

  it('says so once the limit is reached', () => {
    render(<LengthCounter length={2000} max={2000} />)
    expect(screen.getByRole('status')).toHaveTextContent(
      "You've reached the 2,000-character limit.",
    )
  })
})
