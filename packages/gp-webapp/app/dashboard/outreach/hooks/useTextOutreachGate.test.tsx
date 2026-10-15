import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useTextOutreachGate } from './useTextOutreachGate'
import type { Campaign, TcrCompliance } from 'helpers/types'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const Harness = ({ tcrCompliance }: { tcrCompliance?: TcrCompliance }) => {
  const { runTextGate, gateModals } = useTextOutreachGate(tcrCompliance)
  const [opened, setOpened] = useState(false)
  return (
    <>
      <button onClick={() => runTextGate() && setOpened(true)}>run gate</button>
      {opened && <div>flow opened</div>}
      {gateModals}
    </>
  )
}

const approvedCompliance = { status: 'approved' } as TcrCompliance
const pendingCompliance = { status: 'pending' } as TcrCompliance

const renderHarness = ({
  isPro,
  tcrCompliance,
  smsCompliance,
}: {
  isPro: boolean
  tcrCompliance?: TcrCompliance
  smsCompliance?: Campaign['smsCompliance']
}) =>
  render(
    <CampaignContext.Provider
      value={[
        {
          id: 1,
          isPro,
          smsCompliance,
          smsCutoffDate: smsCompliance ? '2026-10-15' : null,
        } as Campaign,
      ]}
    >
      <Harness tcrCompliance={tcrCompliance} />
    </CampaignContext.Provider>,
  )

describe('useTextOutreachGate', () => {
  beforeEach(() => {
    vi.mocked(trackEvent).mockClear()
  })

  it('shows the P2P upgrade modal for a non-Pro user', async () => {
    renderHarness({ isPro: false, tcrCompliance: approvedCompliance })

    await userEvent.click(screen.getByText('run gate'))

    expect(
      screen.getByText('Level the playing field for less'),
    ).toBeInTheDocument()
    expect(screen.queryByText('flow opened')).not.toBeInTheDocument()
  })

  it('shows the compliance modal for a Pro non-compliant user and tracks the view', async () => {
    renderHarness({ isPro: true, tcrCompliance: pendingCompliance })

    await userEvent.click(screen.getByText('run gate'))

    expect(
      screen.getByText('Texting registration under review'),
    ).toBeInTheDocument()
    expect(screen.queryByText('flow opened')).not.toBeInTheDocument()
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.P2PCompliance.ComplianceModalViewed,
      { source: 'outreach_page' },
    )
  })

  it('shows the registration compliance modal when no tcr record exists', async () => {
    renderHarness({ isPro: true })

    await userEvent.click(screen.getByText('run gate'))

    expect(
      screen.getByText('Action required: register for texting compliance'),
    ).toBeInTheDocument()
    expect(screen.queryByText('flow opened')).not.toBeInTheDocument()
  })

  it('passes for a Pro, text-compliant user', async () => {
    renderHarness({ isPro: true, tcrCompliance: approvedCompliance })

    await userEvent.click(screen.getByText('run gate'))

    expect(screen.getByText('flow opened')).toBeInTheDocument()
    expect(
      screen.queryByText('Texting registration under review'),
    ).not.toBeInTheDocument()
  })

  it('shows the cutoff notice instead of a pitch or the compliance modal once texting has closed', async () => {
    renderHarness({ isPro: false, smsCompliance: 'closed' })

    await userEvent.click(screen.getByText('run gate'))

    expect(
      screen.getByRole('dialog', {
        name: 'The Oct. 15 deadline to get verified for texting has passed.',
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Level the playing field for less'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('flow opened')).not.toBeInTheDocument()
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.SmsCutoff.NoticeViewed,
      expect.objectContaining({ surface: 'outreach_page' }),
    )
  })
})
