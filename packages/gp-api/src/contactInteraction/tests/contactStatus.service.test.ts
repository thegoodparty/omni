import { useTestService } from '@/test-service'
import { ContactStatusField, ContactStatusSource } from '@/generated/prisma'
import { beforeEach, describe, expect, it } from 'vitest'
import { ContactStatusService } from '../services/contactStatus.service'

const service = useTestService()

describe('ContactStatusService', () => {
  let contactStatus: ContactStatusService

  const seedOrganization = async (slug: string) => {
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    return slug
  }

  beforeEach(() => {
    contactStatus = service.app.get(ContactStatusService)
  })

  it('writes event + current state atomically; a second change records fromValue = first toValue even with a stale fallback', async () => {
    const org = await seedOrganization('campaign-atomic')

    await contactStatus.changeStatus({
      organizationSlug: org,
      personId: 'p-1',
      field: ContactStatusField.voter_likelihood,
      fallbackFromValue: 'unknown',
      toValue: 'super',
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
    })

    const afterFirst = await contactStatus.currentStatusForPeople(
      org,
      ContactStatusField.voter_likelihood,
      ['p-1'],
    )
    expect(afterFirst.get('p-1')).toBe('super')

    // A row now exists for (org, personId, field), so the authoritative
    // fromValue must come from the row-locked read, not this deliberately
    // wrong fallback — proves the fallback is advisory-only once a row exists.
    await contactStatus.changeStatus({
      organizationSlug: org,
      personId: 'p-1',
      field: ContactStatusField.voter_likelihood,
      fallbackFromValue: 'unlikely',
      toValue: 'unlikely',
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
    })

    const events = await service.prisma.contactStatusEvent.findMany({
      where: { organizationSlug: org, personId: 'p-1' },
      orderBy: { createdAt: 'asc' },
    })
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ fromValue: 'unknown', toValue: 'super' })
    expect(events[1]).toMatchObject({ fromValue: 'super', toValue: 'unlikely' })

    const afterSecond = await contactStatus.currentStatusForPeople(
      org,
      ContactStatusField.voter_likelihood,
      ['p-1'],
    )
    expect(afterSecond.get('p-1')).toBe('unlikely')

    const current = await service.prisma.contactCurrentStatus.findMany({
      where: { organizationSlug: org, personId: 'p-1' },
    })
    expect(current).toHaveLength(1)
    expect(current[0]?.value).toBe('unlikely')
  })

  // Directly proves the ENG-10833/34 race fix: the authoritative fromValue
  // is read from the DB row inside changeStatus's own transaction, not
  // trusted from the caller's (unlocked, possibly stale) snapshot. A caller
  // racing another writer would otherwise pass a value that's already gone
  // stale by the time changeStatus runs.
  it('derives fromValue from the locked current-state row, ignoring a stale caller-supplied fallback', async () => {
    const org = await seedOrganization('campaign-locked-read')
    await service.prisma.contactCurrentStatus.create({
      data: {
        organizationSlug: org,
        personId: 'p-1',
        field: ContactStatusField.voter_likelihood,
        value: 'likely',
      },
    })

    await contactStatus.changeStatus({
      organizationSlug: org,
      personId: 'p-1',
      field: ContactStatusField.voter_likelihood,
      // Stale on purpose: a caller that read this before another writer's
      // change would see 'unknown', but the real current value is 'likely'.
      fallbackFromValue: 'unknown',
      toValue: 'super',
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
    })

    const event = await service.prisma.contactStatusEvent.findFirstOrThrow({
      where: { organizationSlug: org, personId: 'p-1' },
    })
    expect(event.fromValue).toBe('likely')
    expect(event.toValue).toBe('super')
  })

  // The scenario the bug report described: two PATCHes racing on the same
  // (org, personId, field) with no override yet, each carrying its own
  // (identical, now-stale-once-the-other-lands) fallback snapshot. Exactly
  // one event must record the seed as fromValue; the second must chain off
  // the first's toValue, never off the shared stale fallback.
  it('serializes two concurrent first-writes for the same (org, personId, field)', async () => {
    const org = await seedOrganization('campaign-concurrent-first-write')

    const [first, second] = await Promise.all([
      contactStatus.changeStatus({
        organizationSlug: org,
        personId: 'p-1',
        field: ContactStatusField.voter_likelihood,
        fallbackFromValue: 'unknown',
        toValue: 'super',
        source: ContactStatusSource.manual,
        actorUserId: service.user.id,
      }),
      contactStatus.changeStatus({
        organizationSlug: org,
        personId: 'p-1',
        field: ContactStatusField.voter_likelihood,
        fallbackFromValue: 'unknown',
        toValue: 'likely',
        source: ContactStatusSource.manual,
        actorUserId: service.user.id,
      }),
    ])

    // createdAt has millisecond precision, so two racing commits can tie —
    // assert order-independent invariants instead of sorting by createdAt.
    const events = await service.prisma.contactStatusEvent.findMany({
      where: { organizationSlug: org, personId: 'p-1' },
    })
    expect(events).toHaveLength(2)
    const seedEvent = events.find((e) => e.fromValue === 'unknown')
    const chainedEvent = events.find((e) => e.fromValue !== 'unknown')
    expect(seedEvent).toBeDefined()
    // The second writer to actually commit must chain off the first
    // writer's toValue — never re-record the shared 'unknown' fallback.
    expect(chainedEvent?.fromValue).toBe(seedEvent?.toValue)

    const current = await contactStatus.currentStatusForPeople(
      org,
      ContactStatusField.voter_likelihood,
      ['p-1'],
    )
    // The chaining event committed last by construction; the current value
    // must reflect it. Both in-memory results reflect a committed event.
    expect([first, second].filter((e) => e !== null)).toHaveLength(2)
    expect(current.get('p-1')).toBe(chainedEvent?.toValue)
  })

  it('isolates rows by organizationSlug for the same personId', async () => {
    const orgA = await seedOrganization('campaign-org-a')
    const orgB = await seedOrganization('campaign-org-b')

    await contactStatus.changeStatus({
      organizationSlug: orgA,
      personId: 'p-shared',
      field: ContactStatusField.support_status,
      fallbackFromValue: null,
      toValue: 'supporter',
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
    })
    await contactStatus.changeStatus({
      organizationSlug: orgB,
      personId: 'p-shared',
      field: ContactStatusField.support_status,
      fallbackFromValue: null,
      toValue: 'non_supporter',
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
    })

    const statusesA = await contactStatus.currentStatusForPeople(
      orgA,
      ContactStatusField.support_status,
      ['p-shared'],
    )
    const statusesB = await contactStatus.currentStatusForPeople(
      orgB,
      ContactStatusField.support_status,
      ['p-shared'],
    )
    expect(statusesA.get('p-shared')).toBe('supporter')
    expect(statusesB.get('p-shared')).toBe('non_supporter')

    expect(
      await contactStatus.personIdsByFieldValue(
        orgA,
        ContactStatusField.support_status,
        ['supporter'],
      ),
    ).toEqual(['p-shared'])
    expect(
      await contactStatus.personIdsByFieldValue(
        orgB,
        ContactStatusField.support_status,
        ['supporter'],
      ),
    ).toEqual([])
  })

  it('personIdsByFieldValue returns the union across multiple values', async () => {
    const org = await seedOrganization('campaign-union')
    await contactStatus.changeStatus({
      organizationSlug: org,
      personId: 'p-super',
      field: ContactStatusField.voter_likelihood,
      fallbackFromValue: null,
      toValue: 'super',
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
    })
    await contactStatus.changeStatus({
      organizationSlug: org,
      personId: 'p-likely',
      field: ContactStatusField.voter_likelihood,
      fallbackFromValue: null,
      toValue: 'likely',
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
    })
    await contactStatus.changeStatus({
      organizationSlug: org,
      personId: 'p-unlikely',
      field: ContactStatusField.voter_likelihood,
      fallbackFromValue: null,
      toValue: 'unlikely',
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
    })

    const result = await contactStatus.personIdsByFieldValue(
      org,
      ContactStatusField.voter_likelihood,
      ['super', 'likely'],
    )
    expect(result.sort()).toEqual(['p-likely', 'p-super'])
  })

  it('personIdsByFieldValue returns empty without querying for empty values', async () => {
    const org = await seedOrganization('campaign-empty-values')
    expect(
      await contactStatus.personIdsByFieldValue(
        org,
        ContactStatusField.voter_likelihood,
        [],
      ),
    ).toEqual([])
  })

  // ENG-10841: a re-synced/replayed activity event (e.g. the door-knocking
  // tool retrying a dead-zone sync) must not fail the caller's write. The
  // unique (organizationSlug, field, sourceId) still enforces "exactly one
  // event per sourceId" at the DB — attemptChangeStatus just resolves that
  // conflict to a no-op instead of propagating the Prisma error.
  it('no-ops a duplicate sourceId for the same org + field, leaving the first record untouched', async () => {
    const org = await seedOrganization('campaign-duplicate-source')
    await contactStatus.changeStatus({
      organizationSlug: org,
      personId: 'p-1',
      field: ContactStatusField.support_status,
      fallbackFromValue: null,
      toValue: 'supporter',
      source: ContactStatusSource.door_knock,
      actorUserId: null,
      sourceId: 'door-knock-event-1',
    })

    const result = await contactStatus.changeStatus({
      organizationSlug: org,
      personId: 'p-2',
      field: ContactStatusField.support_status,
      fallbackFromValue: null,
      toValue: 'non_supporter',
      source: ContactStatusSource.door_knock,
      actorUserId: null,
      sourceId: 'door-knock-event-1',
    })

    expect(result).toBeNull()
    const events = await service.prisma.contactStatusEvent.findMany({
      where: { organizationSlug: org, sourceId: 'door-knock-event-1' },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ personId: 'p-1', toValue: 'supporter' })
    // The no-op'd second call must not have created a current-status row for
    // p-2 either — nothing about it should have persisted.
    const p2Status = await contactStatus.currentStatusForPeople(
      org,
      ContactStatusField.support_status,
      ['p-2'],
    )
    expect(p2Status.get('p-2')).toBeUndefined()
  })

  it('does not collide on a null sourceId across manual events', async () => {
    const org = await seedOrganization('campaign-null-source')
    await contactStatus.changeStatus({
      organizationSlug: org,
      personId: 'p-1',
      field: ContactStatusField.voter_likelihood,
      fallbackFromValue: null,
      toValue: 'super',
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
    })
    await contactStatus.changeStatus({
      organizationSlug: org,
      personId: 'p-2',
      field: ContactStatusField.voter_likelihood,
      fallbackFromValue: null,
      toValue: 'likely',
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
    })

    const events = await service.prisma.contactStatusEvent.findMany({
      where: { organizationSlug: org },
    })
    expect(events).toHaveLength(2)
  })
})
