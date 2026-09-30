// Integration-style coverage for runDeviceFlow's own orchestration — the
// piece deviceFlow.test.ts and devEnvBundle.test.ts don't reach: that a
// successful flow writes exactly the requested device-<pkg>.env files, and
// that every failure mode (network, denied, an unrequested/unexpected
// package in the response) writes nothing at all before failing closed.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('child_process', () => ({ execFileSync: vi.fn() }))

vi.mock('./deviceFlow', async () => {
  const actual =
    await vi.importActual<typeof import('./deviceFlow')>('./deviceFlow')
  return { ...actual, requestDeviceCode: vi.fn(), awaitAccessToken: vi.fn() }
})

vi.mock('./devEnvBundle', async () => {
  const actual =
    await vi.importActual<typeof import('./devEnvBundle')>('./devEnvBundle')
  return { ...actual, fetchDevEnvBundles: vi.fn() }
})

import {
  AccessDeniedError,
  awaitAccessToken,
  requestDeviceCode,
} from './deviceFlow'
import { fetchDevEnvBundles } from './devEnvBundle'
import { runDeviceFlow } from './cli'

const mockedRequestDeviceCode = vi.mocked(requestDeviceCode)
const mockedAwaitAccessToken = vi.mocked(awaitAccessToken)
const mockedFetchDevEnvBundles = vi.mocked(fetchDevEnvBundles)

const device = {
  device_code: 'dc-1',
  user_code: 'ABCD-1234',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5,
}

describe('runDeviceFlow', () => {
  let outDir: string

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'device-flow-cli-test-'))
    mockedRequestDeviceCode.mockReset().mockResolvedValue(device)
    mockedAwaitAccessToken.mockReset().mockResolvedValue('gho_test_token')
    mockedFetchDevEnvBundles.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Every fail-closed path ends in process.exit(1); throwing instead lets
    // the test observe that without killing the vitest worker process.
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never)
  })

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('writes device-<pkg>.env for exactly the requested packages on success', async () => {
    mockedFetchDevEnvBundles.mockResolvedValue([
      { package: 'gp-api', variables: { FOO: 'bar' } },
      { package: 'gp-webapp', variables: {} },
    ])

    await runDeviceFlow('client-1', 'https://gp-api-dev.example', outDir, [
      'gp-api',
      'gp-webapp',
    ])

    expect(readFileSync(join(outDir, 'device-gp-api.env'), 'utf-8')).toBe(
      'FOO=bar\n',
    )
    expect(existsSync(join(outDir, 'device-gp-webapp.env'))).toBe(true)
    expect(mockedFetchDevEnvBundles).toHaveBeenCalledWith(
      'https://gp-api-dev.example',
      'gho_test_token',
      ['gp-api', 'gp-webapp'],
    )
  })

  it('writes nothing when fetchDevEnvBundles fails (malformed response, unreachable, etc.)', async () => {
    mockedFetchDevEnvBundles.mockRejectedValue(new Error('boom'))

    await expect(
      runDeviceFlow('client-1', 'https://gp-api-dev.example', outDir, [
        'gp-api',
      ]),
    ).rejects.toThrow('process.exit(1)')

    expect(existsSync(join(outDir, 'device-gp-api.env'))).toBe(false)
  })

  it('writes nothing when a bundle names a package that was not requested', async () => {
    mockedFetchDevEnvBundles.mockResolvedValue([
      { package: 'gp-webapp', variables: { FOO: 'bar' } },
    ])

    await expect(
      runDeviceFlow('client-1', 'https://gp-api-dev.example', outDir, [
        'gp-api',
      ]),
    ).rejects.toThrow('process.exit(1)')

    expect(existsSync(join(outDir, 'device-gp-webapp.env'))).toBe(false)
  })

  it('never calls the bundle fetch when the device flow is denied', async () => {
    mockedAwaitAccessToken.mockRejectedValue(new AccessDeniedError())

    await expect(
      runDeviceFlow('client-1', 'https://gp-api-dev.example', outDir, [
        'gp-api',
      ]),
    ).rejects.toThrow('process.exit(1)')

    expect(mockedFetchDevEnvBundles).not.toHaveBeenCalled()
    expect(existsSync(join(outDir, 'device-gp-api.env'))).toBe(false)
  })

  it('fails closed with no network call at all when client_id is empty', async () => {
    await expect(
      runDeviceFlow('', 'https://gp-api-dev.example', outDir, ['gp-api']),
    ).rejects.toThrow('process.exit(1)')

    expect(mockedRequestDeviceCode).not.toHaveBeenCalled()
  })
})
