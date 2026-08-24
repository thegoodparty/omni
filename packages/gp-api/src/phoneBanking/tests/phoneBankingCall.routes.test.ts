import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Person } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { SupportStatusService } from '@/contactInteraction/services/supportStatus.service'
import {
  Campaign,
  ContactStatusField,
  ContactStatusSource,
  OutreachStatus,
  VoterFileFilter,
} from '../../generated/prisma'

const service = useTestService()

const DISTRICT_ID = '457a1cd7-4184-f823-49d3-f207af693521'

const PEOPLE_PAGINATION = {
  totalResults: 0,
  currentPage: 1,
  pageSize: 1000,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
}

const fakePerson = (overrides: Partial<Person> = {}): Person => ({
  id: randomUUID(),
  lalVoterId: `LAL-${randomUUID()}`,
  firstName: 'Jane',
  middleName: null,
  lastName: 'Voter',
  nameSuffix: null,
  age: 42,
  state: 'WY',
  address: {
    line1: '123 Main St',
    line2: null,
    city: 'Cheyenne',
    state: 'WY',
    zip: '82001',
    zipPlus4: null,
    latitude: null,
    longitude: null,
  },
  cellPhone: '3075550001',
  landline: null,
  gender: null,
  politicalParty: 'Independent',
  registeredVoter: 'Yes',
  estimatedIncomeAmount: null,
  voterStatus: null,
  maritalStatus: null,
  hasChildrenUnder18: null,
  veteranStatus: null,
  homeowner: null,
  businessOwner: null,
  levelOfEducation: null,
  ethnicityGroup: null,
  language: 'English',
  ...overrides,
})

const mockPeoplePage = (people: Person[]) =>
  vi
    .spyOn(service.app.get(VoterQueryService), 'findPeople')
    .mockResolvedValue({ pagination: PEOPLE_PAGINATION, people })

