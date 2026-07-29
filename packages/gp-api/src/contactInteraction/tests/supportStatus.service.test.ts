import { useTestService } from '@/test-service'
import {
  ContactStatusField,
  ContactStatusSource,
  DoorKnockOutcome,
  SupportAnswer,
} from '@/generated/prisma'
import { beforeEach, describe, expect, it } from 'vitest'
import { ContactInteractionDoorKnockService } from '../services/contactInteractionDoorKnock.service'
import { ContactStatusService } from '../services/contactStatus.service'
import { SupportStatusService } from '../services/supportStatus.service'
import { SUPPORT_ANSWER_ROLLUP } from '../contactInteraction.types'

const service = useTestService()

describe('SupportStatusService', () => {
  let doorKnocks: ContactInteractionDoorKnockService
  let supportStatus: SupportStatusService
  let contactStatus: ContactStatusService

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

  const override = (
    organizationSlug: string,
    personId: string,
    toValue: string,
  ) =>
    contactStatus.changeStatus({
      organizationSlug,
      personId,
      field: ContactStatusField.support_status,
      toValue,
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
      fallbackFromValue: null,
    })

  beforeEach(() => {
    doorKnocks = service.app.get(ContactInteractionDoorKnockService)
    supportStatus = service.app.get(SupportStatusService)
    contactStatus = service.app.get(ContactStatusService)
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

  describe('personIdsByEffectiveStatus (ENG-10837, override-aware)', () => {
    it('returns empty without querying for empty rollups', async () => {
      const org = await seedOrganization('campaign-effective-empty')
      expect(await supportStatus.personIdsByEffectiveStatus(org, [])).toEqual(
        [],
      )
    })

    it('undecided/refused resolve exactly to the manually-overridden persons (no derivation exists for them)', async () => {
      const org = await seedOrganization('campaign-effective-override-only')
      await override(org, 'p-undecided', 'undecided')
      await override(org, 'p-refused', 'refused')
      // A derived supporter must never leak into an override-only bucket.
      await knock(
        org,
        'p-sup',
        new Date('2026-06-01T12:00:00.000Z'),
        SupportAnswer.supporter,
      )

      expect(
        (
          await supportStatus.personIdsByEffectiveStatus(org, ['undecided'])
        ).sort(),
      ).toEqual(['p-undecided'])
      expect(
        (
          await supportStatus.personIdsByEffectiveStatus(org, ['refused'])
        ).sort(),
      ).toEqual(['p-refused'])
    })

    it('a derived supporter overridden to undecided appears only under undecided, not supporter', async () => {
      const org = await seedOrganization('campaign-effective-override-wins')
      await knock(
        org,
        'p-flip',
        new Date('2026-06-01T12:00:00.000Z'),
        SupportAnswer.supporter,
      )
      await override(org, 'p-flip', 'undecided')

      expect(
        await supportStatus.personIdsByEffectiveStatus(org, ['supporter']),
      ).toEqual([])
      expect(
        await supportStatus.personIdsByEffectiveStatus(org, ['undecided']),
      ).toEqual(['p-flip'])
    })

    it('supporter = derived supporters plus override-supporters, minus persons overridden away from supporter', async () => {
      const org = await seedOrganization('campaign-effective-supporter-union')
      // Derived supporter, no override — counts.
      await knock(
        org,
        'p-derived-sup',
        new Date('2026-06-01T12:00:00.000Z'),
        SupportAnswer.supporter,
      )
      // Derived non-supporter, manually overridden to supporter — counts via
      // the override.
      await knock(
        org,
        'p-override-sup',
        new Date('2026-06-01T12:00:00.000Z'),
        SupportAnswer.non_supporter,
      )
      await override(org, 'p-override-sup', 'supporter')
      // Derived supporter, but overridden away to non_supporter — must be
      // excluded even though derivation alone would include it.
      await knock(
        org,
        'p-overridden-away',
        new Date('2026-06-01T12:00:00.000Z'),
        SupportAnswer.supporter,
      )
      await override(org, 'p-overridden-away', 'non_supporter')

      const result = await supportStatus.personIdsByEffectiveStatus(org, [
        'supporter',
      ])
      expect(result.sort()).toEqual(['p-derived-sup', 'p-override-sup'])
    })
  })
})
