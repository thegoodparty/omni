import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Theme } from '@radix-ui/themes'
import { PhoneMessagePreview } from './PhoneMessagePreview'

const renderPreview = (props: Parameters<typeof PhoneMessagePreview>[0]) =>
  render(
    <Theme>
      <PhoneMessagePreview {...props} />
    </Theme>
  )

const loadImage = (width: number, height: number) => {
  const img = screen.getByAltText('Campaign attachment')
  Object.defineProperty(img, 'naturalWidth', { value: width })
  Object.defineProperty(img, 'naturalHeight', { value: height })
  Object.defineProperty(img, 'complete', { value: true })
  fireEvent.load(img)
}

describe('PhoneMessagePreview', () => {
  it('shows the image and the message', () => {
    renderPreview({ imageUrl: 'https://x.test/a.png', script: 'Hi there' })

    expect(screen.getByAltText('Campaign attachment')).toBeInTheDocument()
    expect(screen.getByText('Hi there')).toBeInTheDocument()
  })

  it('stays quiet for a normal photo', () => {
    renderPreview({ imageUrl: 'https://x.test/a.png', script: 'Hi' })
    loadImage(1080, 1350)

    expect(screen.queryByText(/Very/)).not.toBeInTheDocument()
  })

  it('warns about a very tall image', () => {
    renderPreview({ imageUrl: 'https://x.test/a.png', script: 'Hi' })
    loadImage(600, 2400)

    expect(
      screen.getByText(
        'Very tall image (600 × 2400 px). Phones will crop the top and bottom.'
      )
    ).toBeInTheDocument()
  })

  it('warns about a very wide image', () => {
    renderPreview({ imageUrl: 'https://x.test/a.png', script: 'Hi' })
    loadImage(2400, 300)

    expect(
      screen.getByText(
        'Very wide image (2400 × 300 px). Phones will crop the sides.'
      )
    ).toBeInTheDocument()
  })

  it('shows a dash when there is no message or image', () => {
    renderPreview({ imageUrl: null, script: null })

    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
