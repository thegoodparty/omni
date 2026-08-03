import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PeopleDbService } from './peopleDb.service'
import { PeopleDbUrlProvider } from './peopleDbUrl.provider'

const { prismaClientCtor, mockConnect, mockDisconnect, mockOn } = vi.hoisted(
  () => ({
    prismaClientCtor: vi.fn(),
    mockConnect: vi.fn().mockResolvedValue(undefined),
    mockDisconnect: vi.fn().mockResolvedValue(undefined),
    mockOn: vi.fn(),
  }),
)

interface MockClientOptions {
  datasources: { peopleDb: { url: string } }
}

vi.mock('../generated/people-prisma', () => ({
  PrismaClient: class {
    constructor(options: MockClientOptions) {
      prismaClientCtor(options)
    }

    $connect = mockConnect
    $disconnect = mockDisconnect
    $on = mockOn
  },
}))

const mockUrlProvider = (initialUrl: string) => {
  const provider = new PeopleDbUrlProvider()
  let listener: ((url: string) => void) | null = null
  vi.spyOn(provider, 'ensureLoaded').mockResolvedValue(initialUrl)
  vi.spyOn(provider, 'onChange').mockImplementation((cb) => {
    listener = cb
    return () => {
      listener = null
    }
  })
  const emitChange = (url: string) => listener?.(url)
  return { provider, emitChange }
}

const builtUrl = (callIndex: number) => {
  const options = prismaClientCtor.mock.calls[callIndex]?.[0] as
    | MockClientOptions
    | undefined
  return new URL(options?.datasources.peopleDb.url ?? '')
}

describe('PeopleDbService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds and connects a client on init, exposed via .instance', async () => {
    const { provider } = mockUrlProvider('postgresql://u:p@h:5432/a')
    const service = new PeopleDbService(provider)

    await service.onModuleInit()

    expect(prismaClientCtor).toHaveBeenCalledTimes(1)
    expect(mockConnect).toHaveBeenCalledTimes(1)
    expect(service.instance).toBeDefined()
  })

  it('does not throw or block init when the initial connect fails', async () => {
    mockConnect.mockRejectedValueOnce(new Error('connection refused'))
    const { provider } = mockUrlProvider('postgresql://u:p@h:5432/a')
    const service = new PeopleDbService(provider)

    await service.onModuleInit()

    expect(service.instance).toBeDefined()
  })

  it('does not reject onModuleInit when ensureLoaded rejects (satellite dep must not crash boot)', async () => {
    const provider = new PeopleDbUrlProvider()
    vi.spyOn(provider, 'ensureLoaded').mockRejectedValue(
      new Error('SSM parameter unresolved'),
    )
    const service = new PeopleDbService(provider)

    await expect(service.onModuleInit()).resolves.toBeUndefined()
    expect(prismaClientCtor).not.toHaveBeenCalled()
  })

  it('subscribes to url changes even when the initial load fails, and recovers on change', async () => {
    const provider = new PeopleDbUrlProvider()
    let listener: ((url: string) => void) | null = null
    vi.spyOn(provider, 'ensureLoaded').mockRejectedValue(
      new Error('SSM parameter unresolved'),
    )
    const onChange = vi.spyOn(provider, 'onChange').mockImplementation((cb) => {
      listener = cb
      return () => {
        listener = null
      }
    })
    const service = new PeopleDbService(provider)

    await service.onModuleInit()

    // Boot failed to build a client, but the listener MUST be registered so
    // the provider's later refresh can recover it.
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(prismaClientCtor).not.toHaveBeenCalled()

    // The URL becomes resolvable -> swap builds the client from scratch.
    listener!('postgresql://u:p@h:5432/recovered')
    await vi.waitFor(() => expect(service.instance).toBeDefined())
    expect(prismaClientCtor).toHaveBeenCalledTimes(1)
  })

  it('throws a clear error from .instance when the client was never initialized', () => {
    const provider = new PeopleDbUrlProvider()
    vi.spyOn(provider, 'ensureLoaded').mockRejectedValue(
      new Error('SSM parameter unresolved'),
    )
    const service = new PeopleDbService(provider)

    expect(() => service.instance).toThrow(
      'people-db client not initialized — PEOPLE_DATABASE_URL / SSM parameter is unresolved',
    )
  })

  it('applies the pool params to the built connection url', async () => {
    const { provider } = mockUrlProvider('postgresql://u:p@h:5432/a')
    const service = new PeopleDbService(provider)

    await service.onModuleInit()

    const url = builtUrl(0)
    expect(url.searchParams.get('connection_limit')).toBe('50')
    expect(url.searchParams.get('pool_timeout')).toBe('5')
    expect(url.searchParams.get('connect_timeout')).toBe('5')
    expect(url.searchParams.get('socket_timeout')).toBe('60')
  })

  it('rebuilds the client when the url provider reports a change', async () => {
    const { provider, emitChange } = mockUrlProvider(
      'postgresql://u:p@h:5432/a',
    )
    const service = new PeopleDbService(provider)
    await service.onModuleInit()
    const first = service.instance

    emitChange('postgresql://u:p@h:5432/b')
    // The old client's $disconnect is only fired after activeClient has been
    // reassigned, so waiting on it (rather than the ctor call count, which
    // ticks up synchronously before the swap's reassignment completes) avoids
    // a race with the in-flight swap.
    await vi.waitFor(() => expect(mockDisconnect).toHaveBeenCalledTimes(1))

    expect(service.instance).not.toBe(first)
    expect(builtUrl(1).hostname).toBe('h')
    expect(builtUrl(1).pathname).toBe('/b')
    expect(mockDisconnect).toHaveBeenCalledTimes(1)
  })

  it('disconnects the active client on module destroy', async () => {
    const { provider } = mockUrlProvider('postgresql://u:p@h:5432/a')
    const service = new PeopleDbService(provider)
    await service.onModuleInit()

    await service.onModuleDestroy()

    expect(mockDisconnect).toHaveBeenCalledTimes(1)
  })
})
