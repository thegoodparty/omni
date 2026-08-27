import { BadRequestException, GatewayTimeoutException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '../../generated/people-prisma'
import { VoterDoorKnockingService } from './voterDoorKnocking.service'
import type { PeopleDbService } from '../peopleDb.service'

const sqlOf = (call: unknown): string => (call as { sql?: string })?.sql ?? ''

// Mirrors the real Prisma raw-query error for SQLSTATE 57014 (statement
// cancelled by statement_timeout).
const statementTimeoutError = () =>
  new Prisma.PrismaClientKnownRequestError(
    'Raw query failed. Code: `57014`. Message: `canceling statement due to statement timeout`',
    { code: 'P2010', clientVersion: 'test', meta: { code: '57014' } },
  )

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
  let mockClient: {
    $queryRaw: ReturnType<typeof vi.fn>
    $executeRaw: ReturnType<typeof vi.fn>
    $transaction: ReturnType<typeof vi.fn>
  }
  const mockDistrictService = {
    findDistrictById: vi.fn().mockResolvedValue({
      id: DISTRICT_ID,
      type: 'City',
      name: 'SPRINGFIELD',
      state: 'IL',
    }),
  }

  beforeEach(() => {
    mockClient = {
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn().mockResolvedValue(0),
      $transaction: vi
        .fn()
        .mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    }
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

    // ADR 0008. Do-not-knock and not-a-voter arrive through this one slot,
    // unioned by the caller — the query has no idea which reason produced
    // which id, and does not need one. Still a single conjunct, so the same
    // no-filters guarantee covers both.
    it('excludes the union of every suppression reason in one conjunct', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([])

      await service.evaluate({
        ...dto,
        excludePersonIds: [TARGET_ID, OTHER_ID],
      } as never)

      const sql = lastQuerySql()
      expect(sql.strings.join('?').match(/!= ALL\(/g)).toHaveLength(1)
      expect(sql.values).toContainEqual([TARGET_ID, OTHER_ID])
    })

    // Not cosmetic: `!= ALL('{}')` is always true, so emitting the clause
    // anyway would change the SQL of every request from an org that has
    // flagged nobody, for no behavioral gain.
    it('leaves the query untouched when nobody is flagged', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([])
      await service.evaluate(dto as never)
      const baseline = lastQuerySql().strings.join('?')

      mockClient = {
        $queryRaw: vi.fn().mockResolvedValueOnce([]),
        $executeRaw: vi.fn().mockResolvedValue(0),
        $transaction: vi
          .fn()
          .mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
      }
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
      // Raw column values, as the voter file spells them — the point of these
      // fixtures is that the service runs them through the display mappers
      // rather than passing the file's own vocabulary to a canvasser.
      registered: true,
      Voter_Status: 'Super',
      Marital_Status: 'Inferred Married',
      Presence_Of_Children: 'Y',
      Veteran_Status: 'Yes',
      Homeowner_Probability_Model: 'Probable Home Owner',
      Business_Owner: 'Y',
      Education_Of_Person: 'Completed Graduate School Likely',
      Estimated_Income_Amount_Int: 82000,
      Language_Code: 'Spanish',
      EthnicGroups_EthnicGroup1Desc: 'Hispanic and Portuguese',
    })

    // A person with nothing on file. This is the common case in the voter
    // file, not an edge — the exploration pack reserves a no-data bucket on
    // every one of these dimensions — so the null path is the one that has to
    // be right.
    const sparseRow = (id: string) => ({
      ...residentRow(id),
      Voter_Status: 'Unknown',
      Marital_Status: null,
      Presence_Of_Children: null,
      Veteran_Status: null,
      Homeowner_Probability_Model: null,
      Business_Owner: null,
      Education_Of_Person: null,
      Estimated_Income_Amount_Int: null,
      Language_Code: null,
      EthnicGroups_EthnicGroup1Desc: null,
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
          // The eleven attributes, each through the display mapper
          // /v1/contacts person detail already uses — so what reaches the door
          // is "Likely Married" and "Graduate Degree", never the file's
          // "Inferred Married" and "Completed Graduate School Likely".
          registeredVoter: true,
          turnoutLikelihood: 'Super',
          maritalStatus: 'Likely Married',
          hasChildrenUnder18: 'Yes',
          veteranStatus: 'Yes',
          homeowner: 'Homeowner',
          businessOwner: 'Yes',
          levelOfEducation: 'Graduate Degree',
          estimatedIncomeAmount: 82000,
          language: 'Spanish',
          ethnicityGroup: 'Hispanic',
        },
      ])
      // Household context stays name-only: a non-target resident is context for
      // the conversation, not someone the candidate asked to contact. `toEqual`
      // and not `toMatchObject`, so this fails if the demographic profile ever
      // widens to reach them.
      expect(address?.otherResidents).toEqual([
        { personId: OTHER_ID, firstName: 'Marisol', lastName: 'Vega' },
      ])
    })

    // The same row that produced a full profile for a target above produces
    // three keys for a non-target, which is the property worth asserting: the
    // columns were selected and then deliberately not handed over.
    it('withholds the demographic profile from a non-target resident', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([residentRow(OTHER_ID)])

      const result = await service.residents(dto as never)

      const [resident] = result.addresses[0]?.otherResidents ?? []
      expect(Object.keys(resident ?? {}).sort()).toEqual([
        'firstName',
        'lastName',
        'personId',
      ])
    })

    it('selects every demographic column', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([residentRow(TARGET_ID)])

      await service.residents(dto as never)

      const sql = lastQuerySql().strings.join('?')
      for (const column of [
        'StateVoterID',
        'Voter_Status',
        'Marital_Status',
        'Presence_Of_Children',
        'Veteran_Status',
        'Homeowner_Probability_Model',
        'Business_Owner',
        'Education_Of_Person',
        'Estimated_Income_Amount_Int',
        'Language_Code',
        'EthnicGroups_EthnicGroup1Desc',
      ]) {
        expect(sql).toContain(column)
      }
    })

    // Widening the projection must not touch the predicate, the cap or the
    // guard — this is the module's fragile query (peopleDb/AGENTS.md), and its
    // cost lives in the scan rather than in the column list.
    it('leaves the address-key predicate and the cap alone', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([])

      await service.residents(dto as never)

      const sql = lastQuerySql()
      expect(sql.strings.join('?')).toContain('= ANY(')
      expect(sql.strings.join('?')).toContain('GeoMatchRooftop')
      // targetPersonIds.length * 10, + 1 to detect the overflow.
      expect(sql.values).toContain(11)
    })

    // Sparseness is the normal condition of this file. Every attribute has to
    // reach the door as an explicit null so one renderer decision covers all
    // eleven, rather than some arriving absent and others as a sentinel.
    it('emits null for every attribute a sparse person has no data for', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([sparseRow(TARGET_ID)])

      const result = await service.residents(dto as never)

      expect(result.addresses[0]?.targets[0]).toMatchObject({
        // 'Unknown' is the file's own sentinel and is not a turnout band, so
        // it maps to null rather than being carried through as a value.
        turnoutLikelihood: null,
        maritalStatus: null,
        hasChildrenUnder18: null,
        veteranStatus: null,
        homeowner: null,
        businessOwner: null,
        levelOfEducation: null,
        estimatedIncomeAmount: null,
        ethnicityGroup: null,
      })
    })

    // `mapLanguage` returns 'Other' for an absent value, which is right for the
    // CSV and wrong at the door: it would tell a canvasser this person speaks
    // something other than English or Spanish on the strength of an empty
    // column. Same shape as the politicalParty rule directly above it.
    it('leaves language null when the column is empty, rather than Other', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([sparseRow(TARGET_ID)])

      const result = await service.residents(dto as never)

      expect(result.addresses[0]?.targets[0]?.language).toBeNull()
    })

    it('still maps a present but unrecognized language to Other', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([
        { ...residentRow(TARGET_ID), Language_Code: 'Portuguese' },
      ])

      const result = await service.residents(dto as never)

      expect(result.addresses[0]?.targets[0]?.language).toBe('Other')
    })

    // Presence-only columns: a value meaning yes, or nothing at all. There is
    // no 'No' to emit, and the contract's z.enum(['Yes']) is what enforces it —
    // absence is indistinguishable from unknown, so claiming "No" would state
    // a fact the data does not support.
    it.each([
      ['veteranStatus', 'Veteran_Status'],
      ['businessOwner', 'Business_Owner'],
    ] as const)(
      'emits null rather than No for an absent %s',
      async (field, column) => {
        mockClient.$queryRaw.mockResolvedValueOnce([
          { ...residentRow(TARGET_ID), [column]: null },
        ])

        const result = await service.residents(dto as never)

        expect(result.addresses[0]?.targets[0]?.[field]).toBeNull()
      },
    )

    // The pack's own definition of the word (voterPack.service.ts): a person
    // with no state voter id is not registered in this file. Unlike the Person
    // contract's `registeredVoter`, which is hardcoded 'Yes' and reads no
    // column at all.
    it('derives registeredVoter from the presence of a state voter id', async () => {
      mockClient.$queryRaw.mockResolvedValueOnce([
        { ...residentRow(TARGET_ID), registered: false },
      ])

      const result = await service.residents(dto as never)

      expect(result.addresses[0]?.targets[0]?.registeredVoter).toBe(false)
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

    // A route freezes its keys once, so it holds the format that was current
    // when it was knocked. Lists knocked before the key moved to the file's
    // AddressLine are still being walked, and they have to keep resolving —
    // missing them all would read at the door as everyone having moved away.
    describe('routes frozen under the legacy component key', () => {
      const LEGACY_KEY = '1200|W|ELM|ST||3B|62704'
      const legacyDto = {
        districtId: DISTRICT_ID,
        addressKeys: [LEGACY_KEY],
        targetPersonIds: [TARGET_ID],
      }

      it('matches them on the component key they were built from', async () => {
        mockClient.$queryRaw.mockResolvedValueOnce([])

        await service.residents(legacyDto as never)

        // HouseNumber tells the two expressions apart. The direction columns
        // no longer can: the legacy builder pins those two segments empty.
        const sql = lastQuerySql()
        expect(sql.strings.join('?')).toContain('HouseNumber')
        expect(sql.values).toContainEqual([LEGACY_KEY])
      })

      // Callers look their own stored keys up in the result. Returning the
      // current-format key for a legacy request would miss every address.
      it('hands the key back in the format the caller asked with', async () => {
        mockClient.$queryRaw.mockResolvedValueOnce([
          residentRow(TARGET_ID, LEGACY_KEY),
        ])

        const result = await service.residents(legacyDto as never)

        expect(result.addresses[0]?.addressKey).toBe(LEGACY_KEY)
      })

      // The predicate here is computed and non-sargable (peopleDb/AGENTS.md),
      // so compiling both key expressions for every request would put a second
      // seven-column CONCAT_WS on the module's most fragile scan. A request
      // carries one format, and only that format's expression is built.
      it('compiles one key expression, not both', async () => {
        mockClient.$queryRaw.mockResolvedValueOnce([])
        await service.residents(dto as never)

        expect(lastQuerySql().strings.join('?')).not.toContain('HouseNumber')
      })
    })
  })

  // Without the statement timeout these queries are bounded only by the
  // connection's socket_timeout (60s), which abandons the connection while
  // the query keeps running on people-db. Prod 2026-08-20: residents() ran
  // 60,209ms and 500'd while every guarded path failed cleanly at ~25,013ms.
  describe('statement timeout', () => {
    const evaluateDto = {
      districtId: DISTRICT_ID,
      bbox: { minLat: 41.8, maxLat: 41.9, minLng: -87.7, maxLng: -87.6 },
      filters: { filters: [], filterValues: {}, filterOperators: {} },
      maxPeople: 3,
    }
    const residentsDto = {
      districtId: DISTRICT_ID,
      addressKeys: [ADDRESS_KEY],
      targetPersonIds: [TARGET_ID],
    }

    it.each([
      ['evaluate', evaluateDto],
      ['residents', residentsDto],
    ])('runs %s under the 25s statement timeout', async (method, dto) => {
      mockClient.$queryRaw.mockResolvedValueOnce([])

      await service[method as 'evaluate' | 'residents'](dto as never)

      expect(mockClient.$transaction).toHaveBeenCalledTimes(1)
      expect(sqlOf(mockClient.$executeRaw.mock.calls[0]?.[0])).toBe(
        "SET LOCAL statement_timeout = '25000ms'",
      )

      // Order is the invariant, not just membership: Prisma serializes a batch
      // transaction's array on one connection, so a SET LOCAL placed after the
      // data query would apply to nothing. Compare operation identity rather
      // than array length, which a swap would still satisfy.
      const txOps = mockClient.$transaction.mock.calls[0]?.[0] as unknown[]
      expect(txOps).toHaveLength(2)
      expect(txOps[0]).toBe(mockClient.$executeRaw.mock.results[0]?.value)
      expect(txOps[1]).toBe(mockClient.$queryRaw.mock.results[0]?.value)
    })

    it.each([
      ['evaluate', evaluateDto],
      ['residents', residentsDto],
    ])('maps a %s statement timeout to a 504', async (method, dto) => {
      mockClient.$transaction.mockRejectedValueOnce(statementTimeoutError())

      await expect(
        service[method as 'evaluate' | 'residents'](dto as never),
      ).rejects.toThrow(GatewayTimeoutException)
    })

    it('lets a non-timeout database error surface unchanged', async () => {
      mockClient.$transaction.mockRejectedValueOnce(
        new Error('connection lost'),
      )

      await expect(service.residents(residentsDto as never)).rejects.toThrow(
        'connection lost',
      )
    })
  })
})
