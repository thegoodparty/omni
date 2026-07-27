import { useTestService } from '@/test-service'
import { DoorKnockOutcome, SupportAnswer } from '@/generated/prisma'
import { beforeEach, describe, expect, it } from 'vitest'
import { ContactInteractionDoorKnockService } from '../services/contactInteractionDoorKnock.service'
import { SupportStatusService } from '../services/supportStatus.service'
import { SUPPORT_ANSWER_ROLLUP } from '../contactInteraction.types'

const service = useTestService()

describe('SupportStatusService', () => {
  let doorKnocks: ContactInteractionDoorKnockService
  let supportStatus: SupportStatusService

  const seedOrganization = async (slug: string) => {
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    return slug
  }

  const knock = (
    organizationSlug: string,
    personId: string,
    occurredAt: Date,
    supportAnswer?: SupportAnswer,
  ) =>
    doorKnocks.create({
      organizationSlug,
      personId,
      occurredAt,
      outcome: supportAnswer
        ? DoorKnockOutcome.answered
        : DoorKnockOutcome.not_home,
      supportAnswer,
      manual: true,
    })

  beforeEach(() => {
    doorKnocks = service.app.get(ContactInteractionDoorKnockService)
    supportStatus = service.app.get(SupportStatusService)
  })

  it('latest answered row wins over an older answer', async () => {
    const org = await seedOrganization('campaign-latest-wins')
    await knock(
      org,
      'p-1',
      new Date('2026-06-01T12:00:00.000Z'),
      SupportAnswer.supporter,
    )
    await knock(
      org,
      'p-1',
      new Date('2026-06-05T12:00:00.000Z'),
      SupportAnswer.non_supporter,
    )

    const statuses = await supportStatus.statusForPeople(org, ['p-1'])
    expect(statuses.get('p-1')).toBe('non_supporter')
  })

  it('rolls unsure up to unknown', async () => {
    const org = await seedOrganization('campaign-unsure')
    await knock(
      org,
      'p-1',
      new Date('2026-06-01T12:00:00.000Z'),
      SupportAnswer.unsure,
    )

    const statuses = await supportStatus.statusForPeople(org, ['p-1'])
    expect(statuses.get('p-1')).toBe('unknown')
  })

  it('a newer null-answer row never overrides an older answer', async () => {
    const org = await seedOrganization('campaign-null-ignored')
    await knock(
      org,
      'p-1',
      new Date('2026-06-01T12:00:00.000Z'),
      SupportAnswer.supporter,
    )
    await knock(org, 'p-1', new Date('2026-06-09T12:00:00.000Z'))

    const statuses = await supportStatus.statusForPeople(org, ['p-1'])
    expect(statuses.get('p-1')).toBe('supporter')
  })

  it('maps people with no rows at all to unknown', async () => {
    const org = await seedOrganization('campaign-no-rows')

    const statuses = await supportStatus.statusForPeople(org, ['p-ghost'])
    expect(statuses.get('p-ghost')).toBe('unknown')
    expect(statuses.size).toBe(1)
  })

  it('returns empty results for empty inputs', async () => {
    const org = await seedOrganization('campaign-empty-inputs')

    expect(await supportStatus.statusForPeople(org, [])).toEqual(new Map())
    expect(await supportStatus.personIdsByStatus(org, [])).toEqual([])
  })

  it('derives independently per org for the same person id', async () => {
    const campaignOrg = await seedOrganization('campaign-both-modes')
    const eoOrg = await seedOrganization('eo-both-modes')
    const occurredAt = new Date('2026-06-01T12:00:00.000Z')
    await knock(campaignOrg, 'p-shared', occurredAt, SupportAnswer.supporter)
    await knock(eoOrg, 'p-shared', occurredAt, SupportAnswer.non_supporter)

    const campaignStatuses = await supportStatus.statusForPeople(campaignOrg, [
      'p-shared',
    ])
    const eoStatuses = await supportStatus.statusForPeople(eoOrg, ['p-shared'])
    expect(campaignStatuses.get('p-shared')).toBe('supporter')
    expect(eoStatuses.get('p-shared')).toBe('non_supporter')

    expect(
      await supportStatus.personIdsByStatus(campaignOrg, ['supporter']),
    ).toEqual(['p-shared'])
    expect(await supportStatus.personIdsByStatus(eoOrg, ['supporter'])).toEqual(
      [],
    )
  })

  it('filter resolution agrees with display on seeded histories', async () => {
    const org = await seedOrganization('eo-agreement')
    await knock(
      org,
      'p-sup',
      new Date('2026-06-01T12:00:00.000Z'),
      SupportAnswer.supporter,
    )
    await knock(
      org,
      'p-flip',
      new Date('2026-06-01T12:00:00.000Z'),
      SupportAnswer.non_supporter,
    )
    await knock(
      org,
      'p-flip',
      new Date('2026-06-04T12:00:00.000Z'),
      SupportAnswer.supporter,
    )
    await knock(
      org,
      'p-non',
      new Date('2026-06-02T12:00:00.000Z'),
      SupportAnswer.non_supporter,
    )
    await knock(
      org,
      'p-uns',
      new Date('2026-06-03T12:00:00.000Z'),
      SupportAnswer.unsure,
    )
    await knock(org, 'p-null', new Date('2026-06-03T12:00:00.000Z'))

    const seeded = ['p-sup', 'p-flip', 'p-non', 'p-uns', 'p-null']
    const statuses = await supportStatus.statusForPeople(org, seeded)
    const byRollup = (rollup: string) =>
      seeded.filter((personId) => statuses.get(personId) === rollup).sort()

    const supporters = await supportStatus.personIdsByStatus(org, ['supporter'])
    expect(supporters.sort()).toEqual(byRollup('supporter'))
    expect(supporters.sort()).toEqual(['p-flip', 'p-sup'])

    const nonSupporters = await supportStatus.personIdsByStatus(org, [
      'non_supporter',
    ])
    expect(nonSupporters.sort()).toEqual(byRollup('non_supporter'))

    const unknowns = await supportStatus.personIdsByStatus(org, ['unknown'])
    expect(unknowns.sort()).toEqual(byRollup('unknown'))
    expect(unknowns.sort()).toEqual(['p-null', 'p-uns'])

    const multi = await supportStatus.personIdsByStatus(org, [
      'supporter',
      'non_supporter',
    ])
    expect(multi.sort()).toEqual(['p-flip', 'p-non', 'p-sup'])
  })

  it('breaks identical occurredAt ties deterministically by id', async () => {
    const org = await seedOrganization('campaign-tiebreak')
    const occurredAt = new Date('2026-06-01T12:00:00.000Z')
    const first = await knock(org, 'p-1', occurredAt, SupportAnswer.supporter)
    const second = await knock(
      org,
      'p-1',
      occurredAt,
      SupportAnswer.non_supporter,
    )

    const expected =
      first.id > second.id
        ? SUPPORT_ANSWER_ROLLUP[SupportAnswer.supporter]
        : SUPPORT_ANSWER_ROLLUP[SupportAnswer.non_supporter]

    const statuses = await supportStatus.statusForPeople(org, ['p-1'])
    expect(statuses.get('p-1')).toBe(expected)
    expect(await supportStatus.personIdsByStatus(org, [expected])).toEqual([
      'p-1',
    ])
  })
})
