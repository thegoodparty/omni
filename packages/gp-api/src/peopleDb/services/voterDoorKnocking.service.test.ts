import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '../../generated/people-prisma'
import { VoterDoorKnockingService } from './voterDoorKnocking.service'
import type { PeopleDbService } from '../peopleDb.service'

const DISTRICT_ID = '457a1cd7-4184-f823-49d3-f207af693521'
const TARGET_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_ID = '22222222-2222-2222-2222-222222222222'
const ADDRESS_KEY = '1200 W ELM ST|SPRINGFIELD|IL|62704'

const evaluateRow = (id: string) => ({
  id,
  firstName: 'Marisol',
  lastName: 'Vega',
  lat: 41.8781,
  lng: -87.6298,
  addressKey: ADDRESS_KEY,
  displayAddress: '1200 W Elm St',
})

describe('VoterDoorKnockingService', () => {
  let service: VoterDoorKnockingService
  let mockClient: { $queryRaw: ReturnType<typeof vi.fn> }
  const mockDistrictService = {
    findDistrictById: vi.fn().mockResolvedValue({
      id: DISTRICT_ID,
      type: 'City',
      name: 'SPRINGFIELD',
      state: 'IL',
    }),
  }

  beforeEach(() => {
    mockClient = { $queryRaw: vi.fn() }
    service = new VoterDoorKnockingService(mockDistrictService as never)
    ;(service as unknown as { _peopleDb: PeopleDbService })._peopleDb = {
      get instance() {
        return mockClient
      },
    } as unknown as PeopleDbService
  })

  const lastQuerySql = (): Prisma.Sql =>
    mockClient.$queryRaw.mock.calls[0]?.[0] as Prisma.Sql

  describe('evaluate', () => {
    const dto = {
      districtId: DISTRICT_ID,
      bbox: { minLat: 41.8, maxLat: 41.9, minLng: -87.7, maxLng: -87.6 },
      filters: { filters: [], filterValues: {}, filterOperators: {} },
      maxPeople: 3,
    }

    it('returns the roster and scopes the query', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([
        evaluateRow(TARGET_ID),
        evaluateRow(OTHER_ID),
      ])

      const result = await service.evaluate(dto as never)

      expect(result.people).toHaveLength(2)
      expect(result.people[0]).toMatchObject({
        id: TARGET_ID,
        addressKey: ADDRESS_KEY,
        lat: 41.8781,
      })

      const sqlStr = lastQuerySql().strings.join('?')
      expect(sqlStr).toContain('GeoMatchRooftop')
      expect(sqlStr).toContain('JOIN')
      expect(sqlStr).toContain('BETWEEN')
      expect(lastQuerySql().values.flat()).toContain(DISTRICT_ID)
    })

    it('fetches maxPeople + 1 rows to detect overflow', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([])

      await service.evaluate(dto as never)

      expect(lastQuerySql().values).toContain(4)
    })

    it('drops the DistrictVoter join for statewide districts', async () => {
      mockDistrictService.findDistrictById.mockResolvedValueOnce({
        id: DISTRICT_ID,
        type: 'State',
        name: 'IL',
        state: 'IL',
      })
      mockClient.$queryRaw.mockResolvedValueOnce([])

      await service.evaluate(dto as never)

      const sqlStr = lastQuerySql().strings.join('?')
      expect(sqlStr).not.toContain('JOIN')
      expect(lastQuerySql().values.flat()).not.toContain(DISTRICT_ID)
    })

    // ADR 0007. The one property that matters: an unconditional conjunct, not
    // an override hung off some other filter's clause. This dto carries no
    // filters at all, which is exactly the case where the idOverrides slot
    // would have dropped the exclusion on the floor.
    it('excludes do-not-knock ids unconditionally, with no filters present', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([])

      await service.evaluate({
        ...dto,
        excludePersonIds: [OTHER_ID],
      } as never)

      const sql = lastQuerySql()
      expect(sql.strings.join('?')).toContain('!= ALL(')
      expect(sql.values.flat()).toContain(OTHER_ID)
    })

    // Not cosmetic: `!= ALL('{}')` is always true, so emitting the clause
    // anyway would change the SQL of every request from an org that has
    // flagged nobody, for no behavioral gain.
    it('leaves the query untouched when nobody is flagged', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([])
      await service.evaluate(dto as never)
      const baseline = lastQuerySql().strings.join('?')

      mockClient = { $queryRaw: vi.fn().mockResolvedValueOnce([]) }
      ;(service as unknown as { _peopleDb: PeopleDbService })._peopleDb = {
        get instance() {
          return mockClient
        },
      } as unknown as PeopleDbService
      await service.evaluate({ ...dto, excludePersonIds: [] } as never)

      expect(lastQuerySql().strings.join('?')).toBe(baseline)
    })

    it('rejects instead of truncating when the cap is exceeded', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([
        evaluateRow(TARGET_ID),
        evaluateRow(OTHER_ID),
        evaluateRow('33333333-3333-3333-3333-333333333333'),
        evaluateRow('44444444-4444-4444-4444-444444444444'),
      ])

      await expect(service.evaluate(dto as never)).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  describe('residents', () => {
    const dto = {
      districtId: DISTRICT_ID,
      addressKeys: [ADDRESS_KEY],
      targetPersonIds: [TARGET_ID],
    }

    const residentRow = (id: string, addressKey = ADDRESS_KEY) => ({
      id,
      firstName: 'Marisol',
      lastName: 'Vega',
      Age: '47',
      Age_Int: 47,
      Parties_Description: 'Non-Partisan',
      cellPhone: '(615) 555-0142',
      landline: null,
      addressKey,
    })

    it('partitions live residents into targets and otherResidents', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([
        residentRow(TARGET_ID),
        residentRow(OTHER_ID),
      ])

      const result = await service.residents(dto as never)

      expect(result.addresses).toHaveLength(1)
      const [address] = result.addresses
      expect(address?.targets).toEqual([
        {
          personId: TARGET_ID,
          firstName: 'Marisol',
          lastName: 'Vega',
          age: 47,
          politicalParty: 'Independent',
          cellPhone: '(615) 555-0142',
          landline: null,
        },
      ])
      // Household context stays name-only: a non-target resident is context for
      // the conversation, not someone the candidate asked to contact.
      expect(address?.otherResidents).toEqual([
        { personId: OTHER_ID, firstName: 'Marisol', lastName: 'Vega' },
      ])
    })

    // The voter file is inconsistent about blank vs NULL, and an empty string
    // would render as an empty phone row at the door.
    it('normalizes a blank phone column to null', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([
        { ...residentRow(TARGET_ID), cellPhone: '', landline: '   ' },
      ])

      const result = await service.residents(dto as never)

      expect(result.addresses[0]?.targets[0]?.cellPhone).toBeNull()
      expect(result.addresses[0]?.targets[0]?.landline).toBeNull()
    })

    it('selects both phone columns', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([residentRow(TARGET_ID)])

      await service.residents(dto as never)

      const sql = mockClient.$queryRaw.mock.calls[0]?.[0]?.strings?.join(' ')
      expect(sql).toContain('VoterTelephones_CellPhoneFormatted')
      expect(sql).toContain('VoterTelephones_LandlineFormatted')
    })

    it('emits null party for a target with no party data, not Other', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([
        { ...residentRow(TARGET_ID), Parties_Description: null },
      ])

      const result = await service.residents(dto as never)

      expect(result.addresses[0]?.targets[0]?.politicalParty).toBeNull()
    })

    it('omits requested addressKeys that have no current residents', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([])

      const result = await service.residents(dto as never)

      expect(result.addresses).toEqual([])
    })

    it('binds the addressKeys as one text[] parameter', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([])

      await service.residents(dto as never)

      const sqlStr = lastQuerySql().strings.join('?')
      expect(sqlStr).toContain('= ANY(')
      expect(sqlStr).toContain('::text[]')
      expect(lastQuerySql().values).toContainEqual([ADDRESS_KEY])
    })

    it('rejects when the live population exceeds the residents cap', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce(
        Array.from({ length: 11 }, (_, i) =>
          residentRow(
            `${String(i).padStart(8, '0')}-2222-2222-2222-222222222222`,
          ),
        ),
      )

      await expect(service.residents(dto as never)).rejects.toThrow(
        BadRequestException,
      )
    })

    it('groups residents at a moved-away target address as otherResidents', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([residentRow(OTHER_ID)])

      const result = await service.residents(dto as never)

      const [address] = result.addresses
      expect(address?.targets).toEqual([])
      expect(address?.otherResidents).toHaveLength(1)
    })
  })
})
