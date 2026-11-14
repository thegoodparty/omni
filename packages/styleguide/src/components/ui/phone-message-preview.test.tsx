import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PhoneMessagePreview } from './phone-message-preview'

const loadImage = (width: number, height: number) => {
  const img = screen.getByAltText('Campaign attachment')
  Object.defineProperty(img, 'naturalWidth', { value: width })
  Object.defineProperty(img, 'naturalHeight', { value: height })
  Object.defineProperty(img, 'complete', { value: true })
  fireEvent.load(img)
}

const warnByRatio = (width: number, height: number) =>
  width / height > 2 ? 'wide' : width / height < 0.5 ? 'tall' : null

describe('PhoneMessagePreview', () => {
  it('shows the message and the image', () => {
    render(<PhoneMessagePreview imageUrl="https://x.test/a.png" script="Hi" />)

    expect(screen.getByText('Hi')).toBeInTheDocument()
    expect(screen.getByAltText('Campaign attachment')).toBeInTheDocument()
  })

  it('preserves runs of spaces in the message bubble', () => {
    render(<PhoneMessagePreview imageUrl={null} script="Hi  there" />)

    expect(screen.getByText(/Hi\s+there/)).toHaveClass('whitespace-pre-wrap')
  })

  it('renders no image without an imageUrl', () => {
    render(<PhoneMessagePreview imageUrl={null} script="Hi" />)

    expect(screen.queryByAltText('Campaign attachment')).not.toBeInTheDocument()
  })

  it('shows the sender name and initials', () => {
    render(
      <PhoneMessagePreview
        imageUrl={null}
        script="Hi"
        senderName="Dana Ortiz for Council"
      />,
    )

    expect(screen.getByText('Dana Ortiz for Council')).toBeInTheDocument()
    expect(screen.getByText('DO')).toBeInTheDocument()
  })

  it('falls back to a generic sender without a name', () => {
    render(<PhoneMessagePreview imageUrl={null} script="Hi" senderName=" " />)

    expect(screen.getByText('Your campaign')).toBeInTheDocument()
    expect(screen.getByText('YC')).toBeInTheDocument()
  })

  it('keeps the composer decorative', () => {
    render(<PhoneMessagePreview imageUrl={null} script="Hi" />)

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows a dash with no message or image', () => {
    render(<PhoneMessagePreview imageUrl={null} script={null} />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('warns about a very wide image', () => {
    render(
      <PhoneMessagePreview
        imageUrl="https://x.test/a.png"
        script="Hi"
        getAspectWarning={warnByRatio}
      />,
    )
    loadImage(300, 100)

    expect(
      screen.getByText(
        'Very wide image (300 × 100 px). Phones will crop the sides.',
      ),
    ).toBeInTheDocument()
  })

  it('warns about a very tall image', () => {
    render(
      <PhoneMessagePreview
        imageUrl="https://x.test/a.png"
        script="Hi"
        getAspectWarning={warnByRatio}
      />,
    )
    loadImage(100, 300)

    expect(
      screen.getByText(
        'Very tall image (100 × 300 px). Phones will crop the top and bottom.',
      ),
    ).toBeInTheDocument()
  })

  it('stays quiet for a normal image', () => {
    render(
      <PhoneMessagePreview
        imageUrl="https://x.test/a.png"
        script="Hi"
        getAspectWarning={warnByRatio}
      />,
    )
    loadImage(1080, 1350)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows no warning without getAspectWarning', () => {
    render(<PhoneMessagePreview imageUrl="https://x.test/a.png" script="Hi" />)
    loadImage(300, 100)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
