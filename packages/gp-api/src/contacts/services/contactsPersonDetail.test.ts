import { useTestService } from '@/test-service'
import { ContactInteractionDoorKnockService } from '@/contactInteraction/services/contactInteractionDoorKnock.service'
import {
  DoorKnockOutcome,
  Organization,
  SupportAnswer,
} from '@/generated/prisma'
import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactsService } from './contacts.service'

const service = useTestService()

// Real Postgres + the real SupportStatusService derivation, through the real
// ContactsService.findPerson wiring — only the people-api HTTP call is
// mocked (external boundary). Mirrors the existing SQL-derivation coverage in
// contactInteraction/tests/supportStatus.service.test.ts, but proves the
// detail endpoint actually attaches the rollup and strips party for `eo-`
// orgs (ENG-10696), not just that the derivation itself is correct.
describe('ContactsService.findPerson — supportStatus + party (ENG-10696)', () => {
  let contactsService: ContactsService
  let doorKnocks: ContactInteractionDoorKnockService
  let httpService: HttpService
  let eoOrg: Organization

  const EO_SLUG = 'eo-person-detail'
  const PERSON_ID = 'person-detail-1'
  const DISTRICT_ID = 'district-person-detail-uuid'

  const mockPersonFetch = () => {
    vi.spyOn(httpService, 'get').mockReturnValue(
      of({
        data: {
          id: PERSON_ID,
          firstName: 'Jane',
          politicalParty: 'Independent',
        },
      }) as never,
    )
  }

  const knock = (occurredAt: Date, supportAnswer?: SupportAnswer) =>
    doorKnocks.create({
      organizationSlug: EO_SLUG,
      personId: PERSON_ID,
      occurredAt,
      outcome: supportAnswer
        ? DoorKnockOutcome.answered
        : DoorKnockOutcome.not_home,
      supportAnswer,
      manual: true,
    })

  beforeEach(async () => {
    contactsService = service.app.get(ContactsService)
    doorKnocks = service.app.get(ContactInteractionDoorKnockService)
    httpService = service.app.get(HttpService)

    eoOrg = await service.prisma.organization.create({
      data: {
        slug: EO_SLUG,
        ownerId: service.user.id,
        overrideDistrictId: DISTRICT_ID,
      },
    })
    mockPersonFetch()
  })

  it('reads unknown for a person with no interaction history', async () => {
    const person = await contactsService.findPerson(PERSON_ID, eoOrg)

    expect(person.supportStatus).toBe('unknown')
  })

  it('reads supporter when the latest door-knock supportAnswer is supporter', async () => {
    await knock(new Date('2026-06-01T12:00:00.000Z'), SupportAnswer.supporter)

    const person = await contactsService.findPerson(PERSON_ID, eoOrg)

    expect(person.supportStatus).toBe('supporter')
  })

  it('latest answer wins: supporter then non_supporter reads non_supporter', async () => {
    await knock(new Date('2026-06-01T12:00:00.000Z'), SupportAnswer.supporter)
    await knock(
      new Date('2026-06-05T12:00:00.000Z'),
      SupportAnswer.non_supporter,
    )

    const person = await contactsService.findPerson(PERSON_ID, eoOrg)

    expect(person.supportStatus).toBe('non_supporter')
  })

  it('rolls unsure up to unknown', async () => {
    await knock(new Date('2026-06-01T12:00:00.000Z'), SupportAnswer.unsure)

    const person = await contactsService.findPerson(PERSON_ID, eoOrg)

    expect(person.supportStatus).toBe('unknown')
  })

  it('strips politicalParty from the same eo- org detail response', async () => {
    const person = await contactsService.findPerson(PERSON_ID, eoOrg)

    expect(person).not.toHaveProperty('politicalParty')
  })
})
