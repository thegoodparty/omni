import { randomUUID } from 'node:crypto'
import FormData from 'form-data'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Person } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import {
  Campaign,
  ContactStatusField,
  NotAVoterStatus,
  OutreachStatus,
  OutreachType,
  PhoneBankCallOutcome,
  SupportAnswer,
  VoterFileFilter,
  WillVoteAnswer,
} from '../../generated/prisma'

const service = useTestService()

// A real election-api district id (same one door-knocking's own test suite
// uses) — assertVoterDataEligibility's canDownload check resolves the
// district/ballot level over a real election-api HTTP call, so a fabricated
// UUID 404s there before ever reaching this module's code.
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

// findPeople rides one seam whether it's paging the build audience or
// batch-enriching a read — mockResolvedValue answers every call the same
// way, which is fine here since every fixture page is far short of
// BUILD_PAGE_SIZE (so the build loop always stops after one call).
const mockPeoplePage = (people: Person[]) =>
  vi
    .spyOn(service.app.get(VoterQueryService), 'findPeople')
    .mockResolvedValue({ pagination: PEOPLE_PAGINATION, people })

describe('phone banking routes', () => {
  let orgSlug: string
  let campaign: Campaign
  let filter: VoterFileFilter

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    orgSlug = `campaign-pb-${suffix}`
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
        slug: `pb-campaign-${suffix}`,
        organizationSlug: orgSlug,
        isPro: true,
      },
    })
    filter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: orgSlug, name: 'PB audience' },
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

  describe('POST /v1/phone-banking/lists', () => {
    it('groups two people sharing a number into one entry, creates the envelope, and locks the filter', async () => {
      const sharedPhone = '3075551111'
      mockPeoplePage([
        fakePerson({
          id: randomUUID(),
          firstName: 'A',
          lastName: 'One',
          cellPhone: sharedPhone,
        }),
        fakePerson({
          id: randomUUID(),
          firstName: 'B',
          lastName: 'Two',
          cellPhone: sharedPhone,
        }),
      ])

      const res = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody(),
        orgHeaders(),
      )

      expect(res.status).toBe(201)
      expect(res.data).toMatchObject({
        name: 'Tuesday calls',
        sheetCount: 1,
        entryCount: 1,
        personCount: 2,
      })
      expect(res.data.outreachId).not.toBeNull()

      const entries = await service.prisma.phoneBankingListEntry.findMany({
        where: { phoneBankingListId: res.data.id },
        include: { persons: true },
      })
      expect(entries).toHaveLength(1)
      expect(entries[0]?.phone).toBe(sharedPhone)
      expect(entries[0]?.persons).toHaveLength(2)
      expect(entries[0]?.persons.map((p) => p.firstName).sort()).toEqual([
        'A',
        'B',
      ])
      expect(entries[0]?.seq).toBe(1)
      expect(entries[0]?.sheetIndex).toBe(1)

      const lockedFilter = await service.prisma.voterFileFilter.findUnique({
        where: { id: filter.id },
      })
      expect(lockedFilter?.firstUsedForOutreachAt).not.toBeNull()

      const envelope = await service.prisma.outreach.findFirst({
        where: { phoneBankingListId: res.data.id },
      })
      expect(envelope).toMatchObject({
        outreachType: OutreachType.nativePhoneBanking,
        status: OutreachStatus.in_progress,
        campaignId: campaign.id,
        voterFileFilterId: filter.id,
      })
    })

    it('falls back to the landline when the cell number is org-suppressed, and drops a person with no usable number left', async () => {
      const suppressedCell = '3075552222'
      await service.prisma.phoneBankingSuppressedPhone.create({
        data: { organizationSlug: orgSlug, phone: suppressedCell },
      })
      mockPeoplePage([
        fakePerson({
          id: randomUUID(),
          firstName: 'Fall',
          lastName: 'Back',
          cellPhone: suppressedCell,
          landline: '3075553333',
        }),
        fakePerson({
          id: randomUUID(),
          firstName: 'Dead',
          lastName: 'End',
          cellPhone: suppressedCell,
          landline: null,
        }),
      ])

      const res = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody(),
        orgHeaders(),
      )

      expect(res.status).toBe(201)
      expect(res.data).toMatchObject({ entryCount: 1, personCount: 1 })
      const entry = await service.prisma.phoneBankingListEntry.findFirst({
        where: { phoneBankingListId: res.data.id },
      })
      expect(entry?.phone).toBe('3075553333')
    })

    it('excludes a nameless person from the build', async () => {
      mockPeoplePage([
        fakePerson({
          id: randomUUID(),
          firstName: 'Has',
          lastName: 'Name',
          cellPhone: '3075554444',
        }),
        fakePerson({
          id: randomUUID(),
          firstName: null,
          lastName: null,
          cellPhone: '3075555555',
        }),
      ])

      const res = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody(),
        orgHeaders(),
      )

      expect(res.status).toBe(201)
      expect(res.data).toMatchObject({ entryCount: 1, personCount: 1 })
    })

    it('preserves an empty-string firstName rather than coercing it to null', async () => {
      mockPeoplePage([
        fakePerson({
          id: randomUUID(),
          firstName: '',
          lastName: 'Legacy',
          cellPhone: '3075554446',
        }),
      ])

      const res = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody(),
        orgHeaders(),
      )

      expect(res.status).toBe(201)
      const person = await service.prisma.phoneBankingListEntryPerson.findFirst(
        {
          where: { entry: { phoneBankingListId: res.data.id } },
        },
      )
      expect(person?.firstName).toBe('')
    })

    it('excludes a not_a_voter (moved/deceased) person from the build', async () => {
      const excludedId = randomUUID()
      await service.prisma.contactCurrentStatus.create({
        data: {
          organizationSlug: orgSlug,
          personId: excludedId,
          field: ContactStatusField.not_a_voter,
          value: NotAVoterStatus.moved,
        },
      })
      mockPeoplePage([
        fakePerson({ id: excludedId, cellPhone: '3075556666' }),
        fakePerson({ id: randomUUID(), cellPhone: '3075557777' }),
      ])

      const res = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody(),
        orgHeaders(),
      )

      expect(res.status).toBe(201)
      expect(res.data).toMatchObject({ entryCount: 1, personCount: 1 })
    })

    it('caps entries at sheetCount * 60 and sets seq/sheetIndex correctly at the 60/61 boundary', async () => {
      const people = Array.from({ length: 61 }, (_, i) =>
        fakePerson({
          id: randomUUID(),
          firstName: `P${i}`,
          lastName: 'Voter',
          cellPhone: `30755${String(i).padStart(5, '0')}`,
        }),
      )
      mockPeoplePage(people)

      const res = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody({ sheetCount: 2 }),
        orgHeaders(),
      )

      expect(res.status).toBe(201)
      expect(res.data.entryCount).toBe(61)
      // 61 usable people all fit under the 120-entry cap and the page was
      // short — nothing remains.
      expect(res.data.hasMore).toBe(false)

      const entries = await service.prisma.phoneBankingListEntry.findMany({
        where: { phoneBankingListId: res.data.id },
        orderBy: { seq: 'asc' },
      })
      expect(entries).toHaveLength(61)
      expect(entries.map((e) => e.seq)).toEqual(
        Array.from({ length: 61 }, (_, i) => i + 1),
      )
      expect(entries[59]?.sheetIndex).toBe(1)
      expect(entries[60]?.sheetIndex).toBe(2)
    })

    it('honors the entry cap: new numbers beyond sheetCount * 60 are dropped', async () => {
      const people = Array.from({ length: 65 }, (_, i) =>
        fakePerson({
          id: randomUUID(),
          firstName: `Q${i}`,
          lastName: 'Voter',
          cellPhone: `30756${String(i).padStart(5, '0')}`,
        }),
      )
      mockPeoplePage(people)

      const res = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody({ sheetCount: 1 }),
        orgHeaders(),
      )

      expect(res.status).toBe(201)
      expect(res.data).toMatchObject({
        entryCount: 60,
        personCount: 60,
        hasMore: true,
      })
    })

    it('a follow-up create on the same filter continues past prior batches and 400s once exhausted', async () => {
      const people = Array.from({ length: 61 }, (_, i) =>
        fakePerson({
          id: randomUUID(),
          firstName: `B${i}`,
          lastName: 'Voter',
          cellPhone: `30757${String(i).padStart(5, '0')}`,
        }),
      )
      mockPeoplePage(people)

      const first = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody({ sheetCount: 1, name: 'Batch 1' }),
        orgHeaders(),
      )
      expect(first.status).toBe(201)
      expect(first.data).toMatchObject({ entryCount: 60, hasMore: true })

      const second = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody({ sheetCount: 1, name: 'Batch 2' }),
        orgHeaders(),
      )
      expect(second.status).toBe(201)
      expect(second.data).toMatchObject({
        entryCount: 1,
        personCount: 1,
        hasMore: false,
      })
      const persons = await service.prisma.phoneBankingListEntryPerson.findMany(
        {
          where: { entry: { phoneBankingListId: second.data.id } },
        },
      )
      expect(persons.map((p) => p.personId)).toEqual([people[60]?.id])

      const third = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody({ sheetCount: 1, name: 'Batch 3' }),
        orgHeaders(),
      )
      expect(third.status).toBe(400)
      expect(third.data.message).toContain(
        'already in a previous phone banking campaign',
      )
    })

    it('prior batches on a different filter exclude nobody', async () => {
      mockPeoplePage([fakePerson({ cellPhone: '3075559111' })])

      const first = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody(),
        orgHeaders(),
      )
      expect(first.status).toBe(201)

      const otherFilter = await service.prisma.voterFileFilter.create({
        data: { organizationSlug: orgSlug, name: 'PB audience 2' },
      })
      const second = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody({ voterFileFilterId: otherFilter.id }),
        orgHeaders(),
      )
      expect(second.status).toBe(201)
      expect(second.data).toMatchObject({
        entryCount: 1,
        personCount: 1,
        hasMore: false,
      })
    })

    it('a filter that stopped matching anyone 400s as empty, not exhausted, despite a prior batch', async () => {
      mockPeoplePage([fakePerson({ cellPhone: '3075559222' })])
      const first = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody(),
        orgHeaders(),
      )
      expect(first.status).toBe(201)

      mockPeoplePage([])
      const second = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody({ name: 'Batch 2' }),
        orgHeaders(),
      )
      expect(second.status).toBe(400)
      expect(second.data.message).toContain('widen the filters')
    })

    it('an at-capacity prior-batch person neither signals hasMore nor joins a fresh entry via a shared phone', async () => {
      const sharedPhone = '3075809999'
      const priorPerson = fakePerson({
        id: randomUUID(),
        firstName: 'Called',
        lastName: 'Already',
        cellPhone: sharedPhone,
      })
      mockPeoplePage([priorPerson])
      const first = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody({ name: 'Batch 1' }),
        orgHeaders(),
      )
      expect(first.status).toBe(201)

      // Batch 2's page: 60 fresh people fill the cap, then the prior-batch
      // person appears at capacity — plus a fresh household member on the
      // prior person's phone, who must get their own entry without the
      // already-called person riding along.
      const fresh = Array.from({ length: 60 }, (_, i) =>
        fakePerson({
          id: randomUUID(),
          firstName: `F${i}`,
          lastName: 'Voter',
          cellPhone: `30758${String(i).padStart(5, '0')}`,
        }),
      )
      const householdMate = fakePerson({
        id: randomUUID(),
        firstName: 'New',
        lastName: 'Housemate',
        cellPhone: sharedPhone,
      })
      mockPeoplePage([householdMate, ...fresh.slice(0, 59), priorPerson])

      const second = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody({ sheetCount: 1, name: 'Batch 2' }),
        orgHeaders(),
      )
      expect(second.status).toBe(201)
      expect(second.data).toMatchObject({ entryCount: 60, hasMore: false })

      const sharedEntry = await service.prisma.phoneBankingListEntry.findFirst({
        where: { phoneBankingListId: second.data.id, phone: sharedPhone },
        include: { persons: true },
      })
      expect(sharedEntry?.persons.map((p) => p.personId)).toEqual([
        householdMate.id,
      ])
    })

    it('drops anyone a concurrent create froze between paging and the freeze transaction', async () => {
      const racedPerson = fakePerson({ cellPhone: '3075901111' })
      const freshPerson = fakePerson({ cellPhone: '3075902222' })
      // Simulate the TOCTOU window: the prior-batch snapshot is read before
      // findPeople, so a competing list committed DURING paging is exactly
      // what the in-tx advisory-lock re-read must catch.
      vi.spyOn(
        service.app.get(VoterQueryService),
        'findPeople',
      ).mockImplementation(async () => {
        await service.prisma.phoneBankingList.create({
          data: {
            organizationSlug: orgSlug,
            voterFileFilterId: filter.id,
            name: 'Concurrent batch',
            script: 'hello',
            sheetCount: 1,
            purpose: 'introduce',
            entries: {
              create: [
                {
                  seq: 1,
                  sheetIndex: 1,
                  phone: '3075901111',
                  persons: {
                    create: [
                      {
                        personId: racedPerson.id,
                        name: 'Jane Voter',
                        firstName: 'Jane',
                      },
                    ],
                  },
                },
              ],
            },
          },
        })
        return {
          pagination: PEOPLE_PAGINATION,
          people: [racedPerson, freshPerson],
        }
      })

      const res = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody(),
        orgHeaders(),
      )
      expect(res.status).toBe(201)
      expect(res.data).toMatchObject({ entryCount: 1, personCount: 1 })
      const persons = await service.prisma.phoneBankingListEntryPerson.findMany(
        {
          where: { entry: { phoneBankingListId: res.data.id } },
        },
      )
      expect(persons.map((p) => p.personId)).toEqual([freshPerson.id])
    })

    it('a prior-batch person whose number got suppressed 400s as empty, not exhausted', async () => {
      const phone = '3075559333'
      mockPeoplePage([fakePerson({ cellPhone: phone })])
      const first = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody(),
        orgHeaders(),
      )
      expect(first.status).toBe(201)

      await service.prisma.phoneBankingSuppressedPhone.create({
        data: { organizationSlug: orgSlug, phone },
      })
      const second = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody({ name: 'Batch 2' }),
        orgHeaders(),
      )
      expect(second.status).toBe(400)
      expect(second.data.message).toContain('widen the filters')
    })

    it('round-trips a hyphenated purpose through the snake_case DB enum', async () => {
      mockPeoplePage([fakePerson({ cellPhone: '3075558999' })])

      const build = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody({ purpose: 'election-day' }),
        orgHeaders(),
      )
      expect(build.status).toBe(201)

      const get = await service.client.get(
        `/v1/phone-banking/lists/${build.data.id}`,
        orgHeaders(),
      )
      expect(get.data.purpose).toBe('election-day')
    })

    it('400s an inline-filters body — the audience is always a saved filter', async () => {
      const res = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody({
          voterFileFilterId: undefined,
          filters: { hasCellPhone: true },
          filterName: 'Inline audience',
        }),
        { ...orgHeaders(), validateStatus: () => true },
      )

      expect(res.status).toBe(400)
      expect(await service.prisma.phoneBankingList.count()).toBe(0)
    })

    it('404s a voterFileFilterId that belongs to another organization', async () => {
      const otherSlug = `eo-pb-filter-owner-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: otherSlug, ownerId: service.user.id },
      })
      const foreignFilter = await service.prisma.voterFileFilter.create({
        data: { organizationSlug: otherSlug, name: 'not yours' },
      })
      mockPeoplePage([fakePerson()])

      const res = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody({ voterFileFilterId: foreignFilter.id }),
        { ...orgHeaders(), validateStatus: () => true },
      )

      expect(res.status).toBe(404)
      expect(await service.prisma.phoneBankingList.count()).toBe(0)
    })

    it('400s a non-Pro Win campaign and persists nothing', async () => {
      await service.prisma.campaign.update({
        where: { id: campaign.id },
        data: { isPro: false },
      })
      mockPeoplePage([fakePerson()])

      const res = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody(),
        { ...orgHeaders(), validateStatus: () => true },
      )

      expect(res.status).toBe(400)
      expect(await service.prisma.phoneBankingList.count()).toBe(0)
    })

    it('a Serve (eo-) org without a campaign gets a list but no envelope', async () => {
      const eoSlug = `eo-pb-${Date.now()}`
      await service.prisma.organization.create({
        data: {
          slug: eoSlug,
          ownerId: service.user.id,
          overrideDistrictId: DISTRICT_ID,
        },
      })
      const eoFilter = await service.prisma.voterFileFilter.create({
        data: { organizationSlug: eoSlug, name: 'EO audience' },
      })
      mockPeoplePage([fakePerson({ cellPhone: '3075559001' })])

      const res = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody({ voterFileFilterId: eoFilter.id }),
        orgHeaders(eoSlug),
      )

      expect(res.status).toBe(201)
      expect(res.data.outreachId).toBeNull()
      expect(await service.prisma.outreach.count()).toBe(0)
    })

    it('400s an empty resolved audience and persists nothing', async () => {
      mockPeoplePage([])

      const res = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody(),
        { ...orgHeaders(), validateStatus: () => true },
      )

      expect(res.status).toBe(400)
      expect(res.data.message).toMatch(/widen the filters/)
      expect(await service.prisma.phoneBankingList.count()).toBe(0)
    })
  })

  describe('client-supplied nativePhoneBanking via POST /v1/outreach', () => {
    it('is rejected', async () => {
      const form = new FormData()
      form.append('campaignId', String(campaign.id))
      form.append('outreachType', OutreachType.nativePhoneBanking)
      form.append('status', 'pending')

      const res = await service.client.post('/v1/outreach', form, {
        headers: { ...orgHeaders().headers, ...form.getHeaders() },
        validateStatus: () => true,
      })

      expect(res.status).toBe(400)
    })
  })

  describe('GET /v1/phone-banking/lists/:id', () => {
    it('returns entries in seq order with per-person interaction state, nulling a vanished person', async () => {
      const livePersonId = randomUUID()
      const vanishedPersonId = randomUUID()
      mockPeoplePage([
        fakePerson({
          id: livePersonId,
          firstName: 'Live',
          lastName: 'One',
          cellPhone: '3075559991',
        }),
        fakePerson({
          id: vanishedPersonId,
          firstName: 'Gone',
          lastName: 'Fromdb',
          cellPhone: '3075559992',
        }),
      ])
      const build = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody(),
        orgHeaders(),
      )
      const listId = build.data.id

      await service.prisma.contactInteractionPhoneBanking.create({
        data: {
          organizationSlug: orgSlug,
          personId: livePersonId,
          occurredAt: new Date(),
          phoneBankingListId: listId,
          outcome: PhoneBankCallOutcome.answered,
          supportAnswer: SupportAnswer.supporter,
          willVote: WillVoteAnswer.yes,
        },
      })

      // Enrichment call for the read: only the live person still resolves.
      mockPeoplePage([
        fakePerson({
          id: livePersonId,
          firstName: 'Live',
          lastName: 'One',
          cellPhone: '3075559991',
          age: 61,
          politicalParty: 'Democratic',
        }),
      ])

      const res = await service.client.get(
        `/v1/phone-banking/lists/${listId}`,
        orgHeaders(),
      )

      expect(res.status).toBe(200)
      expect(res.data.purpose).toBe('introduce')
      expect(res.data.entries).toHaveLength(2)
      const seqs = res.data.entries.map((entry: { seq: number }) => entry.seq)
      expect(seqs).toEqual([...seqs].sort((a: number, b: number) => a - b))

      const persons = res.data.entries.flatMap(
        (entry: { persons: unknown[] }) => entry.persons,
      ) as Array<Record<string, unknown>>
      const liveRow = persons.find((p) => p.personId === livePersonId)
      expect(liveRow).toMatchObject({
        firstName: 'Live',
        age: 61,
        party: 'Democratic',
        cellPhone: '3075559991',
        address: '123 Main St, Cheyenne, WY 82001',
      })
      expect(liveRow?.interaction).toMatchObject({
        outcome: 'answered',
        supportAnswer: 'supporter',
        willVote: 'yes',
      })

      const vanishedRow = persons.find((p) => p.personId === vanishedPersonId)
      expect(vanishedRow).toMatchObject({
        name: 'Gone Fromdb',
        // Frozen at build time — must come from the persisted row, not a
        // live lookup, since this person no longer resolves.
        firstName: 'Gone',
        age: null,
        party: null,
        address: null,
        cellPhone: null,
        landline: null,
        interaction: null,
      })
    })

    it('serves a list frozen before firstName existed, falling back to null rather than 500ing', async () => {
      const personId = randomUUID()
      mockPeoplePage([
        fakePerson({
          id: personId,
          firstName: 'Pat',
          lastName: 'Legacy',
          cellPhone: '3075559994',
        }),
      ])
      const build = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody(),
        orgHeaders(),
      )
      const listId = build.data.id

      // Simulates a row persisted before the ENG-10938 migration added the
      // column — every pre-existing production row is null the same way.
      await service.prisma.phoneBankingListEntryPerson.updateMany({
        where: { personId },
        data: { firstName: null },
      })

      mockPeoplePage([
        fakePerson({
          id: personId,
          firstName: 'Pat',
          lastName: 'Legacy',
          cellPhone: '3075559994',
        }),
      ])

      const res = await service.client.get(
        `/v1/phone-banking/lists/${listId}`,
        orgHeaders(),
      )

      expect(res.status).toBe(200)
      const person = res.data.entries[0]?.persons[0]
      expect(person).toMatchObject({ name: 'Pat Legacy', firstName: null })
    })

    it('404s for a list belonging to another organization', async () => {
      mockPeoplePage([fakePerson({ cellPhone: '3075559993' })])
      const build = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody(),
        orgHeaders(),
      )
      const otherSlug = `eo-pb-other-get-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: otherSlug, ownerId: service.user.id },
      })

      const res = await service.client.get(
        `/v1/phone-banking/lists/${build.data.id}`,
        { ...orgHeaders(otherSlug), validateStatus: () => true },
      )

      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /v1/phone-banking/lists/:id', () => {
    it('removes the list, entries, persons, interactions, and the envelope in one go; suppressed-phone rows survive', async () => {
      const personId = randomUUID()
      mockPeoplePage([fakePerson({ id: personId, cellPhone: '3075559994' })])
      const build = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody(),
        orgHeaders(),
      )
      const listId = build.data.id

      await service.prisma.contactInteractionPhoneBanking.create({
        data: {
          organizationSlug: orgSlug,
          personId,
          occurredAt: new Date(),
          phoneBankingListId: listId,
          outcome: PhoneBankCallOutcome.wrong_number,
        },
      })
      await service.prisma.phoneBankingSuppressedPhone.create({
        data: { organizationSlug: orgSlug, phone: '3075559994' },
      })
      await service.prisma.contactCurrentStatus.create({
        data: {
          organizationSlug: orgSlug,
          personId,
          field: ContactStatusField.not_a_voter,
          value: NotAVoterStatus.moved,
        },
      })

      const res = await service.client.delete(
        `/v1/phone-banking/lists/${listId}`,
        orgHeaders(),
      )

      expect(res.status).toBe(204)
      expect(await service.prisma.phoneBankingList.count()).toBe(0)
      expect(await service.prisma.phoneBankingListEntry.count()).toBe(0)
      expect(await service.prisma.phoneBankingListEntryPerson.count()).toBe(0)
      expect(await service.prisma.contactInteractionPhoneBanking.count()).toBe(
        0,
      )
      expect(
        await service.prisma.outreach.count({
          where: { phoneBankingListId: listId },
        }),
      ).toBe(0)
      expect(await service.prisma.phoneBankingSuppressedPhone.count()).toBe(1)
      expect(await service.prisma.contactCurrentStatus.count()).toBe(1)
    })

    it('404s for a list belonging to another organization and leaves it intact', async () => {
      mockPeoplePage([fakePerson({ cellPhone: '3075559995' })])
      const build = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody(),
        orgHeaders(),
      )
      const otherSlug = `eo-pb-other-del-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: otherSlug, ownerId: service.user.id },
      })

      const res = await service.client.delete(
        `/v1/phone-banking/lists/${build.data.id}`,
        { ...orgHeaders(otherSlug), validateStatus: () => true },
      )

      expect(res.status).toBe(404)
      expect(await service.prisma.phoneBankingList.count()).toBe(1)
    })
  })
})
