import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import type { Campaign } from 'helpers/types'
import { router } from 'helpers/test-utils/router-mocking'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'
import { MEMBERSHIP_COPY } from './membershipCopy'
import { PLAN_PRICING } from '@goodparty_org/contracts'
import { ProPitchDialog } from './ProPitchDialog'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const { mockPlanFlag } = vi.hoisted(() => ({
  mockPlanFlag: { enabled: false },
}))
vi.mock('@shared/experiments/winPerCampaignPricingFlag', () => ({
  useWinPerCampaignPricingFlag: () => ({
    ready: true,
    enabled: mockPlanFlag.enabled,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockPlanFlag.enabled = false
})

describe('ProPitchDialog', () => {
  it('closes when See all plans navigates away', async () => {
    mockPlanFlag.enabled = true
    const onOpenChange = vi.fn()
    render(
      <ProPitchDialog
        source="navigation"
        channel="generic"
        open
        onOpenChange={onOpenChange}
      />,
    )

    await userEvent.click(screen.getByRole('link', { name: 'See all plans' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders the title, the price pill and every tile title when open', () => {
    render(
      <ProPitchDialog
        source="navigation"
        channel="generic"
        open
        onOpenChange={vi.fn()}
      />,
    )

    expect(screen.getByText(MEMBERSHIP_COPY.pitch.title)).toBeInTheDocument()
    expect(screen.getByText(MEMBERSHIP_COPY.pitch.pill)).toBeInTheDocument()
    MEMBERSHIP_COPY.pitch.tiles.forEach(({ title, body }) => {
      expect(screen.getByText(title)).toBeInTheDocument()
      expect(screen.getByText(body)).toBeInTheDocument()
    })
  })

  // DialogHeader's own classes end in `sm:text-left`, so without the sm:
  // breakpoint restated the desktop dialog left-aligns every wrapped line.
  // The footer also has to sit OUTSIDE the scrolling body, or a short
  // viewport scrolls the Join button off the bottom of the dialog.
  it('centers the header and pins the footer outside the scrolling body', () => {
    render(
      <ProPitchDialog
        source="navigation"
        channel="generic"
        open
        onOpenChange={vi.fn()}
      />,
    )

    const content = document.querySelector('[data-slot="dialog-content"]')
    const footer = document.querySelector('[data-slot="dialog-footer"]')

    expect(document.querySelector('[data-slot="dialog-header"]')).toHaveClass(
      'sm:text-center',
    )
    expect(footer).toHaveClass('shrink-0')
    expect(content).toHaveClass('flex-col')
    expect(content?.querySelector('.overflow-y-auto')).not.toContainElement(
      footer as HTMLElement,
    )
  })

  it('reports the generic interstitial view when the dialog opens', () => {
    render(
      <ProPitchDialog
        source="navigation"
        channel="generic"
        open
        onOpenChange={vi.fn()}
      />,
    )

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.InterstitialViewed,
      { channel: 'generic', plan: 'free' },
    )
  })

  it('renders nothing when closed', () => {
    render(
      <ProPitchDialog
        source="navigation"
        channel="generic"
        open={false}
        onOpenChange={vi.fn()}
      />,
    )

    expect(screen.queryByText(MEMBERSHIP_COPY.pitch.title)).toBeNull()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('pushes the Pro upgrade entry path and closes when Join is clicked', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <ProPitchDialog
        source="navigation"
        channel="generic"
        open
        onOpenChange={onOpenChange}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: MEMBERSHIP_COPY.pitch.join }),
    )

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.InterstitialCompleted,
      { channel: 'generic', plan: 'free' },
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(router.push).toHaveBeenCalledWith(
      '/dashboard/pro-upgrade?source=navigation&channel=generic&cta=Join+Pro',
    )
  })

  it('closes without navigating when the dialog is dismissed', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <ProPitchDialog
        source="navigation"
        channel="generic"
        open
        onOpenChange={onOpenChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.InterstitialDismissed,
      { channel: 'generic' },
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(router.push).not.toHaveBeenCalled()
  })

  it('carries a voter data wall into its events and the wizard link', async () => {
    const user = userEvent.setup()
    render(
      <ProPitchDialog
        source="contacts"
        channel="voter-data"
        open
        onOpenChange={vi.fn()}
      />,
    )

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.InterstitialViewed,
      { channel: 'voter-data', plan: 'free' },
    )

    await user.click(
      screen.getByRole('button', { name: MEMBERSHIP_COPY.pitch.join }),
    )

    expect(router.push).toHaveBeenCalledWith(
      '/dashboard/pro-upgrade?source=contacts&channel=voter-data&cta=Join+Pro',
    )
  })

  it('drops the verification tile and shows the closed reason once texting has closed', () => {
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
        <ProPitchDialog
          source="navigation"
          channel="generic"
          open
          onOpenChange={vi.fn()}
        />
      </CampaignContext.Provider>,
    )

    expect(
      screen.getByText(
        'The Oct. 15 deadline to get verified for texting has passed.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Campaign verification')).toBeNull()
    MEMBERSHIP_COPY.pitch.tiles
      .filter(({ title }) => title !== 'Campaign verification')
      .forEach(({ title }) => {
        expect(screen.getByText(title)).toBeInTheDocument()
      })
  })

  describe('with win_per_campaign_pricing on', () => {
    const renderPitch = (registeredVoters?: number, raceSizePitch = false) =>
      render(
        <CampaignContext.Provider
          value={[
            {
              raceTargetMetrics: { registeredVoters },
            } as unknown as Campaign,
          ]}
        >
          <ProPitchDialog
            source="navigation"
            channel="generic"
            open
            onOpenChange={vi.fn()}
            raceSizePitch={raceSizePitch}
          />
        </CampaignContext.Provider>,
      )

    it('pitches Pro at the Pro price with no legacy price copy', () => {
      mockPlanFlag.enabled = true
      renderPitch(PLAN_PRICING.teamRecommendVoterThreshold)

      expect(
        screen.getByText('Join Pro to unlock voter data and outreach'),
      ).toBeInTheDocument()
      expect(screen.getByText('$299')).toBeInTheDocument()
      expect(
        screen.getByText(/, one payment for your whole campaign/),
      ).toBeInTheDocument()
      expect(screen.getByLabelText('PRO')).toBeInTheDocument()
      expect(screen.queryByText('TEAM')).toBeNull()
      expect(screen.queryByText('Logins for your team')).toBeNull()
      expect(document.body.textContent).not.toMatch(/\$10\b|\/mo/)
      expect(
        screen.getByRole('button', { name: 'Join Pro for $299' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'See all plans' }),
      ).toHaveAttribute('href', '/dashboard/plans')
    })

    it('lists the four Pro rows with the credit on texts and robocalls', () => {
      mockPlanFlag.enabled = true
      renderPitch(PLAN_PRICING.teamRecommendVoterThreshold)

      const rows = screen.getAllByRole('listitem')
      expect(
        rows.map((row) => row.querySelector('.font-semibold')?.textContent),
      ).toEqual([
        'Voter data',
        'Texts and robocalls',
        'Door knocking and phone banking',
        'Campaign verification',
      ])
      expect(rows[1]).toHaveTextContent('$175 credit')
      expect(rows[0]).not.toHaveTextContent('credit')
    })

    it('pitches Pro at a contextual gate whatever the race size', async () => {
      mockPlanFlag.enabled = true
      renderPitch(PLAN_PRICING.teamRecommendVoterThreshold + 1)

      expect(
        screen.getByText('Join Pro to unlock voter data and outreach'),
      ).toBeInTheDocument()
      expect(screen.getByText('$299')).toBeInTheDocument()
      expect(screen.queryByText('$399')).toBeNull()
      expect(screen.queryByText('TEAM')).toBeNull()
      expect(
        screen.getByRole('link', { name: 'See all plans' }),
      ).toHaveAttribute('href', '/dashboard/plans')

      await userEvent.click(
        screen.getByRole('button', { name: 'Join Pro for $299' }),
      )

      expect(router.push).toHaveBeenCalledWith(
        expect.stringMatching(/[?&]plan=pro(&|$)/),
      )
    })

    it('pitches Team above the voter threshold with its badge and login row first', () => {
      mockPlanFlag.enabled = true
      renderPitch(PLAN_PRICING.teamRecommendVoterThreshold + 1, true)

      expect(
        screen.getByText('Join Team to unlock voter data and outreach'),
      ).toBeInTheDocument()
      expect(screen.getByText('$399')).toBeInTheDocument()
      expect(screen.getByText('TEAM')).toBeInTheDocument()
      expect(screen.queryByLabelText('PRO')).toBeNull()
      expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(
        'Logins for your team',
      )
      expect(
        screen.getByRole('button', { name: 'Join Team for $399' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'See all plans' }),
      ).toHaveAttribute('href', '/dashboard/plans?highlight=team')
    })

    it('carries the pitched Team plan into the wizard, so it sells what the dialog showed', async () => {
      mockPlanFlag.enabled = true
      renderPitch(PLAN_PRICING.teamRecommendVoterThreshold + 1, true)

      await userEvent.click(
        screen.getByRole('button', { name: 'Join Team for $399' }),
      )

      expect(router.push).toHaveBeenCalledWith(
        expect.stringMatching(/[?&]plan=team(&|$)/),
      )
    })

    it('keeps the cta attribution as the plan name', async () => {
      mockPlanFlag.enabled = true
      renderPitch(PLAN_PRICING.teamRecommendVoterThreshold + 1, true)

      await userEvent.click(
        screen.getByRole('button', { name: 'Join Team for $399' }),
      )

      expect(router.push).toHaveBeenCalledWith(
        expect.stringMatching(/[?&]cta=Join\+Team(&|$)/),
      )
    })

    it('sends the unpriced plan name as the cta from the invite pitch', async () => {
      mockPlanFlag.enabled = true
      render(
        <ProPitchDialog
          source="account_settings"
          channel="generic"
          open
          onOpenChange={vi.fn()}
          invite
        />,
      )

      await userEvent.click(screen.getByRole('button', { name: /Join Team/ }))

      expect(router.push).toHaveBeenCalledWith(
        expect.stringMatching(/[?&]cta=Join\+Team(&|$)/),
      )
      expect(router.push).toHaveBeenCalledWith(
        expect.stringMatching(/[?&]plan=team(&|$)/),
      )
    })

    it('keeps the legacy copy and no plans link with the flag off', () => {
      renderPitch(PLAN_PRICING.teamRecommendVoterThreshold + 1)

      expect(screen.getByText(MEMBERSHIP_COPY.pitch.pill)).toBeInTheDocument()
      expect(screen.queryByText('See all plans')).not.toBeInTheDocument()
    })
  })
})
