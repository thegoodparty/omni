import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChannelCard } from './channel-card'

describe('ChannelCard', () => {
  it('reads the tag as the description, not part of the name', () => {
    render(<ChannelCard icon={null} label="SMS" tag="Verify by Nov. 14" />)

    expect(
      screen.getByRole('button', { name: 'SMS' }),
    ).toHaveAccessibleDescription('Verify by Nov. 14')
  })

  it('keeps a caller description beside the tag', () => {
    render(
      <>
        <span id="hint">Opens the flow</span>
        <ChannelCard
          icon={null}
          label="SMS"
          tag="Pro"
          aria-describedby="hint"
        />
      </>,
    )

    expect(
      screen.getByRole('button', { name: 'SMS' }),
    ).toHaveAccessibleDescription('Opens the flow Pro')
  })

  it('renders no tag and no description without one', () => {
    render(<ChannelCard icon={null} label="Social media" />)

    const card = screen.getByRole('button', { name: 'Social media' })
    expect(card).not.toHaveAttribute('aria-describedby')
    expect(
      card.querySelector('[data-slot="channel-card-tag"]'),
    ).not.toBeInTheDocument()
  })

  it('tones the tag', () => {
    render(
      <ChannelCard
        icon={null}
        label="Robocall"
        tag="Free offer"
        tagTone="info"
      />,
    )

    expect(screen.getByText('Free offer')).toHaveAttribute('data-tone', 'info')
  })
})
