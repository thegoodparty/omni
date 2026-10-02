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

const CampaignConsumer = () => {
  const [campaign] = useCampaign()
  return <div data-testid="campaign">{campaign ? campaign.slug : 'null'}</div>
}

beforeEach(() => {
  mockUseOrganization.mockReset().mockReturnValue(undefined)
})

describe('CampaignProvider', () => {
  // ENG-11072: gp-api's UseCampaignGuard fails closed on a volunteer
  // membership (403, not 404), so fetchCampaign's 404-only swallow would let
  // it throw and React Query would retry into repeated console 403s. The
  // query must never fire for a volunteer's active org.
  it('does not request GET /v1/campaigns/mine when the active org is volunteer', async () => {
    mockUseOrganization.mockReturnValue({ role: 'volunteer' })
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

  // enabled:false blocks the refetch but not the cache, so without the
  // short-circuit a volunteer would keep seeing the previous org's campaign
  // after an owner-org → volunteer-org switch.
  it('drops the cached campaign when the active org switches to a volunteer org', async () => {
    mockUseOrganization.mockReturnValue({ role: 'owner' })
    api.mock('GET /v1/campaigns/mine', {
      status: 200,
      data: { slug: 'owner-slug' } as any,
    })

    const { rerender } = render(
      <CampaignProvider campaign={null}>
        <CampaignConsumer />
      </CampaignProvider>,
    )
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="campaign"]'),
      ).toHaveTextContent('owner-slug'),
    )

    mockUseOrganization.mockReturnValue({ role: 'volunteer' })
    rerender(
      <CampaignProvider campaign={null}>
        <CampaignConsumer />
      </CampaignProvider>,
    )

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="campaign"]'),
      ).toHaveTextContent('null'),
    )
  })

  it('requests GET /v1/campaigns/mine for a non-volunteer active org', async () => {
    mockUseOrganization.mockReturnValue({ role: 'owner' })
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
