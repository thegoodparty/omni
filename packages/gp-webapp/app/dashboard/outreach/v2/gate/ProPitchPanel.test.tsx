import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import type { Campaign } from 'helpers/types'
import {
  PITCH_PANEL_COPY,
  PRO_COPY,
  PRO_COPY_SMS_CLOSED,
  type GateChannel,
} from './gateCopy'
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

  describe('with texting closed for the race', () => {
    const closedReason =
      'The Oct. 15 deadline to get verified for texting has passed.'
    const renderClosed = (ui: React.ReactElement) =>
      render(
        <CampaignContext.Provider
          value={[
            {
              smsCompliance: 'closed',
              smsCutoffDate: '2026-10-15',
              generalElectionDate: '2026-11-03',
            } as Campaign,
          ]}
        >
          {ui}
        </CampaignContext.Provider>,
      )

    it('sells the channels Pro still unlocks in place of texting, with the closed reason', () => {
      renderClosed(<ProPitchPanel channel="sms" />)

      expect(screen.getByText(closedReason)).toBeInTheDocument()
      expect(screen.getByText(PRO_COPY_SMS_CLOSED.headline)).toBeInTheDocument()
      PRO_COPY_SMS_CLOSED.bullets.forEach((bullet) => {
        expect(screen.getByText(bullet)).toBeInTheDocument()
      })
      expect(screen.queryByText(PRO_COPY.sms.headline)).toBeNull()
      expect(screen.queryByText(PITCH_PANEL_COPY.verifyTitle)).toBeNull()
    })

    it("keeps another channel's pitch and adds the closed reason before purchase", () => {
      renderClosed(<ProPitchPanel channel="robocall" />)

      expect(screen.getByText(closedReason)).toBeInTheDocument()
      expect(screen.getByText(PRO_COPY.robocall.headline)).toBeInTheDocument()
    })

    it('renders nothing once the value card is hidden and there is no verification to show', () => {
      const { container } = renderClosed(
        <ProPitchPanel channel="sms" hideValue />,
      )

      expect(container).toBeEmptyDOMElement()
    })
  })
})
