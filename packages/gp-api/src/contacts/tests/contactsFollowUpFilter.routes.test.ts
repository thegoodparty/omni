import { randomUUID } from 'node:crypto'
import { useTestService } from '@/test-service'
import {
  ContactStatusField,
  ContactStatusSource,
  FollowUpStatus,
  OutreachType,
} from '@/generated/prisma'
import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

// The `followUpRequested` saved-filter dimension: Serve's "who still owes a
// follow-up" audience. Driven through POST /v1/contacts/count over the real
// pipeline (auth, org resolution, real Postgres contact_current_status rows);
// only the in-process people-db list query is stubbed, since what this
// dimension contributes is the `id` constraint it hands that query.
describe('POST /v1/contacts/count — follow-up filter', () => {
  const setupEoOrg = async (suffix: string) => {
    const slug = `eo-follow-up-filter-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        // The ported people-db DTOs run through Zod, whose districtId is
        // z.guid() — a non-UUID placeholder fails validation here.
        overrideDistrictId: randomUUID(),
      },
    })
    return slug
  }

  const setupWinProOrg = async (suffix: string) => {
    const slug = `campaign-follow-up-filter-${suffix}-${Date.now()}`
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
          state: 'CA',
          L2DistrictType: 'City',
          L2DistrictName: 'Springfield',
        },
        status: 200,
      }) as never,
    )
    return slug
  }

  const setFollowUp = (
    organizationSlug: string,
    personId: string,
    toValue: FollowUpStatus,
  ) =>
    service.app.get(ContactStatusService).changeStatus({
      organizationSlug,
      personId,
      field: ContactStatusField.follow_up,
      toValue,
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
      fallbackFromValue: FollowUpStatus.cleared,
    })

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

  const count = (slug: string, body: Record<string, unknown>) =>
    service.client.post('/v1/contacts/count', body, {
      headers: { [ORG_SLUG_HEADER]: slug },
      validateStatus: () => true,
    })

  it('resolves to an in-filter over exactly the people still flagged', async () => {
    const slug = await setupEoOrg('flagged')
    const flagged = randomUUID()
    const never = randomUUID()
    await setFollowUp(slug, flagged, FollowUpStatus.requested)
    // Never flagged at all — no row, so not in the audience.
    void never

    const findPeopleSpy = spyOnFindPeople()
    await count(slug, { followUpRequested: true })

    const dto = findPeopleSpy.mock.calls[0]?.[0]
    expect(dto?.filters.filterOperators.id).toEqual({
      operator: 'in',
      values: [flagged],
      includeNull: false,
    })
  })

  // The reason this reads the standing flag instead of the interaction
  // column: a request already met must leave the call list, or the list can
  // never be worked down.
  it('drops a person whose flag was cleared after it was raised', async () => {
    const slug = await setupEoOrg('cleared')
    const stillOwed = randomUUID()
    const alreadyDone = randomUUID()
    await setFollowUp(slug, stillOwed, FollowUpStatus.requested)
    await setFollowUp(slug, alreadyDone, FollowUpStatus.requested)
    await setFollowUp(slug, alreadyDone, FollowUpStatus.cleared)

    const findPeopleSpy = spyOnFindPeople()
    await count(slug, { followUpRequested: true })

    const dto = findPeopleSpy.mock.calls[0]?.[0]
    expect(dto?.filters.filterOperators.id).toEqual({
      operator: 'in',
      values: [stillOwed],
      includeNull: false,
    })
  })

  // Nobody flagged is an empty audience, not an absent filter. Falling
  // through to "no constraint" would hand back the whole district — the worst
  // possible default for something that feeds a phone list.
  it('resolves to an empty audience when nobody is flagged, never the district', async () => {
    const slug = await setupEoOrg('nobody')

    const findPeopleSpy = spyOnFindPeople()
    const res = await count(slug, { followUpRequested: true })

    expect(res.status).toBe(201)
    expect(res.data.count).toBe(0)
    expect(findPeopleSpy).not.toHaveBeenCalled()
  })

  // What makes "who from this closed campaign still needs calling back"
  // expressible: the standing flag AND-ed with an activity condition.
  it('intersects with an activity condition rather than replacing it', async () => {
    const slug = await setupEoOrg('intersect')
    const flaggedAndReached = randomUUID()
    const flaggedOnly = randomUUID()
    const reachedOnly = randomUUID()

    await setFollowUp(slug, flaggedAndReached, FollowUpStatus.requested)
    await setFollowUp(slug, flaggedOnly, FollowUpStatus.requested)

    const textService = service.app.get(ContactInteractionTextService)
    await textService.create({
      organizationSlug: slug,
      personId: flaggedAndReached,
      occurredAt: new Date(),
    })
    await textService.create({
      organizationSlug: slug,
      personId: reachedOnly,
      occurredAt: new Date(),
    })

    const findPeopleSpy = spyOnFindPeople()
    await count(slug, {
      followUpRequested: true,
      activityConditions: [{ outreachType: OutreachType.text, actions: [] }],
    })

    const dto = findPeopleSpy.mock.calls[0]?.[0]
    expect(dto?.filters.filterOperators.id).toEqual({
      operator: 'in',
      values: [flaggedAndReached],
      includeNull: false,
    })
  })

  // The overlap strip resolves each SAVED list on its own path, which skips
  // convertVoterFileFilterToFilters' handled-separately fields. Unresolved,
  // a five-person follow-up list would contribute everyone its campaign
  // reached and the strip would over-report by the difference.
  it('honours the flag when a saved list is resolved for the overlap count', async () => {
    const slug = await setupEoOrg('overlap')
    const flagged = randomUUID()
    const reachedNotFlagged = randomUUID()
    await setFollowUp(slug, flagged, FollowUpStatus.requested)

    const textService = service.app.get(ContactInteractionTextService)
    await textService.create({
      organizationSlug: slug,
      personId: flagged,
      occurredAt: new Date(),
    })
    await textService.create({
      organizationSlug: slug,
      personId: reachedNotFlagged,
      occurredAt: new Date(),
    })

    const saved = await service.prisma.voterFileFilter.create({
      data: {
        organizationSlug: slug,
        name: 'Follow-ups',
        followUpRequested: true,
        activityConditions: {
          create: [{ outreachType: OutreachType.text, actions: [] }],
        },
      },
    })
    expect(saved.followUpRequested).toBe(true)

    const overlapSpy = vi
      .spyOn(service.app.get(VoterQueryService), 'getOverlapCount')
      .mockResolvedValue({ count: 0 })

    await service.client.post(
      '/v1/contacts/overlap-count',
      { followUpRequested: true },
      { headers: { [ORG_SLUG_HEADER]: slug }, validateStatus: () => true },
    )

    const dto = overlapSpy.mock.calls[0]?.[0]
    const savedSet = dto?.savedFilterSets?.[0]
    expect(savedSet?.filterOperators?.id).toEqual({
      operator: 'in',
      values: [flagged],
      includeNull: false,
    })
  })

  // Refused rather than ignored: silently dropping it would return a WIDER
  // audience than asked for, and a phone list built from that calls people
  // nobody selected.
  it('400s for a Win organization instead of ignoring the filter', async () => {
    const slug = await setupWinProOrg('win')

    const findPeopleSpy = spyOnFindPeople()
    const res = await count(slug, { followUpRequested: true })

    expect(res.status).toBe(400)
    expect(findPeopleSpy).not.toHaveBeenCalled()
  })
})
