import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { M2MOnly } from '@/authentication/guards/M2MOnly.guard'
import { OfficeHolderFilterDto } from '@/electionDb/officeHolders/officeHolders.schema'
import { OfficeHoldersService } from '@/electionDb/officeHolders/officeHolders.service'
import { RESPONSE_SCHEMA_KEY } from '@/shared/decorators/ResponseSchema.decorator'
import {
  ElectionOfficeHoldersController,
  officeHolderListResponseSchema,
} from './electionOfficeHolders.controller'

const getGuards = (methodName: keyof ElectionOfficeHoldersController) =>
  Reflect.getMetadata(
    '__guards__',
    ElectionOfficeHoldersController.prototype[methodName],
  ) ?? []

const getResponseSchema = (methodName: keyof ElectionOfficeHoldersController) =>
  Reflect.getMetadata(
    RESPONSE_SCHEMA_KEY,
    ElectionOfficeHoldersController.prototype[methodName],
  )

// A row as Prisma hands it back, plus an ETL column the schema does not
// declare — it must not reach the wire.
const officeHolderRow = {
  id: '22222222-2222-2222-2222-222222222222',
  personId: '11111111-1111-1111-1111-111111111111',
  positionId: '33333333-3333-3333-3333-333333333333',
  positionName: 'Mayor',
  isCurrent: true,
  state: 'TX',
  geoId: '4848072',
  partyNames: ['Independent'],
  internalEtlScratchColumn: 'should never ship',
}

describe('ElectionOfficeHoldersController', () => {
  let controller: ElectionOfficeHoldersController
  let getOfficeHolders: Mock

  beforeEach(() => {
    getOfficeHolders = vi.fn()

    const officeHoldersServiceMock: Partial<OfficeHoldersService> = {
      getOfficeHolders,
    }

    controller = new ElectionOfficeHoldersController(
      officeHoldersServiceMock as OfficeHoldersService,
    )
  })

  describe('guards', () => {
    it('protects getOfficeHolders with M2MOnly', () => {
      expect(getGuards('getOfficeHolders')).toContain(M2MOnly)
    })
  })

  describe('getOfficeHolders', () => {
    const filterDto: OfficeHolderFilterDto = {
      state: 'TX',
      isCurrent: true,
      includePosition: false,
    }

    it('delegates the filter straight to the service', async () => {
      getOfficeHolders.mockResolvedValue([officeHolderRow])

      const result = await controller.getOfficeHolders(filterDto)

      expect(getOfficeHolders).toHaveBeenCalledWith(filterDto)
      expect(result).toEqual([officeHolderRow])
    })

    it('is wired to the list response schema', () => {
      expect(getResponseSchema('getOfficeHolders')).toBe(
        officeHolderListResponseSchema,
      )
    })

    it('strips undeclared columns from the response', () => {
      const parsed = officeHolderListResponseSchema.parse([officeHolderRow])[0]!

      expect(parsed).not.toHaveProperty('internalEtlScratchColumn')
      expect(parsed.positionName).toBe('Mayor')
      expect(parsed.partyNames).toEqual(['Independent'])
    })

    it('keeps the nested Position when includePosition is set', () => {
      const withPosition = {
        ...officeHolderRow,
        Position: {
          id: '33333333-3333-3333-3333-333333333333',
          brDatabaseId: '900',
          brPositionId: 'br-900',
          state: 'TX',
          name: 'Mayor',
          isWinIcp: true,
          isServeIcp: null,
          salary: null,
          districtId: null,
          level: 'CITY',
          unmappedEtlColumn: 'should never ship',
        },
      }

      const parsed = officeHolderListResponseSchema.parse([withPosition])[0]!

      expect(parsed.Position?.name).toBe('Mayor')
      expect(parsed.Position).not.toHaveProperty('unmappedEtlColumn')
    })
  })
})
