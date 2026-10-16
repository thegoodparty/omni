import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import type { Campaign } from 'helpers/types'
import { router } from 'helpers/test-utils/router-mocking'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'
import { MEMBERSHIP_COPY } from './membershipCopy'
import { ProPitchDialog } from './ProPitchDialog'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProPitchDialog', () => {
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
      { channel: 'generic' },
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
      { channel: 'generic' },
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
      { channel: 'voter-data' },
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
})
