import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Organization } from '@/generated/prisma'
import {
  INDEPENDENT_MODEL_FLAG_KEY,
  IndependentAffinityColumnService,
} from './independentAffinityColumn.service'

const org = { slug: 'campaign-test' } as Organization
const campaign = {
  id: 7,
  userId: 42,
  details: { raceId: 'race-hash', party: 'Independent' },
}

describe('IndependentAffinityColumnService.resolve', () => {
  let assignments: { getOrAssign: ReturnType<typeof vi.fn> }
  let campaigns: { findFirst: ReturnType<typeof vi.fn> }
  let elections: { fetchCampaignStrategyContext: ReturnType<typeof vi.fn> }
  let service: IndependentAffinityColumnService

  beforeEach(() => {
    assignments = { getOrAssign: vi.fn() }
    campaigns = { findFirst: vi.fn().mockResolvedValue(campaign) }
    elections = { fetchCampaignStrategyContext: vi.fn() }
    service = new IndependentAffinityColumnService(
      assignments as never,
      campaigns as never,
      elections as never,
    )
  })

  it('reads the pre-experiment column for an org with no campaign', async () => {
    campaigns.findFirst.mockResolvedValue(null)
    await expect(service.resolve(org)).resolves.toBe(
      'Voter_Independent_Affinity',
    )
    expect(assignments.getOrAssign).not.toHaveBeenCalled()
  })

  it('reads the pre-experiment column when the campaign has no arm', async () => {
    assignments.getOrAssign.mockResolvedValue(null)
    await expect(service.resolve(org)).resolves.toBe(
      'Voter_Independent_Affinity',
    )
    expect(assignments.getOrAssign).toHaveBeenCalledWith(
      expect.objectContaining({ flagKey: INDEPENDENT_MODEL_FLAG_KEY }),
    )
  })

  it('maps the control and haystaq arms to their columns', async () => {
    assignments.getOrAssign.mockResolvedValue('control')
    await expect(service.resolve(org)).resolves.toBe(
      'Indep_Openness_Registration',
    )
    assignments.getOrAssign.mockResolvedValue('haystaq')
    await expect(service.resolve(org)).resolves.toBe('Indep_Openness_Haystaq')
  })

  it("maps the stateleg arm to the race's scenario column, once per window", async () => {
    assignments.getOrAssign.mockResolvedValue('stateleg')
    elections.fetchCampaignStrategyContext.mockResolvedValue({
      candidates: [
        {
          full_name: 'A D',
          party: 'Democratic',
          is_incumbent: true,
          email: null,
        },
      ],
      number_of_seats: 1,
      partisan_type: 'partisan',
    })
    await expect(service.resolve(org)).resolves.toBe('Indep_Openness_DOnly_Inc')
    await expect(service.resolve(org)).resolves.toBe('Indep_Openness_DOnly_Inc')
    expect(elections.fetchCampaignStrategyContext).toHaveBeenCalledTimes(1)
    expect(elections.fetchCampaignStrategyContext).toHaveBeenCalledWith(
      'race-hash',
    )
  })
})
