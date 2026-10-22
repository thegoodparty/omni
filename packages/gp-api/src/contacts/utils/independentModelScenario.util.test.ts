import { describe, expect, it } from 'vitest'
import type { CampaignStrategyContextCandidate } from '@/elections/types/elections.types'
import { stateLegAffinityColumn } from './independentModelScenario.util'

const candidate = (
  fullName: string,
  party: string | null,
  isIncumbent = false,
  email: string | null = null,
): CampaignStrategyContextCandidate => ({
  gp_candidate_id: null,
  first_name: fullName.split(' ')[0] ?? '',
  last_name: fullName.split(' ')[1] ?? '',
  full_name: fullName,
  email,
  website_url: null,
  party,
  is_incumbent: isIncumbent,
})

const race = (
  candidates: CampaignStrategyContextCandidate[],
  overrides: {
    numberOfSeats?: number | null
    partisanType?: string | null
    gpCandidateParty?: string | null
  } = {},
) =>
  stateLegAffinityColumn({
    candidates,
    numberOfSeats: overrides.numberOfSeats ?? 1,
    partisanType: overrides.partisanType ?? 'partisan',
    gpCandidateParty: overrides.gpCandidateParty ?? 'Independent',
  })

describe('stateLegAffinityColumn', () => {
  it('reads the full field when both major parties run', () => {
    expect(
      race([
        candidate('A D', 'Democratic', true),
        candidate('B R', 'Republican'),
      ]),
    ).toBe('Indep_Openness_Single_Inc')
  })

  it('reads the open-seat column when no major-party incumbent runs', () => {
    expect(
      race([candidate('A D', 'Democratic'), candidate('B R', 'Republican')]),
    ).toBe('Indep_Openness_Single_Open')
  })

  it('reads the lone-party columns for a one-party single-seat field', () => {
    expect(race([candidate('A D', 'Democratic', true)])).toBe(
      'Indep_Openness_DOnly_Inc',
    )
    expect(race([candidate('B R', 'Republican')])).toBe(
      'Indep_Openness_ROnly_Open',
    )
  })

  it('counts the Democratic-Farmer-Labor party as Democrats', () => {
    expect(race([candidate('A D', 'Democratic-Farmer-Labor')])).toBe(
      'Indep_Openness_DOnly_Open',
    )
  })

  it('reads the lone-party multi-seat column whatever the incumbency', () => {
    const field = [
      candidate('A D', 'Democratic'),
      candidate('C D', 'Democratic'),
    ]
    expect(race(field, { numberOfSeats: 2 })).toBe('Indep_Openness_DOnly_Multi')
    expect(
      race([candidate('B R', 'Republican', true)], { numberOfSeats: 3 }),
    ).toBe('Indep_Openness_ROnly_Multi')
  })

  it('reads the multi-seat full field for a mixed multi-seat race', () => {
    expect(
      race([candidate('A D', 'Democratic'), candidate('B R', 'Republican')], {
        numberOfSeats: 4,
      }),
    ).toBe('Indep_Openness_Multi_Open')
  })

  it('treats a nonpartisan race as the full field and counts any incumbent', () => {
    expect(
      race([candidate('A D', 'Democratic'), candidate('N P', null, true)], {
        partisanType: 'nonpartisan',
      }),
    ).toBe('Indep_Openness_Single_Inc')
  })

  it('does not count an independent incumbent as defending', () => {
    expect(
      race([
        candidate('A D', 'Democratic'),
        candidate('B R', 'Republican'),
        candidate('I I', 'Independent', true),
      ]),
    ).toBe('Indep_Openness_Single_Open')
  })

  it("removes the GP candidate from their own party's count", () => {
    expect(
      race(
        [candidate('Gp Dem', 'Democratic'), candidate('B R', 'Republican')],
        {
          gpCandidateParty: 'Democratic',
        },
      ),
    ).toBe('Indep_Openness_ROnly_Open')
  })

  it('reads a person listed twice as an incumbent if any row says so', () => {
    expect(
      race([
        candidate('A D', 'Democratic', false),
        candidate('A D', 'Democratic', true),
        candidate('B R', 'Republican'),
      ]),
    ).toBe('Indep_Openness_Single_Inc')
  })

  it('ignores internal test candidates', () => {
    expect(
      race([
        candidate('A D', 'Democratic'),
        candidate('Test R', 'Republican', true, 'qa@goodparty.org'),
      ]),
    ).toBe('Indep_Openness_DOnly_Open')
  })

  it('falls back to the incumbent full field when no candidates are known', () => {
    expect(race([])).toBe('Indep_Openness_Single_Inc')
    expect(race([], { numberOfSeats: 2 })).toBe('Indep_Openness_Multi_Inc')
  })
})
