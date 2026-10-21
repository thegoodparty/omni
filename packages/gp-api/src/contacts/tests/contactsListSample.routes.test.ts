import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { HttpStatus } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { useTestService } from '@/test-service'
import { seedTurfEffort } from '@/constituentFeedback/tests/issueCaptureFixtures'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import type { PersonOutput } from '@/contacts/schemas/person.schema'
import { subDays } from 'date-fns'
import {
  CivicPanelStatus,
  ContactStatusField,
  ContactStatusSource,
} from '@/generated/prisma'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

const page = (totalResults: number) => ({
  people: [],
  pagination: {
    totalResults,
    currentPage: 1,
    pageSize: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
})

// A list saved as a sample, from the draw that freezes it to the reads that
// have to honour it. The two people-db reads are the only stubs; the filter
// row, its member rows and every resolution in between are real.
describe('lists saved as a sample', () => {
  const setupServeOrg = async (suffix: string) => {
    const slug = `eo-sample-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: randomUUID(),
      },
    })
    return slug
  }

  // Re-spying returns the same spy with its history, so each case clears it.
  const stubAudience = (totalResults: number) =>
    vi
      .spyOn(service.app.get(VoterQueryService), 'findPeople')
      .mockClear()
      .mockResolvedValue(page(totalResults) as never)

  const stubDraw = (ids: string[]) =>
    vi
      .spyOn(service.app.get(VoterQueryService), 'samplePeople')
      .mockClear()
      .mockResolvedValue(ids.map((id) => ({ id }) as PersonOutput))

  const createFilter = (slug: string, body: Record<string, unknown>) =>
    service.client.post('/v1/voters/voter-file/filter', body, {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

  const sampleMemberIds = (voterFileFilterId: number) =>
    service.prisma.voterFileFilterSampleMember
      .findMany({ where: { voterFileFilterId }, select: { personId: true } })
      .then((rows) => rows.map((r) => r.personId).sort())

  it('freezes a random draw within the list criteria', async () => {
    const slug = await setupServeOrg('create')
    const drawn = [randomUUID(), randomUUID()].sort()
    stubAudience(58_520)
    const draw = stubDraw(drawn)

    const response = await createFilter(slug, {
      name: 'Renters on the flood blocks',
      hasCellPhone: true,
      homeownerNo: true,
      sample: { size: 4_000, seedKey: 'proposal-1' },
    })

    expect(response.status).toBe(HttpStatus.CREATED)
    expect(await sampleMemberIds(response.data.id)).toEqual(drawn)
    const row = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id: response.data.id },
    })
    expect(row.sampleSize).toBe(4_000)
    expect(row.sampledAt).toBeInstanceOf(Date)
    const [request] = draw.mock.calls[0] ?? []
    expect(request).toMatchObject({ size: 4_000, seedKey: 'proposal-1' })
    // Drawn from the list's own criteria, not the district.
    expect(request?.filters?.filters).toEqual(
      expect.arrayContaining(['hasCellPhone']),
    )
  })

  it('saves the whole audience when it is no bigger than the sample', async () => {
    const slug = await setupServeOrg('whole')
    stubAudience(300)
    const draw = stubDraw([])

    const response = await createFilter(slug, {
      name: 'A short street',
      hasCellPhone: true,
      sample: { size: 4_000 },
    })

    expect(response.status).toBe(HttpStatus.CREATED)
    expect(draw).not.toHaveBeenCalled()
    expect(await sampleMemberIds(response.data.id)).toEqual([])
    const row = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id: response.data.id },
    })
    expect(row.sampleSize).toBeNull()
  })

  it('reads a sampled list as its draw, everywhere a list is read', async () => {
    const slug = await setupServeOrg('read')
    const drawn = [randomUUID()]
    stubAudience(58_520)
    stubDraw(drawn)
    const created = await createFilter(slug, {
      name: 'Sampled',
      hasCellPhone: true,
      sample: { size: 1 },
    })
    const findPeople = stubAudience(1)

    const listed = await service.client.get('/v1/contacts', {
      params: { segment: String(created.data.id), page: 1, resultsPerPage: 10 },
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(listed.status).toBe(HttpStatus.OK)
    expect(findPeople.mock.calls[0]?.[0]?.filters).toMatchObject({
      filterOperators: { id: { operator: 'in', values: drawn } },
    })
  })

  // The Campaign Manager saves samples for Win campaigns, whose phone list
  // goes to Peerly through the same resolution: a campaign's sampled list
  // has to read as its draw too, or a candidate would text everyone.
  it("reads a Win campaign's sampled list as its draw", async () => {
    const slug = `campaign-sample-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: randomUUID(),
      },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${slug}-campaign`,
        organizationSlug: slug,
        isPro: true,
      },
    })
    vi.spyOn(service.app.get(HttpService), 'get').mockReturnValue(
      of({
        data: {
          id: slug,
          state: 'NC',
          L2DistrictType: 'City',
          L2DistrictName: 'Asheville',
        },
        status: 200,
      }) as never,
    )
    const drawn = [randomUUID(), randomUUID()]
    stubAudience(53_000)
    stubDraw(drawn)
    const created = await createFilter(slug, {
      name: 'Bike lanes',
      hasCellPhone: true,
      sample: { size: 2 },
    })
    expect(created.status).toBe(HttpStatus.CREATED)
    expect(await sampleMemberIds(created.data.id)).toEqual([...drawn].sort())
    const findPeople = stubAudience(2)

    const listed = await service.client.get('/v1/contacts', {
      params: { segment: String(created.data.id), page: 1, resultsPerPage: 10 },
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(listed.status).toBe(HttpStatus.OK)
    expect(findPeople.mock.calls[0]?.[0]?.filters).toMatchObject({
      filterOperators: { id: { operator: 'in', values: drawn } },
    })
  })

  it('leaves out who an earlier sample of the audience already reached', async () => {
    const slug = await setupServeOrg('widen')
    const firstDraw = [randomUUID(), randomUUID()].sort()
    stubAudience(58_520)
    stubDraw(firstDraw)
    const first = await createFilter(slug, {
      name: 'First round',
      hasCellPhone: true,
      sample: { size: 2 },
    })
    const sent = await service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        outreachType: 'text',
        voterFileFilterId: first.data.id,
      },
    })
    const findPeople = stubAudience(58_518)
    const draw = stubDraw([randomUUID()])

    const second = await createFilter(slug, {
      name: 'Second round',
      hasCellPhone: true,
      sample: { size: 2, excludeOutreachIds: [sent.id] },
    })

    expect(second.status).toBe(HttpStatus.CREATED)
    // Left out of the scope itself, so the count and the draw both read
    // the pool without them.
    const excluded = { operator: 'notIn', values: expect.any(Array) }
    expect(findPeople.mock.calls[0]?.[0]?.filters).toMatchObject({
      filterOperators: { id: excluded },
    })
    expect(
      [
        ...(draw.mock.calls[0]?.[0]?.filters?.filterOperators?.id?.values ??
          []),
      ].sort(),
    ).toEqual(firstDraw)
  })

  // The people an earlier sample reached may have left the audience since.
  // Subtracting their number from the audience drew short; the pool is what
  // is actually left once they are taken out.
  it('draws the full sample when the people left out are no longer in it', async () => {
    const slug = await setupServeOrg('no-overlap')
    stubAudience(58_520)
    stubDraw([randomUUID(), randomUUID()])
    const first = await createFilter(slug, {
      name: 'First round',
      hasCellPhone: true,
      sample: { size: 2 },
    })
    const sent = await service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        outreachType: 'text',
        voterFileFilterId: first.data.id,
      },
    })
    // None of the two already asked are in the audience any more, so the
    // pool with them taken out is still all three.
    stubAudience(3)
    const draw = stubDraw([randomUUID(), randomUUID()])

    const second = await createFilter(slug, {
      name: 'Second round',
      hasCellPhone: true,
      sample: { size: 2, excludeOutreachIds: [sent.id] },
    })

    expect(second.status).toBe(HttpStatus.CREATED)
    expect(draw.mock.calls[0]?.[0]).toMatchObject({ size: 2 })
    expect(await sampleMemberIds(second.data.id)).toHaveLength(2)
  })

  it('reads a sample that drew nobody as nobody, never the whole audience', async () => {
    const slug = await setupServeOrg('nobody')
    const firstDraw = [randomUUID(), randomUUID()]
    stubAudience(2)
    stubDraw(firstDraw)
    const created = await createFilter(slug, {
      name: 'Everyone asked',
      hasCellPhone: true,
      sample: { size: 1 },
    })
    // Two people, sample of one: drawn for real.
    expect(await sampleMemberIds(created.data.id)).toHaveLength(2)
    const sent = await service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        outreachType: 'text',
        voterFileFilterId: created.data.id,
      },
    })
    stubAudience(0)
    const draw = stubDraw([])

    const again = await createFilter(slug, {
      name: 'Nobody left',
      hasCellPhone: true,
      sample: { size: 1, excludeOutreachIds: [sent.id] },
    })

    expect(draw).not.toHaveBeenCalled()
    const row = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id: again.data.id },
    })
    expect(row.sampleSize).toBe(1)
    const listed = await service.client.get('/v1/contacts', {
      params: { segment: String(again.data.id), page: 1, resultsPerPage: 10 },
      headers: { [ORG_SLUG_HEADER]: slug },
    })
    expect(listed.data.pagination.totalResults).toBe(0)
  })

  // Saved whole, a widen would be a live filter with nothing left out, and
  // would text the earlier sample again. Everyone left is frozen instead.
  it('freezes everyone not yet asked when they fit in a widen', async () => {
    const slug = await setupServeOrg('rest')
    stubAudience(58_520)
    stubDraw([randomUUID(), randomUUID()])
    const first = await createFilter(slug, {
      name: 'First round',
      hasCellPhone: true,
      sample: { size: 2 },
    })
    const sent = await service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        outreachType: 'text',
        voterFileFilterId: first.data.id,
      },
    })
    const rest = randomUUID()
    stubAudience(1)
    const draw = stubDraw([rest])

    const second = await createFilter(slug, {
      name: 'Everyone left',
      hasCellPhone: true,
      sample: { size: 2, excludeOutreachIds: [sent.id] },
    })

    expect(draw.mock.calls[0]?.[0]).toMatchObject({ size: 1 })
    const row = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id: second.data.id },
    })
    expect(row.sampleSize).toBe(2)
    expect(await sampleMemberIds(second.data.id)).toEqual([rest])
  })

  // One list that asks the civic panel and grows it: a draw from the
  // members and an equal draw from everyone else, frozen as one sample.
  describe('with a panel part', () => {
    const setMember = (organizationSlug: string, personId: string) =>
      service.app.get(ContactStatusService).changeStatus({
        organizationSlug,
        personId,
        field: ContactStatusField.civic_panel,
        toValue: CivicPanelStatus.member,
        source: ContactStatusSource.manual,
        actorUserId: service.user.id,
        fallbackFromValue: CivicPanelStatus.left,
      })

    const textedLastWeek = (organizationSlug: string, personId: string) =>
      service.app.get(ContactInteractionTextService).create({
        organizationSlug,
        personId,
        occurredAt: subDays(new Date(), 7),
      })

    type IdOperator = { operator: string; values: string[] } | undefined
    const idOperatorOf = (request: unknown): IdOperator =>
      (
        request as {
          filters?: { filterOperators?: { id?: IdOperator } }
        }
      ).filters?.filterOperators?.id

    it('freezes the union of a rested panel draw and a fresh draw of non-members', async () => {
      const slug = await setupServeOrg('panel')
      const rested = [randomUUID(), randomUUID()]
      const recentMember = randomUUID()
      const recentResident = randomUUID()
      for (const id of [...rested, recentMember]) await setMember(slug, id)
      await textedLastWeek(slug, recentMember)
      await textedLastWeek(slug, recentResident)
      const fresh = [randomUUID(), randomUUID()]
      stubAudience(58_520)
      const draw = vi
        .spyOn(service.app.get(VoterQueryService), 'samplePeople')
        .mockClear()
        .mockImplementation(async (request) => {
          const id = idOperatorOf(request)
          const ids = id?.operator === 'in' ? id.values : fresh
          return ids.map((personId) => ({ id: personId }) as PersonOutput)
        })

      const response = await createFilter(slug, {
        name: 'Panel and new residents',
        hasCellPhone: true,
        notContactedRecently: true,
        sample: { size: 4, panelSize: 2, seedKey: 'proposal-2' },
      })

      expect(response.status).toBe(HttpStatus.CREATED)
      expect(draw).toHaveBeenCalledTimes(2)
      const [panelRequest] = draw.mock.calls[0] ?? []
      const [freshRequest] = draw.mock.calls[1] ?? []
      expect(panelRequest).toMatchObject({
        size: 2,
        seedKey: 'proposal-2:panel',
      })
      expect(freshRequest).toMatchObject({
        size: 2,
        seedKey: 'proposal-2:fresh',
      })
      // The panel part is rested members only.
      const panelIds = idOperatorOf(panelRequest)
      expect(panelIds?.operator).toBe('in')
      expect([...(panelIds?.values ?? [])].sort()).toEqual([...rested].sort())
      // The fresh part holds no member and nobody contacted recently.
      const freshIds = idOperatorOf(freshRequest)
      expect(freshIds?.operator).toBe('notIn')
      expect(freshIds?.values).toEqual(
        expect.arrayContaining([...rested, recentMember, recentResident]),
      )
      expect(await sampleMemberIds(response.data.id)).toEqual(
        [...rested, ...fresh].sort(),
      )
      const row = await service.prisma.voterFileFilter.findUniqueOrThrow({
        where: { id: response.data.id },
      })
      expect(row.sampleSize).toBe(4)
    })

    it('draws the fresh part alone when nobody is on the panel', async () => {
      const slug = await setupServeOrg('no-panel')
      const fresh = [randomUUID(), randomUUID()]
      stubAudience(58_520)
      const draw = stubDraw(fresh)

      const response = await createFilter(slug, {
        name: 'New residents',
        hasCellPhone: true,
        notContactedRecently: true,
        sample: { size: 4, panelSize: 2 },
      })

      expect(response.status).toBe(HttpStatus.CREATED)
      expect(draw).toHaveBeenCalledTimes(1)
      expect(draw.mock.calls[0]?.[0]).toMatchObject({ size: 2 })
      expect(await sampleMemberIds(response.data.id)).toEqual([...fresh].sort())
    })

    it('refuses a panel part for a Win campaign', async () => {
      const slug = `campaign-panel-sample-${Date.now()}`
      await service.prisma.organization.create({
        data: {
          slug,
          ownerId: service.user.id,
          overrideDistrictId: randomUUID(),
        },
      })

      const response = await createFilter(slug, {
        name: 'Panel',
        hasCellPhone: true,
        sample: { size: 4, panelSize: 2 },
      })

      expect(response.status).toBe(HttpStatus.BAD_REQUEST)
    })
  })

  it('refuses a sample on a list drawn on the map', async () => {
    const slug = await setupServeOrg('geo')

    const response = await createFilter(slug, {
      name: 'Both',
      geoPoly: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
      sample: { size: 10 },
    })

    expect(response.status).toBe(HttpStatus.BAD_REQUEST)
  })

  // A report back goes to everyone who answered the priority on any channel,
  // each person once, so its list is those people, frozen, minus anyone who
  // has opted out since.
  describe('a report back on a send', () => {
    const seedSend = async (
      slug: string,
      answeredByText: string[],
      answeredAtDoor: string[] = [],
    ) => {
      const electedOffice = await service.prisma.electedOffice.create({
        data: { organizationSlug: slug, userId: service.user.id },
      })
      const priority = await service.prisma.priority.create({
        data: {
          electedOfficeId: electedOffice.id,
          title: 'Parking',
          description: 'Not enough of it.',
          source: 'user_stated',
        },
      })
      const send = await service.prisma.outreach.create({
        data: {
          organizationSlug: slug,
          campaignId: null,
          outreachType: 'text',
          status: 'completed',
          priorityId: priority.id,
        },
      })
      await service.prisma.pollIndividualMessage.createMany({
        data: answeredByText.map((personId) => ({
          id: randomUUID(),
          personId,
          sentAt: new Date(),
          sender: 'CONSTITUENT' as const,
          isOptOut: false,
          outreachId: send.id,
        })),
      })
      if (answeredAtDoor.length > 0) {
        const walk = await service.prisma.outreach.update({
          where: { id: (await seedTurfEffort(service, slug)).outreachId },
          data: { priorityId: priority.id },
        })
        await service.prisma.contactInteractionDoorKnock.createMany({
          data: answeredAtDoor.map((personId) => ({
            organizationSlug: slug,
            personId,
            occurredAt: new Date(),
            outcome: 'answered' as const,
            outreachId: walk.id,
          })),
        })
      }
      return send
    }

    it('freezes everyone who answered on any channel once, minus opt-outs', async () => {
      const slug = await setupServeOrg('report-back')
      const [kept, doorOnly, optedOut] = [
        randomUUID(),
        randomUUID(),
        randomUUID(),
      ]
      // `kept` answered by text and at the door: one person.
      const send = await seedSend(slug, [kept, optedOut], [doorOnly])
      await service.prisma.contactInteractionText.create({
        data: {
          organizationSlug: slug,
          personId: optedOut,
          occurredAt: new Date(),
          outreachId: send.id,
          respondedAt: new Date(),
          optedOutAt: new Date(),
        },
      })
      const draw = stubDraw([])

      const response = await createFilter(slug, {
        name: 'Everyone who answered about parking',
        sample: { size: 3, recipientsOfOutreachId: send.id },
      })

      expect(response.status).toBe(HttpStatus.CREATED)
      expect(draw).not.toHaveBeenCalled()
      expect(await sampleMemberIds(response.data.id)).toEqual(
        [kept, doorOnly].sort(),
      )
    })

    it("reaches nobody from another office's send", async () => {
      const other = await setupServeOrg('report-back-other')
      const send = await seedSend(other, [randomUUID()])
      const slug = await setupServeOrg('report-back-mine')

      const response = await createFilter(slug, {
        name: 'Not mine',
        sample: { size: 1, recipientsOfOutreachId: send.id },
      })

      expect(response.status).toBe(HttpStatus.CREATED)
      expect(await sampleMemberIds(response.data.id)).toEqual([])
      const row = await service.prisma.voterFileFilter.findUniqueOrThrow({
        where: { id: response.data.id },
      })
      expect(row.sampleSize).toBe(1)
    })
  })
})