describe('phone banking call outcome routes', () => {
  let orgSlug: string
  let campaign: Campaign
  let filter: VoterFileFilter

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    orgSlug = `campaign-pbc-${suffix}`
    await service.prisma.organization.create({
      data: {
        slug: orgSlug,
        ownerId: service.user.id,
        overrideDistrictId: DISTRICT_ID,
      },
    })
    campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `pbc-campaign-${suffix}`,
        organizationSlug: orgSlug,
        isPro: true,
      },
    })
    filter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: orgSlug, name: 'PB calls audience' },
    })
  })

  const orgHeaders = (slug = orgSlug) => ({
    headers: { 'x-organization-slug': slug },
  })

  const buildBody = (overrides: Record<string, unknown> = {}) => ({
    name: 'Tuesday calls',
    script: 'Hi, this is a volunteer calling about the election.',
    sheetCount: 1,
    voterFileFilterId: filter.id,
    purpose: 'introduce',
    ...overrides,
  })

  // Builds a one-entry list whose persons share `phone` (a household).
  const buildList = async (persons: { firstName: string }[], phone: string) => {
    mockPeoplePage(
      persons.map((person, index) =>
        fakePerson({
          id: randomUUID(),
          firstName: person.firstName,
          lastName: `H${index}`,
          cellPhone: phone,
        }),
      ),
    )
    const res = await service.client.post(
      '/v1/phone-banking/lists',
      buildBody(),
      orgHeaders(),
    )
    expect(res.status).toBe(201)
    const entry = await service.prisma.phoneBankingListEntry.findFirstOrThrow({
      where: { phoneBankingListId: res.data.id },
      include: { persons: true },
    })
    return { listId: res.data.id, outreachId: res.data.outreachId, entry }
  }

  const postCall = (listId: number, body: Record<string, unknown>) =>
    service.client.post(`/v1/phone-banking/lists/${listId}/calls`, body, {
      ...orgHeaders(),
      validateStatus: () => true,
    })

  describe('answered', () => {
    it('400s an answered call with no personId', async () => {
      const { listId, entry } = await buildList(
        [{ firstName: 'A' }],
        '3075551000',
      )

      const res = await postCall(listId, {
        entryId: entry.id,
        outcome: 'answered',
      })

      expect(res.status).toBe(400)
    })

    it('404s a personId not on the entry', async () => {
      const { listId, entry } = await buildList(
        [{ firstName: 'A' }],
        '3075551001',
      )

      const res = await postCall(listId, {
        entryId: entry.id,
        outcome: 'answered',
        personId: randomUUID(),
      })

      expect(res.status).toBe(404)
    })

    it('logs on exactly the selected person; markHouseholdDone fills bare rows only for un-logged housemates, leaving an already-logged one untouched', async () => {
      const { listId, entry } = await buildList(
        [{ firstName: 'A' }, { firstName: 'B' }, { firstName: 'C' }],
        '3075551002',
      )
      const [personA, personB, personC] = entry.persons

      // B answers first, alone — proves an answered call only ever touches
      // the selected person.
      const first = await postCall(listId, {
        entryId: entry.id,
        outcome: 'answered',
        personId: personB!.personId,
        supportAnswer: 'non_supporter',
      })
      expect(first.status).toBe(201)
      expect(
        await service.prisma.contactInteractionPhoneBanking.count({
          where: { phoneBankingListId: listId },
        }),
      ).toBe(1)

      // A answers and marks the household done.
      const second = await postCall(listId, {
        entryId: entry.id,
        outcome: 'answered',
        personId: personA!.personId,
        supportAnswer: 'supporter',
        willVote: 'yes',
        markHouseholdDone: true,
      })
      expect(second.status).toBe(201)

      // The response must reflect the whole household, including B's row
      // logged by the earlier call — not just what this request inserted.
      const resultFor = (personId: string) =>
        second.data.results.find(
          (result: { personId: string }) => result.personId === personId,
        )
      expect(resultFor(personA!.personId)).toMatchObject({
        interaction: { outcome: 'answered', supportAnswer: 'supporter' },
      })
      expect(resultFor(personB!.personId)).toMatchObject({
        interaction: { outcome: 'answered', supportAnswer: 'non_supporter' },
      })
      expect(resultFor(personC!.personId)).toMatchObject({
        interaction: { outcome: 'answered', supportAnswer: null },
      })

      const rows = await service.prisma.contactInteractionPhoneBanking.findMany(
        { where: { phoneBankingListId: listId } },
      )
      expect(rows).toHaveLength(3)

      const rowFor = (personId: string) =>
        rows.find((row) => row.personId === personId)
      expect(rowFor(personA!.personId)).toMatchObject({
        outcome: 'answered',
        supportAnswer: 'supporter',
        willVote: 'yes',
      })
      // B's own answer is untouched by the household fill.
      expect(rowFor(personB!.personId)).toMatchObject({
        outcome: 'answered',
        supportAnswer: 'non_supporter',
        willVote: null,
      })
      // C was un-logged, so the fill wrote a bare answered row.
      expect(rowFor(personC!.personId)).toMatchObject({
        outcome: 'answered',
        supportAnswer: null,
        willVote: null,
        note: null,
      })
    })

    it('markHouseholdDone never overwrites an existing refused row', async () => {
      const { listId, entry } = await buildList(
        [{ firstName: 'A' }, { firstName: 'B' }],
        '3075551003',
      )
      const [personA, personB] = entry.persons

      const refused = await postCall(listId, {
        entryId: entry.id,
        outcome: 'refused',
      })
      expect(refused.status).toBe(201)

      const answered = await postCall(listId, {
        entryId: entry.id,
        outcome: 'answered',
        personId: personA!.personId,
        markHouseholdDone: true,
      })
      expect(answered.status).toBe(201)

      const rowB =
        await service.prisma.contactInteractionPhoneBanking.findFirst({
          where: { phoneBankingListId: listId, personId: personB!.personId },
        })
      expect(rowB?.outcome).toBe('refused')
    })
  })

  describe('person-attributed refused (answered but refused to engage)', () => {
    it('logs refused on the named person only; housemates stay un-logged', async () => {
      const { listId, entry } = await buildList(
        [{ firstName: 'A' }, { firstName: 'B' }],
        '3075551014',
      )
      const [personA, personB] = entry.persons

      const res = await postCall(listId, {
        entryId: entry.id,
        outcome: 'refused',
        personId: personA!.personId,
      })
      expect(res.status).toBe(201)

      const rows = await service.prisma.contactInteractionPhoneBanking.findMany(
        { where: { phoneBankingListId: listId } },
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.personId).toBe(personA!.personId)
      expect(rows[0]?.outcome).toBe('refused')
      expect(rows[0]?.supportAnswer).toBeNull()

      const rowB =
        await service.prisma.contactInteractionPhoneBanking.findFirst({
          where: { phoneBankingListId: listId, personId: personB!.personId },
        })
      expect(rowB).toBeNull()
    })

    it('404s a personId not on the entry', async () => {
      const { listId, entry } = await buildList(
        [{ firstName: 'A' }],
        '3075551015',
      )
      const res = await postCall(listId, {
        entryId: entry.id,
        outcome: 'refused',
        personId: randomUUID(),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('number-level outcomes', () => {
    it('no_answer on a 2-person entry creates two rows with the same occurredAt', async () => {
      const { listId, entry } = await buildList(
        [{ firstName: 'A' }, { firstName: 'B' }],
        '3075551004',
      )

      const res = await postCall(listId, {
        entryId: entry.id,
        outcome: 'no_answer',
      })
      expect(res.status).toBe(201)

      const rows = await service.prisma.contactInteractionPhoneBanking.findMany(
        { where: { phoneBankingListId: listId } },
      )
      expect(rows).toHaveLength(2)
      expect(rows.every((row) => row.outcome === 'no_answer')).toBe(true)
      expect(rows[0]?.occurredAt).toEqual(rows[1]?.occurredAt)
    })

    it('wrong_number creates the suppression row; sending it twice does not error or duplicate rows', async () => {
      const { listId, entry } = await buildList(
        [{ firstName: 'A' }],
        '3075551005',
      )

      const first = await postCall(listId, {
        entryId: entry.id,
        outcome: 'wrong_number',
      })
      expect(first.status).toBe(201)
      const second = await postCall(listId, {
        entryId: entry.id,
        outcome: 'wrong_number',
      })
      expect(second.status).toBe(201)

      expect(
        await service.prisma.phoneBankingSuppressedPhone.count({
          where: { organizationSlug: orgSlug, phone: '3075551005' },
        }),
      ).toBe(1)
      expect(
        await service.prisma.contactInteractionPhoneBanking.count({
          where: { phoneBankingListId: listId },
        }),
      ).toBe(1)
    })
  })

  describe('edits replace in place', () => {
    it('re-logging the same person keeps one row; switching answered -> no_answer clears supportAnswer/willVote', async () => {
      const { listId, entry } = await buildList(
        [{ firstName: 'A' }],
        '3075551006',
      )
      const [personA] = entry.persons

      const answered = await postCall(listId, {
        entryId: entry.id,
        outcome: 'answered',
        personId: personA!.personId,
        supportAnswer: 'supporter',
        willVote: 'yes',
      })
      expect(answered.status).toBe(201)

      const noAnswer = await postCall(listId, {
        entryId: entry.id,
        outcome: 'no_answer',
      })
      expect(noAnswer.status).toBe(201)

      const rows = await service.prisma.contactInteractionPhoneBanking.findMany(
        { where: { phoneBankingListId: listId } },
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        outcome: 'no_answer',
        supportAnswer: null,
        willVote: null,
      })
    })
  })

  describe('status side effects', () => {
    it('supportAnswer surfaces in the derived support status', async () => {
      const { listId, entry } = await buildList(
        [{ firstName: 'A' }],
        '3075551007',
      )
      const [personA] = entry.persons

      const res = await postCall(listId, {
        entryId: entry.id,
        outcome: 'answered',
        personId: personA!.personId,
        supportAnswer: 'supporter',
      })
      expect(res.status).toBe(201)

      const supportStatus = service.app.get(SupportStatusService)
      const statuses = await supportStatus.statusForPeople(orgSlug, [
        personA!.personId,
      ])
      expect(statuses.get(personA!.personId)).toBe('supporter')
    })

    it('willVote=yes writes a likely voter_likelihood event sourced phone_banking; editing yes -> no records a second event', async () => {
      const { listId, entry } = await buildList(
        [{ firstName: 'A' }],
        '3075551008',
      )
      const [personA] = entry.persons

      const first = await postCall(listId, {
        entryId: entry.id,
        outcome: 'answered',
        personId: personA!.personId,
        willVote: 'yes',
      })
      expect(first.status).toBe(201)

      const firstEvent =
        await service.prisma.contactStatusEvent.findFirstOrThrow({
          where: { organizationSlug: orgSlug, personId: personA!.personId },
        })
      expect(firstEvent).toMatchObject({
        field: 'voter_likelihood',
        toValue: 'likely',
        source: 'phone_banking',
        actorUserId: null,
      })

      const second = await postCall(listId, {
        entryId: entry.id,
        outcome: 'answered',
        personId: personA!.personId,
        willVote: 'no',
      })
      expect(second.status).toBe(201)

      const events = await service.prisma.contactStatusEvent.findMany({
        where: { organizationSlug: orgSlug, personId: personA!.personId },
      })
      expect(events).toHaveLength(2)
      expect(events.map((event) => event.toValue).sort()).toEqual([
        'likely',
        'unlikely',
      ])

      const current =
        await service.prisma.contactCurrentStatus.findFirstOrThrow({
          where: {
            organizationSlug: orgSlug,
            personId: personA!.personId,
            field: 'voter_likelihood',
          },
        })
      expect(current.value).toBe('unlikely')
    })

    it('unsure writes no voter_likelihood event', async () => {
      const { listId, entry } = await buildList(
        [{ firstName: 'A' }],
        '3075551009',
      )
      const [personA] = entry.persons

      const res = await postCall(listId, {
        entryId: entry.id,
        outcome: 'answered',
        personId: personA!.personId,
        willVote: 'unsure',
      })
      expect(res.status).toBe(201)

      const events = await service.prisma.contactStatusEvent.findMany({
        where: { organizationSlug: orgSlug, personId: personA!.personId },
      })
      expect(events).toHaveLength(0)
    })

    // Real-error-path coverage for the no-op contract: a genuine unique
    // violation on (organizationSlug, field, sourceId) — the exact
    // constraint our route's likelihood write depends on for retry safety —
    // must resolve to a silent no-op rather than a thrown error. The sourceId
    // is minted from the real committed row (id, updatedAt) that the request
    // above just wrote, so this exercises the production mechanism, not a
    // fabricated collision.
    it('a duplicate sourceId on the underlying likelihood write no-ops rather than throwing', async () => {
      const { listId, entry } = await buildList(
        [{ firstName: 'A' }],
        '3075551010',
      )
      const [personA] = entry.persons

      const res = await postCall(listId, {
        entryId: entry.id,
        outcome: 'answered',
        personId: personA!.personId,
        willVote: 'yes',
      })
      expect(res.status).toBe(201)

      const row =
        await service.prisma.contactInteractionPhoneBanking.findFirstOrThrow({
          where: { phoneBankingListId: listId, personId: personA!.personId },
        })
      const sourceId = `${row.id}:${row.updatedAt.toISOString()}`

      const contactStatus = service.app.get(ContactStatusService)
      const result = await contactStatus.changeStatus({
        organizationSlug: orgSlug,
        personId: personA!.personId,
        field: ContactStatusField.voter_likelihood,
        toValue: 'unlikely',
        source: ContactStatusSource.phone_banking,
        actorUserId: null,
        sourceId,
        fallbackFromValue: null,
      })

      expect(result).toBeNull()
      const current =
        await service.prisma.contactCurrentStatus.findFirstOrThrow({
          where: {
            organizationSlug: orgSlug,
            personId: personA!.personId,
            field: 'voter_likelihood',
          },
        })
      // The no-op'd write must not have flipped the value the real request
      // already committed.
      expect(current.value).toBe('likely')
      expect(
        await service.prisma.contactStatusEvent.count({
          where: { organizationSlug: orgSlug, sourceId },
        }),
      ).toBe(1)
    })

    it('an eo- org writes no voter_likelihood event', async () => {
      const eoSlug = `eo-pbc-${Date.now()}`
      await service.prisma.organization.create({
        data: {
          slug: eoSlug,
          ownerId: service.user.id,
          overrideDistrictId: DISTRICT_ID,
        },
      })
      const eoFilter = await service.prisma.voterFileFilter.create({
        data: { organizationSlug: eoSlug, name: 'EO calls audience' },
      })
      const personId = randomUUID()
      mockPeoplePage([fakePerson({ id: personId, cellPhone: '3075551011' })])
      const build = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody({ voterFileFilterId: eoFilter.id }),
        orgHeaders(eoSlug),
      )
      expect(build.status).toBe(201)
      const entry = await service.prisma.phoneBankingListEntry.findFirstOrThrow(
        { where: { phoneBankingListId: build.data.id } },
      )

      const res = await service.client.post(
        `/v1/phone-banking/lists/${build.data.id}/calls`,
        { entryId: entry.id, outcome: 'answered', personId, willVote: 'yes' },
        orgHeaders(eoSlug),
      )
      expect(res.status).toBe(201)

      expect(
        await service.prisma.contactStatusEvent.count({
          where: { organizationSlug: eoSlug, personId },
        }),
      ).toBe(0)
    })
  })

  describe('envelope completion', () => {
    it('flips to completed on the write that logs the last un-logged person, and never un-completes', async () => {
      const { listId, outreachId, entry } = await buildList(
        [{ firstName: 'A' }, { firstName: 'B' }],
        '3075551012',
      )
      expect(outreachId).not.toBeNull()
      const [personA, personB] = entry.persons

      const first = await postCall(listId, {
        entryId: entry.id,
        outcome: 'answered',
        personId: personA!.personId,
      })
      expect(first.status).toBe(201)
      expect(first.data.envelopeCompleted).toBe(false)
      expect(
        (
          await service.prisma.outreach.findUniqueOrThrow({
            where: { id: outreachId },
          })
        ).status,
      ).toBe(OutreachStatus.in_progress)

      const second = await postCall(listId, {
        entryId: entry.id,
        outcome: 'answered',
        personId: personB!.personId,
      })
      expect(second.status).toBe(201)
      expect(second.data.envelopeCompleted).toBe(true)
      expect(
        (
          await service.prisma.outreach.findUniqueOrThrow({
            where: { id: outreachId },
          })
        ).status,
      ).toBe(OutreachStatus.completed)

      // Re-logging afterward must not un-complete the envelope.
      const third = await postCall(listId, {
        entryId: entry.id,
        outcome: 'answered',
        personId: personA!.personId,
        supportAnswer: 'supporter',
      })
      expect(third.status).toBe(201)
      expect(third.data.envelopeCompleted).toBe(true)
      expect(
        (
          await service.prisma.outreach.findUniqueOrThrow({
            where: { id: outreachId },
          })
        ).status,
      ).toBe(OutreachStatus.completed)
    })

    it('markHouseholdDone alone can complete the envelope in one request', async () => {
      const { listId, outreachId, entry } = await buildList(
        [{ firstName: 'A' }, { firstName: 'B' }, { firstName: 'C' }],
        '3075551013',
      )
      const [personA] = entry.persons

      const res = await postCall(listId, {
        entryId: entry.id,
        outcome: 'answered',
        personId: personA!.personId,
        markHouseholdDone: true,
      })
      expect(res.status).toBe(201)
      expect(res.data.envelopeCompleted).toBe(true)
      expect(
        (
          await service.prisma.outreach.findUniqueOrThrow({
            where: { id: outreachId },
          })
        ).status,
      ).toBe(OutreachStatus.completed)
    })

    // Two volunteers dialing the last two un-logged entries at once is
    // normal concurrency for a shared list, not adversarial timing. Without
    // per-list serialization, each request's own transaction can commit
    // without ever seeing the other's — both would read "still one person
    // missing" and neither would flip the envelope.
    it('flips to completed when two concurrent requests each log one of the last two un-logged entries', async () => {
      const {
        listId,
        outreachId,
        entry: entryA,
      } = await buildList([{ firstName: 'A' }], '3075551016')
      const secondEntry = await service.prisma.phoneBankingListEntry.create({
        data: {
          phoneBankingListId: listId,
          seq: 2,
          sheetIndex: 1,
          phone: '3075551017',
          persons: {
            create: [{ personId: randomUUID(), name: 'B Housemate' }],
          },
        },
        include: { persons: true },
      })
      const personA = entryA.persons[0]!
      const personB = secondEntry.persons[0]!

      const [first, second] = await Promise.all([
        postCall(listId, {
          entryId: entryA.id,
          outcome: 'answered',
          personId: personA.personId,
        }),
        postCall(listId, {
          entryId: secondEntry.id,
          outcome: 'answered',
          personId: personB.personId,
        }),
      ])
      expect(first.status).toBe(201)
      expect(second.status).toBe(201)

      expect(
        (
          await service.prisma.outreach.findUniqueOrThrow({
            where: { id: outreachId },
          })
        ).status,
      ).toBe(OutreachStatus.completed)
      expect([
        first.data.envelopeCompleted,
        second.data.envelopeCompleted,
      ]).toContain(true)
    })
  })

  describe('access control', () => {
    it('400s a non-Pro campaign', async () => {
      const { listId, entry } = await buildList(
        [{ firstName: 'A' }],
        '3075551014',
      )
      await service.prisma.campaign.update({
        where: { id: campaign.id },
        data: { isPro: false },
      })

      const res = await postCall(listId, {
        entryId: entry.id,
        outcome: 'no_answer',
      })

      expect(res.status).toBe(400)
    })

    it('404s a list belonging to another organization', async () => {
      const { listId, entry } = await buildList(
        [{ firstName: 'A' }],
        '3075551015',
      )
      const otherSlug = `eo-pbc-other-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: otherSlug, ownerId: service.user.id },
      })

      const res = await service.client.post(
        `/v1/phone-banking/lists/${listId}/calls`,
        { entryId: entry.id, outcome: 'no_answer' },
        { ...orgHeaders(otherSlug), validateStatus: () => true },
      )

      expect(res.status).toBe(404)
    })
  })
})
