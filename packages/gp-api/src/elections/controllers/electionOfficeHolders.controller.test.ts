import { describe, expect, it } from 'vitest'
import { RESPONSE_SCHEMA_KEY } from '@/shared/decorators/ResponseSchema.decorator'
import {
  ElectionOfficeHoldersController,
  officeHolderListResponseSchema,
} from './electionOfficeHolders.controller'

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
  describe('getOfficeHolders', () => {
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
