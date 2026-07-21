import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from 'src/generated/prisma'
import { DoorKnockingService } from './doorKnocking.service'

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

describe('DoorKnockingService', () => {
  let service: DoorKnockingService
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
    service = new DoorKnockingService(mockDistrictService as never)
    Object.defineProperty(service, '_prisma', {
      get: () => mockClient,
      configurable: true,
    })
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
        },
      ])
      expect(address?.otherResidents).toEqual([
        { personId: OTHER_ID, firstName: 'Marisol', lastName: 'Vega' },
      ])
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
