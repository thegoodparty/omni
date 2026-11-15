import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GetPositionByBrIdQueryDTO,
  GetPositionByIdParamsDTO,
} from '@/electionDb/positions/positions.schema'
import { PositionsService } from '@/electionDb/positions/positions.service'
import {
  ElectionPositionsController,
  positionResponseSchema,
} from './electionPositions.controller'

const getPath = (methodName: keyof ElectionPositionsController) =>
  Reflect.getMetadata('path', ElectionPositionsController.prototype[methodName])

const positionId = '3f0f2a1e-1f2b-4c3d-9e8f-0a1b2c3d4e5f'

describe('ElectionPositionsController', () => {
  let controller: ElectionPositionsController
  const getPositionById = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new ElectionPositionsController({
      getPositionById,
    } as unknown as PositionsService)
  })

  describe('routing', () => {
    it('exposes the position lookup at :id', () => {
      expect(getPath('getPositionById')).toBe(':id')
    })
  })

  describe('getPositionById', () => {
    it('leaves omitted query params undefined', async () => {
      getPositionById.mockResolvedValue({})

      await controller.getPositionById(
        { id: positionId } as GetPositionByIdParamsDTO,
        { includeFilingFee: false } as GetPositionByBrIdQueryDTO,
      )

      expect(getPositionById).toHaveBeenCalledWith({
        id: positionId,
        includeDistrict: undefined,
        electionDate: undefined,
        includeFilingFee: false,
      })
    })
  })

  describe('response narrowing', () => {
    it('drops undeclared position columns', () => {
      const parsed = positionResponseSchema.parse({
        id: positionId,
        brPositionId: 'br-1',
        brDatabaseId: '123',
        state: 'TX',
        name: 'County Sheriff',
        level: 'COUNTY',
        salary: '$90,000',
        districtId: 'leak',
      })

      expect(parsed).not.toHaveProperty('districtId')
      expect(parsed).toEqual({
        id: positionId,
        brPositionId: 'br-1',
        brDatabaseId: '123',
        state: 'TX',
        name: 'County Sheriff',
        level: 'COUNTY',
      })
    })

    it('narrows the joined district to its four public fields', () => {
      const parsed = positionResponseSchema.parse({
        id: positionId,
        brPositionId: 'br-1',
        brDatabaseId: '123',
        state: 'TX',
        district: {
          id: 'district-1',
          state: 'TX',
          L2DistrictType: 'County',
          L2DistrictName: 'Hidalgo',
          registeredVoters: 12345,
        },
      })

      expect(parsed.district).toEqual({
        id: 'district-1',
        state: 'TX',
        L2DistrictType: 'County',
        L2DistrictName: 'Hidalgo',
      })
    })
  })
})
