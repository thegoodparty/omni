import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import { P2pUxEnabledContext } from 'app/dashboard/components/tasks/flows/hooks/P2pUxEnabledProvider'
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
  p2pUxEnabled = true,
  tcrCompliance,
}: {
  isPro: boolean
  p2pUxEnabled?: boolean
  tcrCompliance?: TcrCompliance
}) =>
  render(
    <CampaignContext.Provider value={[{ id: 1, isPro } as Campaign]}>
      <P2pUxEnabledContext.Provider
        value={{
          p2pUxEnabled,
          tcrCompliant: false,
          proUpdatedAtDate: new Date(),
          resetP2pUxEnabled: () => undefined,
        }}
      >
        <Harness tcrCompliance={tcrCompliance} />
      </P2pUxEnabledContext.Provider>
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
})
