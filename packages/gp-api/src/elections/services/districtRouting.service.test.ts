import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ElectionsService } from './elections.service'
import { DistrictRoutingService } from './districtRouting.service'
import { PinoLogger } from 'nestjs-pino'

const currentOhio4 = {
  id: 'current-oh-4',
  state: 'OH',
  L2DistrictType: 'US_Congressional_District',
  L2DistrictName: '4',
  projectedTurnout: null,
}

const proposedOhio4 = {
  id: 'proposed-oh-4',
  state: 'OH',
  L2DistrictType: 'Proposed_District',
  L2DistrictName: '2026 PROPOSED CONG DIST 04 (EST.)',
  projectedTurnout: null,
}

describe('DistrictRoutingService', () => {
  let service: DistrictRoutingService
  let mockFindProposed: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFindProposed = vi.fn().mockResolvedValue(null)
    service = new DistrictRoutingService(
      {
        findProposedCongressionalDistrict: mockFindProposed,
      } as unknown as ElectionsService,
      {
        setContext: vi.fn(),
        info: vi.fn(),
      } as unknown as PinoLogger,
    )
  })

  it('swaps a Win org onto the adopted proposed district', async () => {
    mockFindProposed.mockResolvedValue(proposedOhio4)

    const result = await service.routeWinDistrict('oh-4-campaign', currentOhio4)

    expect(result.id).toBe('proposed-oh-4')
    expect(mockFindProposed).toHaveBeenCalledWith('OH', 4)
  })

  it('keeps a Serve org on the current district', async () => {
    mockFindProposed.mockResolvedValue(proposedOhio4)

    const result = await service.routeWinDistrict('eo-jane-doe', currentOhio4)

    expect(result.id).toBe('current-oh-4')
    expect(mockFindProposed).not.toHaveBeenCalled()
  })

  it('keeps the current district when the state has no adopted map', async () => {
    mockFindProposed.mockResolvedValue(null)

    const result = await service.routeWinDistrict('va-2-campaign', {
      ...currentOhio4,
      id: 'current-va-2',
      state: 'VA',
      L2DistrictName: '2',
    })

    expect(result.id).toBe('current-va-2')
  })

  it('does not route a non-congressional district', async () => {
    const result = await service.routeWinDistrict('city-council-campaign', {
      ...currentOhio4,
      id: 'current-ward',
      L2DistrictType: 'City_Ward',
      L2DistrictName: 'Ward 4',
    })

    expect(result.id).toBe('current-ward')
    expect(mockFindProposed).not.toHaveBeenCalled()
  })

  it('does not route when the current name is not a number', async () => {
    const result = await service.routeWinDistrict('odd-campaign', {
      ...currentOhio4,
      id: 'current-odd',
      L2DistrictName: 'AT LARGE',
    })

    expect(result.id).toBe('current-odd')
    expect(mockFindProposed).not.toHaveBeenCalled()
  })

  it('does not route when the current name is empty', async () => {
    const result = await service.routeWinDistrict('blank-campaign', {
      ...currentOhio4,
      id: 'current-blank',
      L2DistrictName: '',
    })

    expect(result.id).toBe('current-blank')
    expect(mockFindProposed).not.toHaveBeenCalled()
  })

  it('does not route when the current name is whitespace-only', async () => {
    const result = await service.routeWinDistrict('whitespace-campaign', {
      ...currentOhio4,
      id: 'current-whitespace',
      L2DistrictName: '   ',
    })

    expect(result.id).toBe('current-whitespace')
    expect(mockFindProposed).not.toHaveBeenCalled()
  })
})
