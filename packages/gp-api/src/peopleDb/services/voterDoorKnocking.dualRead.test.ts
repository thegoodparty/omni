import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VoterDoorKnockingService } from './voterDoorKnocking.service'
import type { PeopleDbService } from '../peopleDb.service'

const DISTRICT_ID = '457a1cd7-4184-f823-49d3-f207af693521'
const TARGET_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_ID = '22222222-2222-2222-2222-222222222222'
const ADDRESS_KEY = '1200 W ELM ST|4B|62704'

const evaluateRow = (id: string) => ({
  id,
  firstName: 'Marisol',
  lastName: 'Vega',
  lat: 41.8781,
  lng: -87.6298,
  addressKey: ADDRESS_KEY,
  displayAddress: '1200 W Elm St',
})

const residentRow = (id: string) => ({
  id,
  firstName: 'Marisol',
  lastName: 'Vega',
  Age: '44',
  Age_Int: 44,
  Parties_Description: null,
  cellPhone: null,
  landline: null,
  addressKey: ADDRESS_KEY,
  registered: true,
  Voter_Status: null,
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

type CompareArgs = {
  op: string
  districtId: string
  authoritative: () => Promise<unknown>
  comparison: () => Promise<unknown>
  fingerprintAuthoritative: (value: never) => string | number | null
  fingerprintComparison: (value: never) => string | number | null
}

describe('VoterDoorKnockingService dual read', () => {
  let service: VoterDoorKnockingService
  let mockClient: {
    $queryRaw: ReturnType<typeof vi.fn>
    $executeRaw: ReturnType<typeof vi.fn>
    $transaction: ReturnType<typeof vi.fn>
  }
  let databricks: {
    doorKnockingEvaluateRows: ReturnType<typeof vi.fn>
    doorKnockingResidentRows: ReturnType<typeof vi.fn>
  }
  let compared: CompareArgs | null
  let shadow: { enabled: boolean; compare: ReturnType<typeof vi.fn> }

  const mockDistrictService = {
    findDistrictById: vi.fn().mockResolvedValue({
      id: DISTRICT_ID,
      type: 'City',
      name: 'SPRINGFIELD',
      state: 'IL',
    }),
  }

  const evaluateDto = {
    districtId: DISTRICT_ID,
    bbox: { minLat: 41.8, maxLat: 41.9, minLng: -87.7, maxLng: -87.6 },
    filters: { filters: [], filterValues: {}, filterOperators: {} },
    maxPeople: 20_000,
  }

  const residentsDto = {
    districtId: DISTRICT_ID,
    addressKeys: [ADDRESS_KEY],
    targetPersonIds: [TARGET_ID],
  }

  beforeEach(() => {
    mockClient = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn().mockResolvedValue(0),
      $transaction: vi
        .fn()
        .mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    }
    databricks = {
      doorKnockingEvaluateRows: vi.fn().mockResolvedValue([]),
      doorKnockingResidentRows: vi.fn().mockResolvedValue([]),
    }
    compared = null
    shadow = {
      enabled: true,
      // Captures the arms rather than running them, so each can be exercised
      // on its own — the real compare never awaits the comparison arm.
      compare: vi.fn((args: CompareArgs) => {
        compared = args
        return args.authoritative()
      }),
    } as unknown as { enabled: boolean; compare: ReturnType<typeof vi.fn> }
    ;(shadow as unknown as { databricks: unknown }).databricks = databricks

    service = new VoterDoorKnockingService(
      mockDistrictService as never,
      shadow as never,
    )
    ;(service as unknown as { _peopleDb: PeopleDbService })._peopleDb = {
      get instance() {
        return mockClient
      },
    } as unknown as PeopleDbService
  })

  describe('when the flag is off', () => {
    it('serves evaluate from Postgres and never compares', async () => {
      shadow.enabled = false
      await service.evaluate(evaluateDto as never)
      expect(shadow.compare).not.toHaveBeenCalled()
      expect(databricks.doorKnockingEvaluateRows).not.toHaveBeenCalled()
      expect(mockClient.$transaction).toHaveBeenCalled()
    })

    it('serves residents from Postgres and never compares', async () => {
      shadow.enabled = false
      await service.residents(residentsDto as never)
      expect(shadow.compare).not.toHaveBeenCalled()
      expect(databricks.doorKnockingResidentRows).not.toHaveBeenCalled()
    })
  })

  describe('when the flag is on', () => {
    it('makes Databricks authoritative for evaluate', async () => {
      databricks.doorKnockingEvaluateRows.mockResolvedValue([
        evaluateRow(TARGET_ID),
      ])
      const result = await service.evaluate(evaluateDto as never)
      expect(compared?.op).toBe('dk-evaluate')
      expect(compared?.districtId).toBe(DISTRICT_ID)
      expect(result.people).toHaveLength(1)
      expect(databricks.doorKnockingEvaluateRows).toHaveBeenCalledOnce()
    })

    it('makes Databricks authoritative for residents', async () => {
      databricks.doorKnockingResidentRows.mockResolvedValue([
        residentRow(TARGET_ID),
      ])
      const result = await service.residents(residentsDto as never)
      expect(compared?.op).toBe('dk-residents')
      expect(result.addresses).toHaveLength(1)
      expect(result.addresses[0]?.targets).toHaveLength(1)
    })

    it('passes the residents cap to the Databricks arm', async () => {
      await service.residents({
        ...residentsDto,
        targetPersonIds: [TARGET_ID, OTHER_ID],
      } as never)
      expect(databricks.doorKnockingResidentRows).toHaveBeenCalledWith(
        expect.anything(),
        20,
      )
    })

    it('still runs Postgres as the comparison arm', async () => {
      await service.evaluate(evaluateDto as never)
      expect(mockClient.$transaction).not.toHaveBeenCalled()
      await compared?.comparison()
      expect(mockClient.$transaction).toHaveBeenCalled()
    })

    // The reject-rather-than-truncate guard is a correctness invariant, not a
    // Postgres implementation detail — a truncated roster sends a canvasser to
    // the wrong doors whichever store produced it.
    it('applies the overflow guard to the Databricks arm', async () => {
      databricks.doorKnockingEvaluateRows.mockResolvedValue([
        evaluateRow(TARGET_ID),
        evaluateRow(OTHER_ID),
      ])
      await expect(
        service.evaluate({ ...evaluateDto, maxPeople: 1 } as never),
      ).rejects.toThrow(BadRequestException)
    })

    it('applies the residents overflow guard to the Databricks arm', async () => {
      databricks.doorKnockingResidentRows.mockResolvedValue(
        Array.from({ length: 11 }, (_, index) =>
          residentRow(
            `${index}`.padStart(8, '0') + '-0000-0000-0000-000000000000',
          ),
        ),
      )
      await expect(service.residents(residentsDto as never)).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  describe('fingerprints', () => {
    // Neither engine orders these scans, so a digest that depended on row
    // order would report constant disagreement and hide the real one.
    it('are insensitive to row order', async () => {
      databricks.doorKnockingEvaluateRows.mockResolvedValue([
        evaluateRow(TARGET_ID),
        evaluateRow(OTHER_ID),
      ])
      await service.evaluate(evaluateDto as never)
      const forward = compared?.fingerprintAuthoritative({
        people: [evaluateRow(TARGET_ID), evaluateRow(OTHER_ID)],
      } as never)
      const reversed = compared?.fingerprintAuthoritative({
        people: [evaluateRow(OTHER_ID), evaluateRow(TARGET_ID)],
      } as never)
      expect(forward).toBe(reversed)
    })

    // The failure being watched for is a bbox or key expression that selects a
    // DIFFERENT set of the same size, which a row count cannot see.
    it('differ for same-sized but different id sets', async () => {
      await service.evaluate(evaluateDto as never)
      const first = compared?.fingerprintAuthoritative({
        people: [evaluateRow(TARGET_ID)],
      } as never)
      const second = compared?.fingerprintAuthoritative({
        people: [evaluateRow(OTHER_ID)],
      } as never)
      expect(first).not.toBe(second)
    })

    it('cover both targets and other residents', async () => {
      await service.residents(residentsDto as never)
      const withOther = compared?.fingerprintAuthoritative({
        addresses: [
          {
            addressKey: ADDRESS_KEY,
            targets: [{ personId: TARGET_ID }],
            otherResidents: [{ personId: OTHER_ID }],
          },
        ],
      } as never)
      const withoutOther = compared?.fingerprintAuthoritative({
        addresses: [
          {
            addressKey: ADDRESS_KEY,
            targets: [{ personId: TARGET_ID }],
            otherResidents: [],
          },
        ],
      } as never)
      expect(withOther).not.toBe(withoutOther)
    })
  })
})
