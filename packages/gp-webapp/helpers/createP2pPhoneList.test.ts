import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createP2pPhoneList } from './createP2pPhoneList'

const mockClientFetch = vi.fn()

vi.mock('gpApi/clientFetch', () => ({
  clientFetch: (...args: unknown[]) => mockClientFetch(...args),
}))

describe('createP2pPhoneList', () => {
  beforeEach(() => {
    mockClientFetch.mockReset()
    mockClientFetch.mockResolvedValue({ ok: true, data: { token: 'tok' } })
  })

  it('includes voterFileFilterId when the audience is a saved segment', async () => {
    await createP2pPhoneList({ audienceSuperVoters: true }, 42)

    const body = mockClientFetch.mock.calls[0]?.[1]
    expect(body).toMatchObject({
      audienceSuperVoters: true,
      voterFileFilterId: 42,
    })
  })

  it('sends no voterFileFilterId for an ad-hoc audience', async () => {
    await createP2pPhoneList({ audienceSuperVoters: true })

    const body = mockClientFetch.mock.calls[0]?.[1]
    expect(body).not.toHaveProperty('voterFileFilterId')
  })
})
