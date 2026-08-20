import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  AUTO_VOTER_FILTER_NAME_PATTERN,
  handleCreateOutreach,
  handleCreateVoterFileFilter,
  mapAudienceForPersistence,
} from './flowHandlers.util'

const mockCreateOutreach = vi.fn()
const mockCreateVoterFileFilter = vi.fn()

vi.mock('helpers/createOutreach', () => ({
  createOutreach: (...args: unknown[]) => mockCreateOutreach(...args),
}))

vi.mock('helpers/createVoterFileFilter', () => ({
  createVoterFileFilter: (...args: unknown[]) =>
    mockCreateVoterFileFilter(...args),
}))

describe('handleCreateOutreach - campaignPlanDueDate', () => {
  beforeEach(() => {
    mockCreateOutreach.mockReset().mockResolvedValue({ id: 1 })
  })

  it('forwards the campaign plan due date to the create payload', async () => {
    await handleCreateOutreach({
      type: 'text',
      state: { schedule: { message: 'hi' } },
      campaignId: 42,
      campaignPlanDueDate: '2026-07-01',
    })()

    expect(mockCreateOutreach).toHaveBeenCalledTimes(1)
    const payload = mockCreateOutreach.mock.calls[0]?.[0]
    expect(payload).toEqual(
      expect.objectContaining({ campaignPlanDueDate: '2026-07-01' }),
    )
  })

  it('omits campaignPlanDueDate from the payload when not provided', async () => {
    await handleCreateOutreach({
      type: 'text',
      state: { schedule: { message: 'hi' } },
      campaignId: 42,
    })()

    const payload = mockCreateOutreach.mock.calls[0]?.[0]
    expect(payload).not.toHaveProperty('campaignPlanDueDate')
  })
})

describe('handleCreateOutreach - text counts', () => {
  beforeEach(() => {
    mockCreateOutreach.mockReset().mockResolvedValue({ id: 1 })
  })

  it('forwards textCount and computes billable from the free-texts offer', async () => {
    await handleCreateOutreach({
      type: 'text',
      state: { schedule: {} },
      campaignId: 42,
      textCount: 5200,
      hasFreeTextsOffer: true,
    })()

    const payload = mockCreateOutreach.mock.calls[0]?.[0]
    expect(payload).toEqual(
      expect.objectContaining({ textCount: 5200, billableTextCount: 200 }),
    )
  })

  it('clamps billable to zero when total is under the free-texts threshold', async () => {
    await handleCreateOutreach({
      type: 'text',
      state: { schedule: {} },
      campaignId: 42,
      textCount: 3000,
      hasFreeTextsOffer: true,
    })()

    const payload = mockCreateOutreach.mock.calls[0]?.[0]
    expect(payload).toEqual(
      expect.objectContaining({ textCount: 3000, billableTextCount: 0 }),
    )
  })

  it('bills the full count when there is no free-texts offer', async () => {
    await handleCreateOutreach({
      type: 'text',
      state: { schedule: {} },
      campaignId: 42,
      textCount: 300,
      hasFreeTextsOffer: false,
    })()

    const payload = mockCreateOutreach.mock.calls[0]?.[0]
    expect(payload).toEqual(
      expect.objectContaining({ textCount: 300, billableTextCount: 300 }),
    )
  })

  it('omits text counts when textCount is not provided', async () => {
    await handleCreateOutreach({
      type: 'text',
      state: { schedule: {} },
      campaignId: 42,
    })()

    const payload = mockCreateOutreach.mock.calls[0]?.[0]
    expect(payload).not.toHaveProperty('textCount')
    expect(payload).not.toHaveProperty('billableTextCount')
  })
})

// ENG-10764: robocall's audience step reuses the same generic voterFileFilter
// wiring text already has — verifying rather than reimplementing.
describe('handleCreateOutreach - robocall saved-list voterFileFilterId', () => {
  beforeEach(() => {
    mockCreateOutreach.mockReset().mockResolvedValue({ id: 1 })
  })

  it('forwards voterFileFilterId when a saved list was selected', async () => {
    await handleCreateOutreach({
      type: 'robocall',
      state: { schedule: {}, voterFileFilter: { id: 42 } },
      campaignId: 42,
    })()

    const payload = mockCreateOutreach.mock.calls[0]?.[0]
    expect(payload).toEqual(expect.objectContaining({ voterFileFilterId: 42 }))
  })

  it('omits voterFileFilterId when building a new audience from checkboxes', async () => {
    await handleCreateOutreach({
      type: 'robocall',
      state: { schedule: {}, voterFileFilter: {} },
      campaignId: 42,
    })()

    const payload = mockCreateOutreach.mock.calls[0]?.[0]
    expect(payload).not.toHaveProperty('voterFileFilterId')
  })
})

describe('mapAudienceForPersistence', () => {
  it('translates underscore audience keys to their camelCase equivalents', () => {
    expect(
      mapAudienceForPersistence({
        audience_superVoters: true,
        party_democrat: true,
        age_50_plus: true,
        gender_female: true,
      }),
    ).toEqual({
      audienceSuperVoters: true,
      partyDemocrat: true,
      age50Plus: true,
      genderFemale: true,
    })
  })

  it('keeps only selected (truthy) audiences and drops the rest', () => {
    expect(
      mapAudienceForPersistence({
        audience_superVoters: true,
        audience_likelyVoters: false,
        party_republican: true,
        party_independent: false,
        age_18_25: false,
      }),
    ).toEqual({
      audienceSuperVoters: true,
      partyRepublican: true,
    })
  })

  it('ignores the free-text audience_request field', () => {
    expect(
      mapAudienceForPersistence({
        audience_request: 'veterans in my district',
        audience_superVoters: true,
      }),
    ).toEqual({ audienceSuperVoters: true })
  })

  it('returns an empty object when no audience is provided', () => {
    expect(mapAudienceForPersistence()).toEqual({})
    expect(mapAudienceForPersistence({})).toEqual({})
  })
})

describe('handleCreateVoterFileFilter - identifiable name', () => {
  beforeEach(() => {
    mockCreateVoterFileFilter.mockReset().mockResolvedValue({ id: 1 })
  })

  it('names the auto-created list with the channel and send date', async () => {
    await handleCreateVoterFileFilter({
      type: 'text',
      state: { audience: {}, voterCount: 100 },
      now: new Date(2026, 5, 24),
    })()

    const payload = mockCreateVoterFileFilter.mock.calls[0]?.[0]
    expect(payload.name).toBe('Texting outreach — Jun 24, 2026')
  })

  it('produces a name the saved-list selector still recognizes as throwaway', async () => {
    await handleCreateVoterFileFilter({
      type: 'text',
      state: { audience: {}, voterCount: 100 },
      now: new Date(2026, 5, 24),
    })()

    const payload = mockCreateVoterFileFilter.mock.calls[0]?.[0]
    expect(AUTO_VOTER_FILTER_NAME_PATTERN.test(payload.name)).toBe(true)
  })
})
