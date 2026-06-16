import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleCreateOutreach } from './flowHandlers.util'

const mockCreateOutreach = vi.fn()

vi.mock('helpers/createOutreach', () => ({
  createOutreach: (...args: unknown[]) => mockCreateOutreach(...args),
}))

describe('handleCreateOutreach - campaignPlanDueDate', () => {
  beforeEach(() => {
    mockCreateOutreach.mockReset().mockResolvedValue({ id: 1 })
  })

  it('forwards the campaign plan due date to the create payload', async () => {
    await handleCreateOutreach({
      type: 'text',
      state: { schedule: { message: 'hi' } },
      campaignId: 42,
      campaignPlanDueDate: '2026-07-01',
      p2pUxEnabled: false,
    })()

    expect(mockCreateOutreach).toHaveBeenCalledTimes(1)
    const payload = mockCreateOutreach.mock.calls[0]?.[0]
    expect(payload).toEqual(
      expect.objectContaining({ campaignPlanDueDate: '2026-07-01' }),
    )
  })

  it('omits campaignPlanDueDate from the payload when not provided', async () => {
    await handleCreateOutreach({
      type: 'text',
      state: { schedule: { message: 'hi' } },
      campaignId: 42,
      p2pUxEnabled: false,
    })()

    const payload = mockCreateOutreach.mock.calls[0]?.[0]
    expect(payload).not.toHaveProperty('campaignPlanDueDate')
  })
})
