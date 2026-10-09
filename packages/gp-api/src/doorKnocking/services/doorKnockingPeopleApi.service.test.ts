import { describe, expect, it, vi } from 'vitest'
import { Bbox } from '@goodparty_org/contracts'
import { VoterDoorKnockingService } from '@/peopleDb/services/voterDoorKnocking.service'
import { VoterPackService } from '@/peopleDb/services/voterPack.service'
import { DoorKnockingPeopleApiService } from './doorKnockingPeopleApi.service'

const BBOX: Bbox = { minLat: 36.1, minLng: -86.8, maxLat: 36.2, maxLng: -86.7 }

const setup = () => {
  const evaluate = vi.fn().mockResolvedValue({ people: [] })
  const service = new DoorKnockingPeopleApiService(
    { evaluate } as unknown as VoterDoorKnockingService,
    {} as VoterPackService,
  )
  const lastDto = () => evaluate.mock.calls.at(-1)?.[0] as Record<string, never>
  const lastDataset = () => evaluate.mock.calls.at(-1)?.[1] as unknown
  return { service, lastDto, lastDataset }
}

const PERSON_ID = '11111111-2222-3333-4444-555555555555'

const args = {
  districtId: '99999999-8888-7777-6666-555555555555',
  dataset: 'voters' as const,
  bbox: BBOX,
  filters: {},
}

// The adapter's one non-mechanical decision. Asserting it here rather than
// through the knock route matters: a route-level spy intercepts the adapter's
// input, so it can only see the array the caller passed, never the DTO the
// adapter built from it.
describe('DoorKnockingPeopleApiService.evaluate', () => {
  it('omits excludePersonIds when the org has flagged nobody', async () => {
    const { service, lastDto } = setup()

    await service.evaluate({ ...args, excludePersonIds: [] })

    // Absent, not empty: `!= ALL('{}')` is always true, so sending the key
    // would change the query of every request from an org that has flagged
    // nobody for no behavioral gain.
    expect(lastDto()).not.toHaveProperty('excludePersonIds')
  })

  it('omits excludePersonIds when the caller passes none at all', async () => {
    const { service, lastDto } = setup()

    await service.evaluate(args)

    expect(lastDto()).not.toHaveProperty('excludePersonIds')
  })

  it('forwards the ids when somebody is flagged', async () => {
    const { service, lastDto } = setup()

    await service.evaluate({ ...args, excludePersonIds: [PERSON_ID] })

    expect(lastDto()).toMatchObject({ excludePersonIds: [PERSON_ID] })
  })
})

describe('DoorKnockingPeopleApiService dataset', () => {
  it('reads the people table the caller resolved for the org', async () => {
    const { service, lastDataset } = setup()

    await service.evaluate({ ...args, dataset: 'constituents' })

    expect(lastDataset()).toBe('constituents')
  })
})
