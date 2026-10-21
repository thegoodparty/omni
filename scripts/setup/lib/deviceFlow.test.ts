import { describe, expect, it, vi } from 'vitest'
import {
  AccessDeniedError,
  awaitAccessToken,
  DeviceFlowExpiredError,
  pollAccessTokenOnce,
  requestDeviceCode,
} from './deviceFlow'

const jsonResponse = (status: number, data: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  }) as Response

const device = {
  device_code: 'dc-1',
  user_code: 'ABCD-1234',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5,
}

describe('requestDeviceCode', () => {
  it('returns the parsed device code payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, device))
    const result = await requestDeviceCode('client-1', fetchImpl)
    expect(result).toEqual(device)
  })

  it('throws when GitHub is unreachable or the response is malformed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, {}))
    await expect(requestDeviceCode('client-1', fetchImpl)).rejects.toThrow()
  })
})

describe('pollAccessTokenOnce', () => {
  it('reports pending on authorization_pending', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { error: 'authorization_pending' }))
    const result = await pollAccessTokenOnce('client-1', 'dc-1', fetchImpl)
    expect(result).toEqual({ status: 'pending' })
  })

  it('reports slow_down with the server-given interval', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { error: 'slow_down', interval: 10 }),
      )
    const result = await pollAccessTokenOnce('client-1', 'dc-1', fetchImpl)
    expect(result).toEqual({ status: 'slow_down', intervalSeconds: 10 })
  })

  it('returns the token on success', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { access_token: 'gho_abc' }))
    const result = await pollAccessTokenOnce('client-1', 'dc-1', fetchImpl)
    expect(result).toEqual({ status: 'success', token: 'gho_abc' })
  })

  it('throws DeviceFlowExpiredError on expired_token', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { error: 'expired_token' }))
    await expect(
      pollAccessTokenOnce('client-1', 'dc-1', fetchImpl),
    ).rejects.toBeInstanceOf(DeviceFlowExpiredError)
  })

  it('throws AccessDeniedError on access_denied', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { error: 'access_denied' }))
    await expect(
      pollAccessTokenOnce('client-1', 'dc-1', fetchImpl),
    ).rejects.toBeInstanceOf(AccessDeniedError)
  })
})

describe('awaitAccessToken', () => {
  const sleep = async () => {} // no real waiting in tests

  it('loops through pending polls to success', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { error: 'authorization_pending' }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { error: 'authorization_pending' }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'gho_abc' }))

    const token = await awaitAccessToken('client-1', device, {
      fetchImpl,
      sleep,
    })
    expect(token).toBe('gho_abc')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('grows the interval on slow_down without failing the flow', async () => {
    const sleepCalls: number[] = []
    const trackedSleep = async (ms: number) => {
      sleepCalls.push(ms)
    }
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { error: 'slow_down' }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'gho_abc' }))

    const token = await awaitAccessToken('client-1', device, {
      fetchImpl,
      sleep: trackedSleep,
    })
    expect(token).toBe('gho_abc')
    // device.interval is 5s; slow_down with no explicit interval bumps by 5s.
    expect(sleepCalls).toEqual([5000, 10000])
  })

  it('propagates expired_token as a failure, not an infinite loop', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { error: 'expired_token' }))
    await expect(
      awaitAccessToken('client-1', device, { fetchImpl, sleep }),
    ).rejects.toBeInstanceOf(DeviceFlowExpiredError)
  })

  it('propagates access_denied as a failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { error: 'access_denied' }))
    await expect(
      awaitAccessToken('client-1', device, { fetchImpl, sleep }),
    ).rejects.toBeInstanceOf(AccessDeniedError)
  })
})
