import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PeopleDbUrlProvider } from './peopleDbUrl.provider'

const mockSend = vi.fn()
const mockDestroy = vi.fn()

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class {
    send = mockSend
    destroy = mockDestroy
  },
  GetParameterCommand: class {
    constructor(public input: { Name: string; WithDecryption: boolean }) {}
  },
}))

const revalidate = (provider: PeopleDbUrlProvider) => provider['revalidate']()

describe('PeopleDbUrlProvider', () => {
  let provider: PeopleDbUrlProvider
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PEOPLE_DATABASE_URL
    delete process.env.OTEL_SERVICE_ENVIRONMENT
    delete process.env.PEOPLE_DB_SSM_PARAM
    provider = new PeopleDbUrlProvider()
  })

  afterEach(() => {
    provider.onModuleDestroy()
    process.env = { ...originalEnv }
  })

  it('uses PEOPLE_DATABASE_URL without calling SSM', async () => {
    process.env.PEOPLE_DATABASE_URL = 'postgres://local/db'
    expect(await provider.ensureLoaded()).toBe('postgres://local/db')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('reads the env-specific SSM parameter with decryption', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    mockSend.mockResolvedValue({ Parameter: { Value: 'postgres://ssm/dev' } })
    expect(await provider.ensureLoaded()).toBe('postgres://ssm/dev')
    const firstCall = mockSend.mock.calls[0]
    expect(firstCall?.[0].input).toEqual({
      Name: 'people-db-connection-string-dev',
      WithDecryption: true,
    })
  })

  it('uses PEOPLE_DB_SSM_PARAM as the exact parameter name when set', async () => {
    process.env.PEOPLE_DB_SSM_PARAM = 'people-db-connection-string-dev'
    mockSend.mockResolvedValue({ Parameter: { Value: 'postgres://ssm/dev' } })
    expect(await provider.ensureLoaded()).toBe('postgres://ssm/dev')
    const firstCall = mockSend.mock.calls[0]
    expect(firstCall?.[0].input).toEqual({
      Name: 'people-db-connection-string-dev',
      WithDecryption: true,
    })
  })

  it('memoizes the load so concurrent consumers do not re-fetch', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    mockSend.mockResolvedValue({ Parameter: { Value: 'postgres://ssm/dev' } })
    const [a, b] = await Promise.all([
      provider.ensureLoaded(),
      provider.ensureLoaded(),
    ])
    expect(a).toBe('postgres://ssm/dev')
    expect(b).toBe('postgres://ssm/dev')
    expect(await provider.ensureLoaded()).toBe('postgres://ssm/dev')
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('throws when neither PEOPLE_DATABASE_URL nor OTEL_SERVICE_ENVIRONMENT is set', async () => {
    await expect(provider.ensureLoaded()).rejects.toThrow(/PEOPLE_DATABASE_URL/)
  })

  it('throws when the SSM parameter has no value', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
    mockSend.mockResolvedValue({ Parameter: {} })
    await expect(provider.ensureLoaded()).rejects.toThrow(/no value/)
  })

  it('retries the load after a failure rather than memoizing the rejection', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    mockSend.mockRejectedValueOnce(new Error('SSM throttled'))
    await expect(provider.ensureLoaded()).rejects.toThrow(/SSM throttled/)

    mockSend.mockResolvedValueOnce({ Parameter: { Value: 'postgres://ok' } })
    expect(await provider.ensureLoaded()).toBe('postgres://ok')
  })

  it('notifies subscribers when the value changes on revalidation', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    mockSend.mockResolvedValueOnce({ Parameter: { Value: 'postgres://one' } })
    await provider.ensureLoaded()

    const listener = vi.fn()
    provider.onChange(listener)

    mockSend.mockResolvedValueOnce({ Parameter: { Value: 'postgres://two' } })
    await revalidate(provider)

    expect(listener).toHaveBeenCalledWith('postgres://two')
    expect(await provider.ensureLoaded()).toBe('postgres://two')
  })

  it('does not notify when the value is unchanged', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    mockSend.mockResolvedValue({ Parameter: { Value: 'postgres://same' } })
    await provider.ensureLoaded()

    const listener = vi.fn()
    provider.onChange(listener)
    await revalidate(provider)

    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps the last-known-good value when revalidation fails', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    mockSend.mockResolvedValueOnce({ Parameter: { Value: 'postgres://good' } })
    await provider.ensureLoaded()

    const listener = vi.fn()
    provider.onChange(listener)

    mockSend.mockRejectedValueOnce(new Error('SSM throttled'))
    await revalidate(provider)

    expect(await provider.ensureLoaded()).toBe('postgres://good')
    expect(listener).not.toHaveBeenCalled()
  })

  it('closes the SSM client on destroy', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    mockSend.mockResolvedValue({ Parameter: { Value: 'postgres://one' } })
    await provider.ensureLoaded()

    provider.onModuleDestroy()

    expect(mockDestroy).toHaveBeenCalled()
  })

  it('stops notifying after unsubscribe', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    mockSend.mockResolvedValueOnce({ Parameter: { Value: 'postgres://one' } })
    await provider.ensureLoaded()

    const listener = vi.fn()
    const unsubscribe = provider.onChange(listener)
    unsubscribe()

    mockSend.mockResolvedValueOnce({ Parameter: { Value: 'postgres://two' } })
    await revalidate(provider)

    expect(listener).not.toHaveBeenCalled()
  })
})
