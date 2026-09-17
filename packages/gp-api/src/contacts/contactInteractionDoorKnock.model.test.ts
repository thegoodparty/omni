import { describe, expect, it } from 'vitest'
import { DoorKnockOutcome, SupportAnswer } from '../generated/prisma'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { useTestService } from '@/test-service'

const service = useTestService()

describe('ContactInteractionDoorKnock model', () => {
  it('rejects a duplicate (organizationSlug, sourceId)', async () => {
    const org = await service.prisma.organization.create({
      data: { slug: 'crm-dk-idempotency', ownerId: service.user.id },
    })
    const data = {
      organizationSlug: org.slug,
      personId: 'person-1',
      occurredAt: new Date(),
      outcome: DoorKnockOutcome.answered,
      supportAnswer: SupportAnswer.supporter,
      sourceId: 'route-1-interaction-1',
    }
    await service.prisma.contactInteractionDoorKnock.create({ data })

    const secondCreate = service.prisma.contactInteractionDoorKnock
      .create({ data: { ...data, personId: 'person-2' } })
      .then(() => null)
      .catch((err: Error) => err)

    expect(isUniqueConstraintError(await secondCreate)).toBe(true)
  })

  it('nulls actorUserId on user deletion without dropping the row', async () => {
    const org = await service.prisma.organization.create({
      data: { slug: 'crm-dk-actor-setnull', ownerId: service.user.id },
    })
    const actor = await service.prisma.user.create({
      data: { clerkId: 'dk-actor-to-delete', email: 'dk-actor@goodparty.org' },
    })
    const row = await service.prisma.contactInteractionDoorKnock.create({
      data: {
        organizationSlug: org.slug,
        personId: 'person-1',
        occurredAt: new Date(),
        outcome: DoorKnockOutcome.answered,
        supportAnswer: SupportAnswer.supporter,
        actorUserId: actor.id,
      },
    })

    await service.prisma.user.delete({ where: { id: actor.id } })

    const after =
      await service.prisma.contactInteractionDoorKnock.findUniqueOrThrow({
        where: { id: row.id },
      })
    expect(after.actorUserId).toBeNull()
  })
})
