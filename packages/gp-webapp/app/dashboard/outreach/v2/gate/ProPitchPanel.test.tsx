import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { PITCH_PANEL_COPY, PRO_COPY, type GateChannel } from './gateCopy'
import { ProPitchPanel } from './ProPitchPanel'

const CHANNELS: GateChannel[] = ['sms', 'robocall', 'door', 'phone-bank']

describe('ProPitchPanel', () => {
  it.each(CHANNELS)(
    'renders the %s headline and all three bullets',
    (channel) => {
      render(<ProPitchPanel channel={channel} />)

      expect(screen.getByText(PRO_COPY[channel].headline)).toBeInTheDocument()
      PRO_COPY[channel].bullets.forEach((bullet) => {
        expect(screen.getByText(bullet)).toBeInTheDocument()
      })
    },
  )

  it('keeps the texting verification card collapsed until it is clicked', async () => {
    const user = userEvent.setup()
    render(<ProPitchPanel channel="sms" />)

    expect(screen.getByText(PITCH_PANEL_COPY.verifyTitle)).toBeInTheDocument()
    expect(screen.queryByText(PITCH_PANEL_COPY.verifyBody)).toBeNull()

    await user.click(
      screen.getByRole('button', { name: PITCH_PANEL_COPY.verifyTitle }),
    )

    expect(screen.getByText(PITCH_PANEL_COPY.verifyBody)).toBeInTheDocument()
    PITCH_PANEL_COPY.verifyRows.forEach((row) => {
      expect(screen.getByText(row)).toBeInTheDocument()
    })
    expect(screen.getByText(PITCH_PANEL_COPY.verifyFeePill)).toBeInTheDocument()
  })

  it('opens the verification card from the start when asked', () => {
    render(<ProPitchPanel channel="sms" verifyDefaultOpen />)

    expect(screen.getByText(PITCH_PANEL_COPY.verifyBody)).toBeInTheDocument()
    expect(screen.getByText(PITCH_PANEL_COPY.verifyFeePill)).toBeInTheDocument()
  })

  it('shows no verification card for a channel that never needs one', () => {
    render(<ProPitchPanel channel="robocall" />)

    expect(screen.queryByText(PITCH_PANEL_COPY.verifyTitle)).toBeNull()
  })

  it('hides the value card but keeps the verification card when hideValue is set', () => {
    render(<ProPitchPanel channel="sms" hideValue />)

    expect(screen.queryByText(PRO_COPY.sms.headline)).toBeNull()
    PRO_COPY.sms.bullets.forEach((bullet) => {
      expect(screen.queryByText(bullet)).toBeNull()
    })
    expect(screen.getByText(PITCH_PANEL_COPY.verifyTitle)).toBeInTheDocument()
  })

  it('renders nothing when hideValue leaves a channel with no card at all', () => {
    const { container } = render(<ProPitchPanel channel="robocall" hideValue />)

    expect(container).toBeEmptyDOMElement()
  })
})
