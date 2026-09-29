import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@/generated/election-prisma'
import { ElectionDbService } from './electionDb.service'

// vi.hoisted, not a plain const: vi.mock is lifted above the imports, so a
// factory closing over a normally-declared binding would read it before
// initialization.
const { connect, disconnect } = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
}))

// Only PrismaClient is replaced; the real `Prisma` namespace is kept so the
// error classes the service discriminates on are the genuine ones. Touching a
// real socket here would make the suite pay a connect timeout every run and
// leak an undisconnected client.
vi.mock('@/generated/election-prisma', async () => {
  const actual = await vi.importActual<
    typeof import('@/generated/election-prisma')
  >('@/generated/election-prisma')
  return {
    ...actual,
    PrismaClient: class {
      $connect = connect
      $disconnect = disconnect
      $on = vi.fn()
    },
  }
})

const DB_URL = 'postgresql://u:p@localhost:5432/election'

describe('ElectionDbService', () => {
  let service: ElectionDbService

  beforeEach(() => {
    connect.mockReset()
    connect.mockResolvedValue(undefined)
    disconnect.mockReset()
    process.env.ELECTION_DATABASE_URL = DB_URL
    service = new ElectionDbService()
  })

  it('throws rather than handing back an uninitialized client', () => {
    expect(() => service.instance).toThrow(/not initialized/)
  })

  it('points at the boot logs rather than blaming the URL outright', () => {
    expect(() => service.instance).toThrow(/boot logs/)
  })

  it('leaves the client unset when the URL is absent', async () => {
    delete process.env.ELECTION_DATABASE_URL
    await service.onModuleInit()
    expect(() => service.instance).toThrow(/not initialized/)
  })

  // An unreachable database is transient — Aurora was cold, the next query
  // reconnects — so discarding the client would leave election routes dead
  // for the whole process after one unlucky boot.
  it('keeps the client when the database is merely unreachable', async () => {
    connect.mockRejectedValue(
      new Prisma.PrismaClientInitializationError(
        "Can't reach database server",
        '6.19.3',
        'P1001',
      ),
    )
    await service.onModuleInit()
    expect(() => service.instance).not.toThrow()
  })

  // No error code means a packaging or configuration fault — a missing query
  // engine, an unparseable URL — which no retry can fix. Storing that client
  // is how a missing engine failed 116 E2E tests on specs that touch no
  // election data, each dying on the same opaque engine error rather than
  // the guard's message.
  it('discards the client when it can never work', async () => {
    connect.mockRejectedValue(
      new Prisma.PrismaClientInitializationError(
        'Prisma Client could not locate the Query Engine',
        '6.19.3',
      ),
    )
    await service.onModuleInit()
    expect(() => service.instance).toThrow(/not initialized/)
  })

  it('does not let a failed initialization take down boot', async () => {
    connect.mockRejectedValue(
      new Prisma.PrismaClientInitializationError('nope', '6.19.3'),
    )
    await expect(service.onModuleInit()).resolves.toBeUndefined()
  })
})
