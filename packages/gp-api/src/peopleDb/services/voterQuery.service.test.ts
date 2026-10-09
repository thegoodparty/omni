import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VoterQueryService } from './voterQuery.service'

const DISTRICT_ID = '0e5bafca-93a9-86a5-2522-f373979720df'

describe('VoterQueryService', () => {
  let service: VoterQueryService
  let databricks: Record<string, ReturnType<typeof vi.fn>>
  let measure: ReturnType<typeof vi.fn>

  beforeEach(() => {
    databricks = {
      findPerson: vi.fn().mockResolvedValue({ id: 'person-1' }),
      findPrecincts: vi
        .fn()
        .mockResolvedValue({ options: [], truncated: false }),
      findPeople: vi.fn().mockResolvedValue({ people: [], totalCount: 0 }),
      getAggregates: vi.fn().mockResolvedValue({ count: 3 }),
      getListDetailAggregates: vi.fn().mockResolvedValue({ count: 3 }),
      getOverlapCount: vi.fn().mockResolvedValue({ count: 1 }),
      samplePeople: vi.fn().mockResolvedValue([]),
    }
    // measure() runs the real read, so each assertion below covers both the
    // delegation and the op/districtId the read is logged under.
    measure = vi.fn((args: { read: () => unknown }) => args.read())
    service = new VoterQueryService(databricks as never, { measure } as never)
  })

  it('reads a person by id under the voter-by-id op', async () => {
    const person = await service.findPerson(
      'lal-1',
      {
        districtId: DISTRICT_ID,
      } as never,
      'constituents',
    )

    expect(databricks.findPerson).toHaveBeenCalledWith(
      'lal-1',
      DISTRICT_ID,
      'constituents',
    )
    expect(measure).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'voter-by-id',
        districtId: DISTRICT_ID,
        dataset: 'constituents',
      }),
    )
    expect(person).toEqual({ id: 'person-1' })
  })

  it('reads the precinct options under the precincts op', async () => {
    const precincts = await service.findPrecincts(DISTRICT_ID, 'constituents')

    expect(databricks.findPrecincts).toHaveBeenCalledWith(
      DISTRICT_ID,
      'constituents',
    )
    expect(measure).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'precincts',
        districtId: DISTRICT_ID,
        dataset: 'constituents',
      }),
    )
    expect(precincts).toEqual({ options: [], truncated: false })
  })

  it('passes the list dto straight through under the list op', async () => {
    const dto = { districtId: DISTRICT_ID, page: 2, filters: {} }

    const people = await service.findPeople(dto as never, 'constituents')

    expect(databricks.findPeople).toHaveBeenCalledWith(dto, 'constituents')
    expect(measure).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'list',
        districtId: DISTRICT_ID,
        dataset: 'constituents',
      }),
    )
    expect(people).toEqual({ people: [], totalCount: 0 })
  })

  it('passes the aggregates dto through under the aggregates op', async () => {
    const dto = { districtId: DISTRICT_ID, filters: {} }

    const aggregates = await service.getAggregates(dto as never, 'constituents')

    expect(databricks.getAggregates).toHaveBeenCalledWith(dto, 'constituents')
    expect(measure).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'aggregates',
        districtId: DISTRICT_ID,
        dataset: 'constituents',
      }),
    )
    expect(aggregates).toEqual({ count: 3 })
  })

  it('reads the list-detail aggregates under their own op', async () => {
    const dto = { districtId: DISTRICT_ID, filters: {} }

    const aggregates = await service.getListDetailAggregates(
      dto as never,
      'constituents',
    )

    expect(databricks.getListDetailAggregates).toHaveBeenCalledWith(
      dto,
      'constituents',
    )
    expect(measure).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'list-detail-aggregates',
        districtId: DISTRICT_ID,
        dataset: 'constituents',
      }),
    )
    expect(aggregates).toEqual({ count: 3 })
  })

  it('passes the overlap dto through under the overlap op', async () => {
    const dto = { districtId: DISTRICT_ID, savedListIds: ['list-1'] }

    const overlap = await service.getOverlapCount(dto as never, 'constituents')

    expect(databricks.getOverlapCount).toHaveBeenCalledWith(dto, 'constituents')
    expect(measure).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'overlap',
        districtId: DISTRICT_ID,
        dataset: 'constituents',
      }),
    )
    expect(overlap).toEqual({ count: 1 })
  })

  it('passes the sample dto through under the sample op', async () => {
    const dto = { districtId: DISTRICT_ID, size: 25 }

    const sample = await service.samplePeople(dto as never, 'constituents')

    expect(databricks.samplePeople).toHaveBeenCalledWith(dto, 'constituents')
    expect(measure).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'sample',
        districtId: DISTRICT_ID,
        dataset: 'constituents',
      }),
    )
    expect(sample).toEqual([])
  })

  // Voter data has a single store, so there is nothing to fall back to: a
  // warehouse failure has to reach the caller rather than become an empty
  // answer that reads as a district with no voters in it.
  describe('warehouse failures', () => {
    const reads: [string, (svc: VoterQueryService) => Promise<unknown>][] = [
      [
        'findPerson',
        (svc) =>
          svc.findPerson(
            'lal-1',
            { districtId: DISTRICT_ID } as never,
            'constituents',
          ),
      ],
      [
        'findPrecincts',
        (svc) => svc.findPrecincts(DISTRICT_ID, 'constituents'),
      ],
      [
        'findPeople',
        (svc) =>
          svc.findPeople({ districtId: DISTRICT_ID } as never, 'constituents'),
      ],
      [
        'getAggregates',
        (svc) =>
          svc.getAggregates(
            { districtId: DISTRICT_ID } as never,
            'constituents',
          ),
      ],
      [
        'getListDetailAggregates',
        (svc) =>
          svc.getListDetailAggregates(
            { districtId: DISTRICT_ID } as never,
            'constituents',
          ),
      ],
      [
        'getOverlapCount',
        (svc) =>
          svc.getOverlapCount(
            { districtId: DISTRICT_ID } as never,
            'constituents',
          ),
      ],
      [
        'samplePeople',
        (svc) =>
          svc.samplePeople(
            { districtId: DISTRICT_ID } as never,
            'constituents',
          ),
      ],
    ]

    it.each(reads)('propagates a %s failure', async (method, invoke) => {
      databricks[method] = vi
        .fn()
        .mockRejectedValue(new Error('warehouse down'))

      await expect(invoke(service)).rejects.toThrow('warehouse down')
    })
  })
})
