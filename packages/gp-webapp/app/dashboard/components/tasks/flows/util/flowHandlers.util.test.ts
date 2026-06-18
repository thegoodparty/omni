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

describe('handleCreateOutreach - text counts', () => {
  beforeEach(() => {
    mockCreateOutreach.mockReset().mockResolvedValue({ id: 1 })
  })

  it('forwards textCount and computes billable from the free-texts offer', async () => {
    await handleCreateOutreach({
      type: 'text',
      state: { schedule: {} },
      campaignId: 42,
      textCount: 5200,
      hasFreeTextsOffer: true,
      p2pUxEnabled: false,
    })()

    const payload = mockCreateOutreach.mock.calls[0]?.[0]
    expect(payload).toEqual(
      expect.objectContaining({ textCount: 5200, billableTextCount: 200 }),
    )
  })

  it('clamps billable to zero when total is under the free-texts threshold', async () => {
    await handleCreateOutreach({
      type: 'text',
      state: { schedule: {} },
      campaignId: 42,
      textCount: 3000,
      hasFreeTextsOffer: true,
      p2pUxEnabled: false,
    })()

    const payload = mockCreateOutreach.mock.calls[0]?.[0]
    expect(payload).toEqual(
      expect.objectContaining({ textCount: 3000, billableTextCount: 0 }),
    )
  })

  it('bills the full count when there is no free-texts offer', async () => {
    await handleCreateOutreach({
      type: 'text',
      state: { schedule: {} },
      campaignId: 42,
      textCount: 300,
      hasFreeTextsOffer: false,
      p2pUxEnabled: false,
    })()

    const payload = mockCreateOutreach.mock.calls[0]?.[0]
    expect(payload).toEqual(
      expect.objectContaining({ textCount: 300, billableTextCount: 300 }),
    )
  })

  it('omits text counts when textCount is not provided', async () => {
    await handleCreateOutreach({
      type: 'text',
      state: { schedule: {} },
      campaignId: 42,
      p2pUxEnabled: false,
    })()

    const payload = mockCreateOutreach.mock.calls[0]?.[0]
    expect(payload).not.toHaveProperty('textCount')
    expect(payload).not.toHaveProperty('billableTextCount')
  })
})
