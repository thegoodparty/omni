import { describe, it, expect, vi, beforeEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { CampaignProvider } from './CampaignProvider'
import { useCampaign } from './useCampaign'

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

const CampaignConsumer = () => {
  const [campaign] = useCampaign()
  return <div data-testid="campaign">{campaign ? campaign.slug : 'null'}</div>
}

beforeEach(() => {
  mockUseOrganization.mockReset().mockReturnValue(undefined)
  mockUseTeamAccountsFlag.mockReset().mockReturnValue({
    ready: true,
    enabled: false,
    failed: false,
  })
})

describe('CampaignProvider', () => {
  // ENG-11072: gp-api's UseCampaignGuard fails closed on a volunteer
  // membership (403, not 404), so fetchCampaign's 404-only swallow would let
  // it throw and React Query would retry into repeated console 403s. The
  // query must never fire for a volunteer's active org.
  it('does not request GET /v1/campaigns/mine when the active org is volunteer and the flag is on', async () => {
    mockUseOrganization.mockReturnValue({ role: 'volunteer' })
    mockUseTeamAccountsFlag.mockReturnValue({
      ready: true,
      enabled: true,
      failed: false,
    })
    let requested = false
    api.mock('GET /v1/campaigns/mine', () => {
      requested = true
      return { status: 200, data: { slug: 'should-not-load' } as any }
    })

    render(
      <CampaignProvider campaign={null}>
        <CampaignConsumer />
      </CampaignProvider>,
    )

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="campaign"]'),
      ).toHaveTextContent('null'),
    )
    expect(requested).toBe(false)
  })

  it('still requests GET /v1/campaigns/mine for a volunteer-role org when the flag is off', async () => {
    mockUseOrganization.mockReturnValue({ role: 'volunteer' })
    mockUseTeamAccountsFlag.mockReturnValue({
      ready: true,
      enabled: false,
      failed: false,
    })
    api.mock('GET /v1/campaigns/mine', {
      status: 200,
      data: { slug: 'legacy-slug' } as any,
    })

    render(
      <CampaignProvider campaign={null}>
        <CampaignConsumer />
      </CampaignProvider>,
    )

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="campaign"]'),
      ).toHaveTextContent('legacy-slug'),
    )
  })

  it('requests GET /v1/campaigns/mine for a non-volunteer active org even with the flag on', async () => {
    mockUseOrganization.mockReturnValue({ role: 'owner' })
    mockUseTeamAccountsFlag.mockReturnValue({
      ready: true,
      enabled: true,
      failed: false,
    })
    api.mock('GET /v1/campaigns/mine', {
      status: 200,
      data: { slug: 'owner-slug' } as any,
    })

    render(
      <CampaignProvider campaign={null}>
        <CampaignConsumer />
      </CampaignProvider>,
    )

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="campaign"]'),
      ).toHaveTextContent('owner-slug'),
    )
  })
})
