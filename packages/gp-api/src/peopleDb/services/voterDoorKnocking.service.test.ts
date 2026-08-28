import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VoterDoorKnockingService } from './voterDoorKnocking.service'
import type {
  DbxEvaluateRow,
  DbxResidentRow,
} from '../databricks/databricksVoterSql.util'

const DISTRICT_ID = '457a1cd7-4184-f823-49d3-f207af693521'
const TARGET_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_ID = '22222222-2222-2222-2222-222222222222'
const ADDRESS_KEY = '1200 W ELM ST|SPRINGFIELD|IL|62704'

const evaluateRow = (id: string): DbxEvaluateRow => ({
  id,
  firstName: 'Marisol',
  lastName: 'Vega',
  lat: 41.8781,
  lng: -87.6298,
  addressKey: ADDRESS_KEY,
  displayAddress: '1200 W Elm St',
})

const residentRow = (id: string, addressKey = ADDRESS_KEY): DbxResidentRow => ({
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

// A person with nothing on file. This is the common case in the voter file,
// not an edge — the exploration pack reserves a no-data bucket on every one of
// these dimensions — so the null path is the one that has to be right.
const sparseRow = (id: string): DbxResidentRow => ({
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

type MeasureArgs = {
  op: string
  districtId: string
  read: () => Promise<DbxEvaluateRow[] | DbxResidentRow[]>
}

describe('VoterDoorKnockingService', () => {
  let service: VoterDoorKnockingService
  let databricks: {
    doorKnockingEvaluateRows: ReturnType<typeof vi.fn>
    doorKnockingResidentRows: ReturnType<typeof vi.fn>
  }
  let readLog: { measure: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    databricks = {
      doorKnockingEvaluateRows: vi.fn().mockResolvedValue([]),
      doorKnockingResidentRows: vi.fn().mockResolvedValue([]),
    }
    readLog = { measure: vi.fn((args: MeasureArgs) => args.read()) }
    service = new VoterDoorKnockingService(
      databricks as never,
      readLog as never,
    )
  })

  describe('evaluate', () => {
    const dto = {
      districtId: DISTRICT_ID,
      bbox: { minLat: 41.8, maxLat: 41.9, minLng: -87.7, maxLng: -87.6 },
      filters: { filters: [], filterValues: {}, filterOperators: {} },
      maxPeople: 3,
    }

    it('returns the roster the warehouse handed back', async () => {
      databricks.doorKnockingEvaluateRows.mockResolvedValueOnce([
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
    })

    it('measures the read as dk-evaluate for the district', async () => {
      await service.evaluate(dto as never)

      expect(readLog.measure).toHaveBeenCalledTimes(1)
      expect(readLog.measure.mock.calls[0]?.[0]).toMatchObject({
        op: 'dk-evaluate',
        districtId: DISTRICT_ID,
      })
      expect(databricks.doorKnockingEvaluateRows).toHaveBeenCalledWith(dto)
    })

    it('rejects instead of truncating when the cap is exceeded', async () => {
      databricks.doorKnockingEvaluateRows.mockResolvedValueOnce([
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

    it('measures the read as dk-residents and caps at ten per target', async () => {
      await service.residents(dto as never)

      expect(readLog.measure).toHaveBeenCalledTimes(1)
      expect(readLog.measure.mock.calls[0]?.[0]).toMatchObject({
        op: 'dk-residents',
        districtId: DISTRICT_ID,
      })
      expect(databricks.doorKnockingResidentRows).toHaveBeenCalledWith(dto, 10)
    })

    it('partitions live residents into targets and otherResidents', async () => {
      databricks.doorKnockingResidentRows.mockResolvedValueOnce([
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
      databricks.doorKnockingResidentRows.mockResolvedValueOnce([
        residentRow(OTHER_ID),
      ])

      const result = await service.residents(dto as never)

      const [resident] = result.addresses[0]?.otherResidents ?? []
      expect(Object.keys(resident ?? {}).sort()).toEqual([
        'firstName',
        'lastName',
        'personId',
      ])
    })

    // Sparseness is the normal condition of this file. Every attribute has to
    // reach the door as an explicit null so one renderer decision covers all
    // eleven, rather than some arriving absent and others as a sentinel.
    it('emits null for every attribute a sparse person has no data for', async () => {
      databricks.doorKnockingResidentRows.mockResolvedValueOnce([
        sparseRow(TARGET_ID),
      ])

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
      databricks.doorKnockingResidentRows.mockResolvedValueOnce([
        sparseRow(TARGET_ID),
      ])

      const result = await service.residents(dto as never)

      expect(result.addresses[0]?.targets[0]?.language).toBeNull()
    })

    it('still maps a present but unrecognized language to Other', async () => {
      databricks.doorKnockingResidentRows.mockResolvedValueOnce([
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
        databricks.doorKnockingResidentRows.mockResolvedValueOnce([
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
      databricks.doorKnockingResidentRows.mockResolvedValueOnce([
        { ...residentRow(TARGET_ID), registered: false },
      ])

      const result = await service.residents(dto as never)

      expect(result.addresses[0]?.targets[0]?.registeredVoter).toBe(false)
    })

    // The voter file is inconsistent about blank vs NULL, and an empty string
    // would render as an empty phone row at the door.
    it('normalizes a blank phone column to null', async () => {
      databricks.doorKnockingResidentRows.mockResolvedValueOnce([
        { ...residentRow(TARGET_ID), cellPhone: '', landline: '   ' },
      ])

      const result = await service.residents(dto as never)

      expect(result.addresses[0]?.targets[0]?.cellPhone).toBeNull()
      expect(result.addresses[0]?.targets[0]?.landline).toBeNull()
    })

    it('emits null party for a target with no party data, not Other', async () => {
      databricks.doorKnockingResidentRows.mockResolvedValueOnce([
        { ...residentRow(TARGET_ID), Parties_Description: null },
      ])

      const result = await service.residents(dto as never)

      expect(result.addresses[0]?.targets[0]?.politicalParty).toBeNull()
    })

    it('omits requested addressKeys that have no current residents', async () => {
      const result = await service.residents(dto as never)

      expect(result.addresses).toEqual([])
    })

    it('rejects when the live population exceeds the residents cap', async () => {
      databricks.doorKnockingResidentRows.mockResolvedValueOnce(
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
      databricks.doorKnockingResidentRows.mockResolvedValueOnce([
        residentRow(OTHER_ID),
      ])

      const result = await service.residents(dto as never)

      const [address] = result.addresses
      expect(address?.targets).toEqual([])
      expect(address?.otherResidents).toHaveLength(1)
    })

    // A route freezes its keys once, so it holds the format that was current
    // when it was knocked. Callers look their own stored keys up in the result,
    // so a key handed back in any other format would miss every address and
    // read at the door as everyone having moved away.
    it('hands the addressKey back exactly as the row carried it', async () => {
      const LEGACY_KEY = '1200|W|ELM|ST||3B|62704'
      databricks.doorKnockingResidentRows.mockResolvedValueOnce([
        residentRow(TARGET_ID, LEGACY_KEY),
      ])

      const result = await service.residents({
        districtId: DISTRICT_ID,
        addressKeys: [LEGACY_KEY],
        targetPersonIds: [TARGET_ID],
      } as never)

      expect(result.addresses[0]?.addressKey).toBe(LEGACY_KEY)
    })
  })
})
