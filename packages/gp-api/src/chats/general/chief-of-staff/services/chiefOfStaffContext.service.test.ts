import { describe, expect, it, vi } from 'vitest'
import { ChatScope } from '@/generated/prisma'
import { ChiefOfStaffContextService } from './chiefOfStaffContext.service'
import type { PrioritiesToolPort } from './prioritiesPort'

const CONVERSATION = {
  id: 'conv-b',
  organizationSlug: 'org-1',
  anchor: null,
}

const ELECTED_OFFICE = {
  id: 'office-1',
  organizationSlug: 'org-1',
  organization: { slug: 'org-1', customPositionName: 'City Council Member' },
  user: { firstName: 'Kim', lastName: 'Roney' },
  swornInDate: null,
  party: null,
  electedDate: null,
  termStartDate: null,
  termEndDate: null,
}

const port: PrioritiesToolPort = {
  listActive: async () => [],
} as unknown as PrioritiesToolPort

// The service's Prisma plumbing is bound at runtime, so stub the two reads the
// loader makes and capture the args of the count that decides first-run.
type CountWhere = Record<string, unknown>

const serviceWith = (priorCount: number) => {
  const seen: CountWhere[] = []
  const count = vi.fn(async (args: { where: CountWhere }) => {
    seen.push(args.where)
    return priorCount
  })
  const service = new ChiefOfStaffContextService()
  Object.assign(service, {
    findFirst: async () => CONVERSATION,
    count,
    // `client` is a getter over `_prisma`, so stub the backing field.
    _prisma: { electedOffice: { findFirst: async () => ELECTED_OFFICE } },
  })
  return { service, seen }
}

describe('ChiefOfStaffContextService first-run detection', () => {
  it('counts prior conversations that hold a message, not bare rows', async () => {
    const { service, seen } = serviceWith(0)
    await service.load('conv-b', 7, port)

    const where = seen[0]
    // Excludes the current conversation, so the check does not depend on
    // whether this row is already persisted.
    expect(where).toMatchObject({ id: { not: 'conv-b' } })
    // Requires a message, so an empty row from a retried POST /chats does
    // not make a first-time user look like a returning one.
    expect(where).toMatchObject({ messages: { some: {} } })
    expect(where).toMatchObject({
      ownerUserId: 7,
      scope: ChatScope.chief_of_staff,
      organizationSlug: 'org-1',
      deletedAt: null,
    })
  })

  // A null slug would make Prisma match every null-slug conversation rather
  // than none, permanently suppressing first-run for that user.
  it('coalesces a null organizationSlug the way the office lookup does', async () => {
    const { service, seen } = serviceWith(0)
    Object.assign(service, {
      findFirst: async () => ({ ...CONVERSATION, organizationSlug: null }),
    })
    await service.load('conv-b', 7, port)
    expect(seen[0]).toMatchObject({ organizationSlug: '' })
  })

  it('treats no prior conversation with a message as the first', async () => {
    const { service } = serviceWith(0)
    const ctx = await service.load('conv-b', 7, port)
    expect(ctx.isFirstConversation).toBe(true)
  })

  it('treats an earlier conversation with a message as returning', async () => {
    const { service } = serviceWith(1)
    const ctx = await service.load('conv-b', 7, port)
    expect(ctx.isFirstConversation).toBe(false)
  })
})
