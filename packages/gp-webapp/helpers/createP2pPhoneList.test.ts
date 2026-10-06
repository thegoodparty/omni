import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createP2pPhoneList,
  getP2pPhoneListBuildStatus,
} from './createP2pPhoneList'

const mockClientFetch = vi.fn()

vi.mock('gpApi/clientFetch', () => ({
  clientFetch: (...args: unknown[]) => mockClientFetch(...args),
}))

describe('createP2pPhoneList', () => {
  beforeEach(() => {
    mockClientFetch.mockReset()
    mockClientFetch.mockResolvedValue({
      ok: true,
      data: { token: 'tok', buildId: 'build-1' },
    })
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

  it('returns the buildId alongside the token', async () => {
    const result = await createP2pPhoneList({ audienceSuperVoters: true })

    expect(result).toMatchObject({ ok: true, token: 'tok', buildId: 'build-1' })
  })
})

describe('getP2pPhoneListBuildStatus', () => {
  beforeEach(() => {
    mockClientFetch.mockReset()
  })

  it('reads a 202 as still building', async () => {
    mockClientFetch.mockResolvedValue({
      ok: false,
      status: 202,
      data: { message: 'Phone list build is still in progress.' },
    })

    const result = await getP2pPhoneListBuildStatus('build-1')

    expect(result).toEqual({ buildStatus: 'building' })
  })

  it('reads a ready response (no buildStatus field) as ready', async () => {
    mockClientFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        phoneListId: 77,
        leadsLoaded: 1200,
        excludedOptedOutCount: 3,
        excludedDuplicatePhoneCount: 1,
      },
    })

    const result = await getP2pPhoneListBuildStatus('build-1')

    expect(result).toEqual({
      buildStatus: 'ready',
      phoneListId: 77,
      leadsLoaded: 1200,
      excludedOptedOutCount: 3,
      excludedDuplicatePhoneCount: 1,
    })
  })

  it('reads a `buildStatus: failed` body as failed', async () => {
    mockClientFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: { buildStatus: 'failed', buildError: 'No contacts matched.' },
    })

    const result = await getP2pPhoneListBuildStatus('build-1')

    expect(result).toEqual({
      buildStatus: 'failed',
      buildError: 'No contacts matched.',
    })
  })

  it('reads an unexpected HTTP error as failed, not building', async () => {
    mockClientFetch.mockResolvedValue({
      ok: false,
      status: 404,
      data: { message: 'Phone list build not found' },
    })

    const result = await getP2pPhoneListBuildStatus('build-1')

    expect(result.buildStatus).toBe('failed')
  })

  it('reads a thrown network error as still building, not failed', async () => {
    mockClientFetch.mockRejectedValue(new Error('network down'))

    const result = await getP2pPhoneListBuildStatus('build-1')

    expect(result).toEqual({ buildStatus: 'building' })
  })
})
