import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  DevEnvBundleFetchError,
  downloadElectionSeed,
  fetchDevEnvBundles,
  fetchElectionSeedUrl,
} from './devEnvBundle'

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

describe('fetchElectionSeedUrl', () => {
  const SEED_URL =
    'https://gp-local-election-seed-dev.s3.amazonaws.com/election-seed.sql.gz?X-Amz-Signature=x'

  it('returns the presigned URL, sending the token in its own header', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { url: SEED_URL, expiresAt: '2026-10-19T20:00:00Z' }),
      )

    const url = await fetchElectionSeedUrl(
      'https://gp-api-dev.goodparty.org',
      'gho_abc',
      fetchImpl,
    )

    expect(url).toBe(SEED_URL)
    const [target, init] = fetchImpl.mock.calls[0]
    expect(String(target)).toBe(
      'https://gp-api-dev.goodparty.org/v1/dev-env/election-seed',
    )
    expect(init.headers['X-GitHub-Token']).toBe('gho_abc')
    expect(init.body).not.toContain('gho_abc')
  })

  it('names the missing seed when the endpoint answers 503', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, {}))

    await expect(
      fetchElectionSeedUrl(
        'https://gp-api-dev.goodparty.org',
        'gho_abc',
        fetchImpl,
      ),
    ).rejects.toThrow(/no local election seed/)
  })

  it('rejects a response without a URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}))

    await expect(
      fetchElectionSeedUrl(
        'https://gp-api-dev.goodparty.org',
        'gho_abc',
        fetchImpl,
      ),
    ).rejects.toBeInstanceOf(DevEnvBundleFetchError)
  })
})

describe('downloadElectionSeed', () => {
  it('writes the body to the target path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'election-seed-'))
    const out = join(dir, 'nested', 'election-seed.sql.gz')
    const fetchImpl = vi.fn().mockResolvedValue(new Response('seed bytes'))

    await downloadElectionSeed('https://example.com/seed', out, fetchImpl)

    expect(readFileSync(out, 'utf8')).toBe('seed bytes')
    expect(existsSync(`${out}.partial`)).toBe(false)
  })

  it('writes nothing when the download fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'election-seed-'))
    const out = join(dir, 'election-seed.sql.gz')
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('denied', { status: 403 }))

    await expect(
      downloadElectionSeed('https://example.com/seed', out, fetchImpl),
    ).rejects.toThrow(/403/)
    expect(existsSync(out)).toBe(false)
  })
})
