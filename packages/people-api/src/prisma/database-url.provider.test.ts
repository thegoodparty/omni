import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseUrlProvider } from './database-url.provider'

const mockSend = vi.fn()
const mockDestroy = vi.fn()

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class {
    send = mockSend
    destroy = mockDestroy
  },
  GetParameterCommand: class {
    constructor(public input: unknown) {}
  },
}))

const revalidate = (provider: DatabaseUrlProvider) =>
  (provider as unknown as { revalidate: () => Promise<void> }).revalidate()

describe('DatabaseUrlProvider', () => {
  let provider: DatabaseUrlProvider
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.LOCAL_DATABASE_URL
    delete process.env.OTEL_SERVICE_ENVIRONMENT
    provider = new DatabaseUrlProvider()
  })

  afterEach(() => {
    provider.onModuleDestroy()
    process.env = { ...originalEnv }
  })

  it('throws when accessed before initialization', () => {
    expect(() => provider.current).toThrow(/before initialization/)
  })

  it('uses LOCAL_DATABASE_URL without calling SSM', async () => {
    process.env.LOCAL_DATABASE_URL = 'postgres://local/db'
    await provider.onModuleInit()
    expect(provider.current).toBe('postgres://local/db')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('reads the env-specific SSM parameter with decryption', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    mockSend.mockResolvedValue({ Parameter: { Value: 'postgres://ssm/dev' } })
    await provider.onModuleInit()
    expect(provider.current).toBe('postgres://ssm/dev')
    const firstCall = mockSend.mock.calls[0]
    expect(firstCall?.[0].input).toEqual({
      Name: 'people-db-connection-string-dev',
      WithDecryption: true,
    })
  })

  it('throws when neither LOCAL_DATABASE_URL nor OTEL_SERVICE_ENVIRONMENT is set', async () => {
    await expect(provider.onModuleInit()).rejects.toThrow(/LOCAL_DATABASE_URL/)
  })

  it('throws when the SSM parameter has no value', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
    mockSend.mockResolvedValue({ Parameter: {} })
    await expect(provider.onModuleInit()).rejects.toThrow(/no value/)
  })

  it('notifies subscribers when the value changes on revalidation', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    mockSend.mockResolvedValueOnce({ Parameter: { Value: 'postgres://one' } })
    await provider.onModuleInit()

    const listener = vi.fn()
    provider.onChange(listener)

    mockSend.mockResolvedValueOnce({ Parameter: { Value: 'postgres://two' } })
    await revalidate(provider)

    expect(listener).toHaveBeenCalledWith('postgres://two')
    expect(provider.current).toBe('postgres://two')
  })

  it('does not notify when the value is unchanged', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    mockSend.mockResolvedValue({ Parameter: { Value: 'postgres://same' } })
    await provider.onModuleInit()

    const listener = vi.fn()
    provider.onChange(listener)
    await revalidate(provider)

    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps the last-known-good value when revalidation fails', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    mockSend.mockResolvedValueOnce({ Parameter: { Value: 'postgres://good' } })
    await provider.onModuleInit()

    const listener = vi.fn()
    provider.onChange(listener)

    mockSend.mockRejectedValueOnce(new Error('SSM throttled'))
    await revalidate(provider)

    expect(provider.current).toBe('postgres://good')
    expect(listener).not.toHaveBeenCalled()
  })

  it('closes the SSM client on destroy', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    mockSend.mockResolvedValue({ Parameter: { Value: 'postgres://one' } })
    await provider.onModuleInit()

    provider.onModuleDestroy()

    expect(mockDestroy).toHaveBeenCalled()
  })

  it('stops notifying after unsubscribe', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    mockSend.mockResolvedValueOnce({ Parameter: { Value: 'postgres://one' } })
    await provider.onModuleInit()

    const listener = vi.fn()
    const unsubscribe = provider.onChange(listener)
    unsubscribe()

    mockSend.mockResolvedValueOnce({ Parameter: { Value: 'postgres://two' } })
    await revalidate(provider)

    expect(listener).not.toHaveBeenCalled()
  })
})
