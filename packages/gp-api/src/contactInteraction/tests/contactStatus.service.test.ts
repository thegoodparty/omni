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

  it('writes event + current state atomically; a second change records fromValue = first toValue', async () => {
    const org = await seedOrganization('campaign-atomic')

    await contactStatus.changeStatus({
      organizationSlug: org,
      personId: 'p-1',
      field: ContactStatusField.voter_likelihood,
      fromValue: 'unknown',
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

    await contactStatus.changeStatus({
      organizationSlug: org,
      personId: 'p-1',
      field: ContactStatusField.voter_likelihood,
      fromValue: 'super',
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

  it('isolates rows by organizationSlug for the same personId', async () => {
    const orgA = await seedOrganization('campaign-org-a')
    const orgB = await seedOrganization('campaign-org-b')

    await contactStatus.changeStatus({
      organizationSlug: orgA,
      personId: 'p-shared',
      field: ContactStatusField.support_status,
      fromValue: null,
      toValue: 'supporter',
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
    })
    await contactStatus.changeStatus({
      organizationSlug: orgB,
      personId: 'p-shared',
      field: ContactStatusField.support_status,
      fromValue: null,
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
      fromValue: null,
      toValue: 'super',
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
    })
    await contactStatus.changeStatus({
      organizationSlug: org,
      personId: 'p-likely',
      field: ContactStatusField.voter_likelihood,
      fromValue: null,
      toValue: 'likely',
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
    })
    await contactStatus.changeStatus({
      organizationSlug: org,
      personId: 'p-unlikely',
      field: ContactStatusField.voter_likelihood,
      fromValue: null,
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

  it('rejects a duplicate sourceId for the same org + field', async () => {
    const org = await seedOrganization('campaign-duplicate-source')
    await contactStatus.changeStatus({
      organizationSlug: org,
      personId: 'p-1',
      field: ContactStatusField.support_status,
      fromValue: null,
      toValue: 'supporter',
      source: ContactStatusSource.door_knock,
      actorUserId: null,
      sourceId: 'door-knock-event-1',
    })

    await expect(
      contactStatus.changeStatus({
        organizationSlug: org,
        personId: 'p-2',
        field: ContactStatusField.support_status,
        fromValue: null,
        toValue: 'non_supporter',
        source: ContactStatusSource.door_knock,
        actorUserId: null,
        sourceId: 'door-knock-event-1',
      }),
    ).rejects.toThrow()
  })

  it('does not collide on a null sourceId across manual events', async () => {
    const org = await seedOrganization('campaign-null-source')
    await contactStatus.changeStatus({
      organizationSlug: org,
      personId: 'p-1',
      field: ContactStatusField.voter_likelihood,
      fromValue: null,
      toValue: 'super',
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
    })
    await contactStatus.changeStatus({
      organizationSlug: org,
      personId: 'p-2',
      field: ContactStatusField.voter_likelihood,
      fromValue: null,
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
