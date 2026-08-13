import { describe, expect, it } from 'vitest'
import { PEOPLE_MODELS, createPeopleDbBase } from './peopleDbBase.util'
import type { PeopleDbPrismaClient, PeopleDbService } from './peopleDb.service'

// Guards the exact bug class this base was written to avoid: gp-api's own
// createPrismaBase binds passthrough methods once in onModuleInit, which is
// safe there because that Prisma client never gets swapped. PeopleDbService's
// client DOES get swapped on a database-URL rotation, so a passthrough must
// re-resolve `this.model` on every call. If a future edit reintroduces a
// bind-once pattern here, this test fails.
describe('createPeopleDbBase hot-swap passthrough resolution', () => {
  it('routes a passthrough call through whichever client is current, not a snapshot taken at onModuleInit time', async () => {
    const BaseVoterService = createPeopleDbBase(PEOPLE_MODELS.Voter)

    const clientA = {
      voter: { findMany: () => Promise.resolve('from-client-A') },
    } as unknown as PeopleDbPrismaClient

    const clientB = {
      voter: { findMany: () => Promise.resolve('from-client-B') },
    } as unknown as PeopleDbPrismaClient

    let currentClient = clientA
    const mockPeopleDb = {
      get instance() {
        return currentClient
      },
    } as unknown as PeopleDbService

    const service = new BaseVoterService()
    ;(service as unknown as { _peopleDb: PeopleDbService })._peopleDb =
      mockPeopleDb
    service.onModuleInit()

    await expect(service.findMany()).resolves.toBe('from-client-A')

    currentClient = clientB

    await expect(service.findMany()).resolves.toBe('from-client-B')
  })
})
