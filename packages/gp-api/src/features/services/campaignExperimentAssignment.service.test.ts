import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CampaignExperimentAssignmentService } from './campaignExperimentAssignment.service'

const FLAG = 'independent-model-used'
const ARMS = ['control', 'haystaq', 'stateleg']
const campaign = { id: 7, userId: 42 }

describe('CampaignExperimentAssignmentService.getOrAssign', () => {
  let features: { getAllVariants: ReturnType<typeof vi.fn> }
  let users: { findUniqueOrThrow: ReturnType<typeof vi.fn> }
  let model: {
    findUnique: ReturnType<typeof vi.fn>
    upsert: ReturnType<typeof vi.fn>
  }
  let service: CampaignExperimentAssignmentService

  beforeEach(() => {
    features = { getAllVariants: vi.fn() }
    users = { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 42 }) }
    model = {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(({ create }) => Promise.resolve(create)),
    }
    service = new CampaignExperimentAssignmentService(
      features as never,
      users as never,
    )
    Object.defineProperty(service, 'model', { get: () => model })
  })

  const getOrAssign = () =>
    service.getOrAssign({ campaign, flagKey: FLAG, arms: ARMS })

  it('returns a stored arm without asking Amplitude again', async () => {
    model.findUnique.mockResolvedValue({ arm: 'haystaq' })
    await expect(getOrAssign()).resolves.toBe('haystaq')
    expect(features.getAllVariants).not.toHaveBeenCalled()
  })

  it("stores the owner's variant on first resolution", async () => {
    features.getAllVariants.mockResolvedValue({
      [FLAG]: { value: 'stateleg', key: 'stateleg' },
    })
    await expect(getOrAssign()).resolves.toBe('stateleg')
    expect(users.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 42 },
    })
    expect(model.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ arm: 'stateleg', ownerUserId: 42 }),
        update: {},
      }),
    )
  })

  it('stores nothing when Amplitude has no variant or an unknown one', async () => {
    features.getAllVariants.mockResolvedValue({})
    await expect(getOrAssign()).resolves.toBeNull()

    features.getAllVariants.mockResolvedValue({
      [FLAG]: { value: 'on', key: 'on' },
    })
    await expect(getOrAssign()).resolves.toBeNull()
    expect(model.upsert).not.toHaveBeenCalled()
  })

  it('keeps the first writer when two first requests race', async () => {
    features.getAllVariants.mockResolvedValue({
      [FLAG]: { value: 'control', key: 'control' },
    })
    model.upsert.mockResolvedValue({ arm: 'haystaq' })
    await expect(getOrAssign()).resolves.toBe('haystaq')
  })
})
