import { describe, it, expect, vi, beforeEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { CampaignStatusProvider } from './CampaignStatusProvider'
import { useCampaignStatus } from '@shared/hooks/useCampaignStatus'

const mockUseOrganization = vi.fn<() => { role?: string } | undefined>(
  () => undefined,
)
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => mockUseOrganization(),
}))

const mockUseTeamAccountsFlag = vi.fn(() => ({
  ready: true,
  enabled: false,
  failed: false,
}))
vi.mock('@shared/experiments/teamAccountsFlag', () => ({
  useTeamAccountsFlag: (...args: unknown[]) =>
    mockUseTeamAccountsFlag(...(args as [])),
}))

const mockUseCampaign = vi.fn(() => [null])
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => mockUseCampaign(),
}))

const mockUseUser = vi.fn(() => [{ id: 1 }])
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => mockUseUser(),
}))

const StatusConsumer = () => {
  const [campaignStatus] = useCampaignStatus()
  return (
    <div data-testid="status">
      {campaignStatus ? JSON.stringify(campaignStatus) : 'null'}
    </div>
  )
}

beforeEach(() => {
  mockUseOrganization.mockReset().mockReturnValue(undefined)
  mockUseTeamAccountsFlag.mockReset().mockReturnValue({
    ready: true,
    enabled: false,
    failed: false,
  })
  mockUseCampaign.mockReset().mockReturnValue([null])
  mockUseUser.mockReset().mockReturnValue([{ id: 1 }])
})

describe('CampaignStatusProvider', () => {
  // ENG-11072: gp-api's UseCampaignGuard fails closed on a volunteer
  // membership, so this always 403s for one. The effect must not fire the
  // request at all for a volunteer's active org.
  it('does not request GET /v1/campaigns/mine/status when the active org is volunteer and the flag is on', async () => {
    mockUseOrganization.mockReturnValue({ role: 'volunteer' })
    mockUseTeamAccountsFlag.mockReturnValue({
      ready: true,
      enabled: true,
      failed: false,
    })
    let requested = false
    api.mock('GET /v1/campaigns/mine/status', () => {
      requested = true
      return { status: 200, data: { status: 'candidate' } }
    })

    render(
      <CampaignStatusProvider>
        <StatusConsumer />
      </CampaignStatusProvider>,
    )

    // Give any (incorrectly) fired effect a tick to resolve.
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="status"]'),
      ).toHaveTextContent('null'),
    )
    expect(requested).toBe(false)
  })

  it('still requests GET /v1/campaigns/mine/status for a volunteer-role org when the flag is off', async () => {
    mockUseOrganization.mockReturnValue({ role: 'volunteer' })
    mockUseTeamAccountsFlag.mockReturnValue({
      ready: true,
      enabled: false,
      failed: false,
    })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 200,
      data: { status: 'candidate' },
    })

    render(
      <CampaignStatusProvider>
        <StatusConsumer />
      </CampaignStatusProvider>,
    )

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="status"]'),
      ).toHaveTextContent('candidate'),
    )
  })

  it('requests GET /v1/campaigns/mine/status for a non-volunteer active org even with the flag on', async () => {
    mockUseOrganization.mockReturnValue({ role: 'owner' })
    mockUseTeamAccountsFlag.mockReturnValue({
      ready: true,
      enabled: true,
      failed: false,
    })
    api.mock('GET /v1/campaigns/mine/status', {
      status: 200,
      data: { status: 'candidate' },
    })

    render(
      <CampaignStatusProvider>
        <StatusConsumer />
      </CampaignStatusProvider>,
    )

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="status"]'),
      ).toHaveTextContent('candidate'),
    )
  })
})
