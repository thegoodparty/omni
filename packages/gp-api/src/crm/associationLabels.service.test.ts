import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HubSpot } from './crm.types'
import { AssociationLabelsService } from './associationLabels.service'

describe('AssociationLabelsService', () => {
  const getAll = vi.fn()
  const hubspot = {
    client: {
      crm: {
        associations: {
          v4: { schema: { definitionsApi: { getAll } } },
        },
      },
    },
  }
  const logger = createMockLogger()

  let service: AssociationLabelsService

  beforeEach(() => {
    vi.clearAllMocks()
    getAll.mockResolvedValue({
      results: [
        { typeId: 501, label: 'Candidate', category: 'USER_DEFINED' },
        { typeId: 502, label: 'Campaign Manager', category: 'USER_DEFINED' },
        // No label — a HubSpot-defined type sharing the same schema
        // response; must be filtered out rather than resolved by name.
        { typeId: 2, category: 'HUBSPOT_DEFINED' },
      ],
    })
    service = new AssociationLabelsService(hubspot as never, logger)
  })

  it('resolves a label id from the schema definitions response', async () => {
    const id = await service.resolveLabelId(
      HubSpot.AssociationLabelName.CANDIDATE,
    )

    expect(id).toBe(501)
    expect(getAll).toHaveBeenCalledWith('0-2', '0-1')
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('caches the schema lookup across calls', async () => {
    await service.resolveLabelId(HubSpot.AssociationLabelName.CANDIDATE)
    await service.resolveLabelId(HubSpot.AssociationLabelName.CAMPAIGN_MANAGER)

    expect(getAll).toHaveBeenCalledTimes(1)
  })

  it('logs and returns undefined when the label has not been created yet', async () => {
    const id = await service.resolveLabelId(
      HubSpot.AssociationLabelName.VOLUNTEER,
    )

    expect(id).toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ labelName: 'Volunteer' }),
      expect.stringContaining('not found'),
    )
  })

  it('logs and returns undefined when the schema lookup rejects', async () => {
    getAll.mockRejectedValue(new Error('hubspot down'))

    const id = await service.resolveLabelId(
      HubSpot.AssociationLabelName.CANDIDATE,
    )

    expect(id).toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ labelName: 'Candidate' }),
      expect.stringContaining('Failed to fetch'),
    )
  })

  it('retries the schema lookup on the next call after a failed fetch', async () => {
    getAll.mockRejectedValueOnce(new Error('hubspot down'))

    const first = await service.resolveLabelId(
      HubSpot.AssociationLabelName.CANDIDATE,
    )
    const second = await service.resolveLabelId(
      HubSpot.AssociationLabelName.CANDIDATE,
    )

    expect(first).toBeUndefined()
    expect(second).toBe(501)
    expect(getAll).toHaveBeenCalledTimes(2)
  })
})
