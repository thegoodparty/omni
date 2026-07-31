import { randomUUID } from 'node:crypto'
import { useTestService } from '@/test-service'
import { OutreachType } from '@/generated/prisma'
import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import { ContactInteractionDoorKnockService } from '@/contactInteraction/services/contactInteractionDoorKnock.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

// ENG-10839: the contacts-made filter (0-5+ pills). Drives POST
// /v1/contacts/count through the real HTTP pipeline (auth, org resolution,
// Pro gate, real Postgres contact_interaction_* rows); only the in-process
// people-db list query itself is stubbed — the SQL composition is unit-tested
// directly in filters.sql.util.test.ts, and the bucket SQL itself in
// contactsMadeResolution.service.test.ts.
describe('POST /v1/contacts/count — contacts-made filter', () => {
  const setupWinProOrg = async (suffix: string) => {
    const slug = `campaign-contacts-made-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        // The ported people-db DTOs run through Zod, whose districtId is
        // z.guid() — a non-UUID placeholder fails validation here.
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
          state: 'CA',
          L2DistrictType: 'City',
          L2DistrictName: 'Springfield',
        },
        status: 200,
      }) as never,
    )
    return slug
  }

  const setupEoOrg = async (suffix: string) => {
    const slug = `eo-contacts-made-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: randomUUID(),
      },
    })
    return slug
  }

  const seedOutreach = async (organizationSlug: string) => {
    const campaign = await service.prisma.campaign.findFirstOrThrow({
      where: { organizationSlug },
    })
    const outreach = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        outreachType: OutreachType.text,
        organizationSlug,
      },
    })
    return outreach.id
  }

  const seedText = (organizationSlug: string, personId: string) =>
    service.app.get(ContactInteractionTextService).create({
      organizationSlug,
      personId,
      occurredAt: new Date(),
    })

  const seedDoorKnock = (organizationSlug: string, personId: string) =>
    service.app.get(ContactInteractionDoorKnockService).create({
      organizationSlug,
      personId,
      occurredAt: new Date(),
      outcome: 'answered',
    })

  // The count route reads response.pagination.totalResults; the id filter and
  // contactsMadeIdOverrides the route forwards ride the DTO the in-process
  // VoterQueryService.findPeople receives.
  const spyOnFindPeople = () =>
    vi
      .spyOn(service.app.get(VoterQueryService), 'findPeople')
      .mockResolvedValue({
        pagination: {
          totalResults: 1,
          currentPage: 1,
          pageSize: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        people: [],
      })

  it('selecting "2" resolves to an in-filter over exactly the people with 2 logged interactions (1 text + 1 door knock)', async () => {
    const slug = await setupWinProOrg('exact-two')
    const pTwo = randomUUID()
    const pOne = randomUUID()
    await seedOutreach(slug)
    await seedText(slug, pTwo)
    await seedDoorKnock(slug, pTwo)
    // A single-interaction person must not leak into the "2" bucket.
    await seedText(slug, pOne)

    const findPeopleSpy = spyOnFindPeople()
    await service.client.post(
      '/v1/contacts/count',
      { contactsMade2: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    const dto = findPeopleSpy.mock.calls[0]?.[0]
    expect(dto?.filters.filterOperators.id).toEqual({
      operator: 'in',
      values: [pTwo],
      includeNull: false,
    })
    expect(dto?.contactsMadeIdOverrides).toBeUndefined()
  })

  it('selecting "0" resolves to a notIn-filter over everyone ever contacted', async () => {
    const slug = await setupWinProOrg('never-contacted')
    const pContacted = randomUUID()
    await seedOutreach(slug)
    await seedText(slug, pContacted)

    const findPeopleSpy = spyOnFindPeople()
    await service.client.post(
      '/v1/contacts/count',
      { contactsMade0: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    const dto = findPeopleSpy.mock.calls[0]?.[0]
    expect(dto?.filters.filterOperators.id).toEqual({
      operator: 'notIn',
      values: [pContacted],
    })
    expect(dto?.contactsMadeIdOverrides).toBeUndefined()
  })

  it('selecting "0" and "3" composes the contactsMadeIdOverrides OR clause (never-contacted plus exactly-3)', async () => {
    const slug = await setupWinProOrg('zero-and-three')
    const pThree = randomUUID()
    const pOne = randomUUID()
    await seedOutreach(slug)
    for (let i = 0; i < 3; i += 1) {
      await seedDoorKnock(slug, pThree)
    }
    await seedText(slug, pOne)

    const findPeopleSpy = spyOnFindPeople()
    await service.client.post(
      '/v1/contacts/count',
      { contactsMade0: true, contactsMade3: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    const dto = findPeopleSpy.mock.calls[0]?.[0]
    // No plain `id` filter for this mixed case — the composite travels as
    // its own independent contactsMadeIdOverrides clause instead.
    expect(dto?.filters.filterOperators.id).toBeUndefined()
    expect(dto?.contactsMadeIdOverrides).toEqual({
      include: [pThree],
      exclude: expect.arrayContaining([pThree, pOne]),
    })
  })

  it('does not resolve contacts-made at all when no bucket is selected', async () => {
    const slug = await setupWinProOrg('no-selection')
    const findPeopleSpy = spyOnFindPeople()

    await service.client.post(
      '/v1/contacts/count',
      { genderFemale: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    const dto = findPeopleSpy.mock.calls[0]?.[0]
    expect(dto?.contactsMadeIdOverrides).toBeUndefined()
    expect(dto?.filters.filterOperators.id).toBeUndefined()
  })

  // ENG-10839: an ordinary Win combination — an activity condition AND a
  // contacts-made bucket in the same request. Both resolve to a plain `id`
  // in-filter destined for the same people-db `id` key, so this exercises
  // intersectIdFilterResolutions' real in+in branch through the full route,
  // not just the pure-function unit test.
  it('combines an activity condition with a contacts-made bucket via AND (not just OR-within-contactsMade)', async () => {
    const slug = await setupWinProOrg('combined-with-activity')
    const outreachId = await seedOutreach(slug)
    const pMatch = randomUUID()
    const pRespondedButThree = randomUUID()
    const pTwoNotResponded = randomUUID()

    // Responded to the outreach AND has exactly 2 total interactions
    // (1 text + 1 door knock) — must survive the intersection.
    await service.app.get(ContactInteractionTextService).create({
      organizationSlug: slug,
      personId: pMatch,
      occurredAt: new Date(),
      outreachId,
      respondedAt: new Date(),
    })
    await seedDoorKnock(slug, pMatch)

    // Responded to the outreach but has 3 total interactions — excluded by
    // the contacts-made "2" bucket even though the activity condition alone
    // would match them.
    await service.app.get(ContactInteractionTextService).create({
      organizationSlug: slug,
      personId: pRespondedButThree,
      occurredAt: new Date(),
      outreachId,
      respondedAt: new Date(),
    })
    await seedDoorKnock(slug, pRespondedButThree)
    await service.app.get(ContactInteractionDoorKnockService).create({
      organizationSlug: slug,
      personId: pRespondedButThree,
      occurredAt: new Date(),
      outcome: 'answered',
    })

    // Has exactly 2 total interactions but never responded to the outreach —
    // excluded by the activity condition even though contacts-made "2"
    // alone would match them.
    await seedText(slug, pTwoNotResponded)
    await seedDoorKnock(slug, pTwoNotResponded)

    const findPeopleSpy = spyOnFindPeople()
    await service.client.post(
      '/v1/contacts/count',
      {
        contactsMade2: true,
        activityConditions: [
          { outreachType: 'text', outreachId, actions: ['responded'] },
        ],
      },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    const dto = findPeopleSpy.mock.calls[0]?.[0]
    expect(dto?.filters.filterOperators.id).toEqual({
      operator: 'in',
      values: [pMatch],
      includeNull: false,
    })
  })

  it('rejects a contacts-made selection for a Serve (eo-) organization', async () => {
    const slug = await setupEoOrg('rejected')

    const response = await service.client.post(
      '/v1/contacts/count',
      { contactsMade2: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(400)
  })
})
