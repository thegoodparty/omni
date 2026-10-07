import { describe, expect, it, vi } from 'vitest'
import { DevEnvBundleFetchError, fetchDevEnvBundles } from './devEnvBundle'

const jsonResponse = (status: number, data: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  }) as Response

describe('fetchDevEnvBundles', () => {
  it('returns the bundles on a valid response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        bundles: [
          { package: 'gp-api', variables: { FOO: 'bar' } },
          { package: 'gp-webapp', variables: {} },
        ],
      }),
    )
    const bundles = await fetchDevEnvBundles(
      'https://gp-api-dev.goodparty.org',
      'gho_abc',
      ['gp-api', 'gp-webapp'],
      fetchImpl,
    )
    expect(bundles).toEqual([
      { package: 'gp-api', variables: { FOO: 'bar' } },
      { package: 'gp-webapp', variables: {} },
    ])
  })

  it('sends the bearer token and requested packages, never the token in the body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { bundles: [] }))
    await fetchDevEnvBundles(
      'https://gp-api-dev.goodparty.org',
      'gho_abc',
      ['gp-api'],
      fetchImpl,
    )
    const [, init] = fetchImpl.mock.calls[0]
    expect(init.headers['X-GitHub-Token']).toBe('gho_abc')
    expect(init.headers.Authorization).toBeUndefined()
    expect(init.body).toBe(JSON.stringify({ packages: ['gp-api'] }))
  })

  it('rejects a package name outside the known enum (path-traversal guard)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        bundles: [
          { package: '../../../../etc/passwd', variables: { FOO: 'bar' } },
        ],
      }),
    )
    await expect(
      fetchDevEnvBundles(
        'https://gp-api-dev.goodparty.org',
        'gho_abc',
        ['gp-api'],
        fetchImpl,
      ),
    ).rejects.toBeInstanceOf(DevEnvBundleFetchError)
  })

  it('fails closed before returning anything on a malformed response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { bundles: [{ oops: true }] }))
    await expect(
      fetchDevEnvBundles(
        'https://gp-api-dev.goodparty.org',
        'gho_abc',
        ['gp-api'],
        fetchImpl,
      ),
    ).rejects.toBeInstanceOf(DevEnvBundleFetchError)
  })

  it('fails closed with an actionable message on 503 (vending not configured)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, {}))
    await expect(
      fetchDevEnvBundles(
        'https://gp-api-dev.goodparty.org',
        'gho_abc',
        ['gp-api'],
        fetchImpl,
      ),
    ).rejects.toThrow(/vending/)
  })

  it('fails closed on a rejected token (403)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, {}))
    await expect(
      fetchDevEnvBundles(
        'https://gp-api-dev.goodparty.org',
        'gho_abc',
        ['gp-api'],
        fetchImpl,
      ),
    ).rejects.toThrow(/confirm you are an active member/)
  })

  it('fails closed when the endpoint is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed'))
    await expect(
      fetchDevEnvBundles(
        'https://gp-api-dev.goodparty.org',
        'gho_abc',
        ['gp-api'],
        fetchImpl,
      ),
    ).rejects.toBeInstanceOf(DevEnvBundleFetchError)
  })
})
