import { describe, expect, it, vi } from 'vitest'
import { createPrismaBase, MODELS } from './prisma.util'

const makeClient = (tag: string) => ({
  district: { findMany: vi.fn().mockReturnValue(tag) },
})

describe('createPrismaBase', () => {
  it('resolves model, client, and passthroughs against the live swapped client', () => {
    let active = makeClient('one')
    const fakePrisma = {
      get instance() {
        return active
      },
    }

    const Base = createPrismaBase(MODELS.District)
    // Bypass Nest DI: inject the fake PrismaService facade directly.
    const service = new Base() as unknown as {
      _prisma: unknown
      model: (typeof active)['district']
      client: typeof active
      findMany: () => string
      onModuleInit: () => void
    }
    service._prisma = fakePrisma
    service.onModuleInit()

    expect(service.model).toBe(active.district)
    expect(service.client).toBe(active)
    expect(service.findMany()).toBe('one')

    // Simulate a database-URL swap: the facade now points at a new client.
    active = makeClient('two')

    expect(service.model).toBe(active.district)
    expect(service.findMany()).toBe('two')
  })
})
