import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SmsMessagePreview } from './SmsMessagePreview'

describe('SmsMessagePreview', () => {
  it('warns about a very wide image using the contracts ratio', () => {
    render(<SmsMessagePreview imageUrl="https://x.test/a.png" script="Hi" />)
    const img = screen.getByAltText('Campaign attachment')
    Object.defineProperty(img, 'naturalWidth', { value: 2400 })
    Object.defineProperty(img, 'naturalHeight', { value: 300 })
    Object.defineProperty(img, 'complete', { value: true })
    fireEvent.load(img)

    expect(
      screen.getByText(
        'Very wide image (2400 × 300 px). Phones will crop the sides.'
      )
    ).toBeInTheDocument()
  })
})
