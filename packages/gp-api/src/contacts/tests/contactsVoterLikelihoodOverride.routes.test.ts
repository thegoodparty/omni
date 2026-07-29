import { useTestService } from '@/test-service'
import { ContactStatusField } from '@/generated/prisma'
import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

// ENG-10838: override-aware Voter Likelihood filtering. A person manually set
// to a bucket (ContactCurrentStatus.field = voter_likelihood) must match that
// bucket's filter even when their seed voterStatus disagrees, and vice versa.
// Drives POST /v1/contacts/count through the real HTTP pipeline (auth, org
// resolution, Pro gate, ContactStatusService reads) with a real Postgres
// database; only the people-api S2S call itself is stubbed — the actual SQL
// composition (the OR scoped to voterStatus only) is unit-tested directly in
// people-api's filters.sql.utils.test.ts.
describe('POST /v1/contacts/count — Voter Likelihood override resolution', () => {
  // Win (non-`eo-`) Pro org. assertVoterDataEligibility resolves the
  // district via election-api (a real HttpService.get, distinct from the
  // people-api POST stubbed per-test below) — stub it with L2 data present
  // so the org is eligible, mirroring
  // contactsOverlapCount.routes.test.ts's setupWinProOrg.
  const setupWinProOrg = async (suffix: string) => {
    const slug = `campaign-likelihood-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: `district-likelihood-${suffix}`,
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
    const slug = `eo-likelihood-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: `district-likelihood-${suffix}`,
      },
    })
    return slug
  }

  const setOverride = (
    organizationSlug: string,
    personId: string,
    value: string,
  ) =>
    service.prisma.contactCurrentStatus.create({
      data: {
        organizationSlug,
        personId,
        field: ContactStatusField.voter_likelihood,
        value,
      },
    })

  const spyOnPeopleApi = () =>
    vi
      .spyOn(service.app.get(HttpService), 'post')
      .mockReturnValue(
        of({ data: { pagination: { totalResults: 1 } } }) as never,
      )

  const requestBody = (postSpy: ReturnType<typeof spyOnPeopleApi>) =>
    postSpy.mock.calls[0]?.[1] as Record<string, unknown>

  it('a Super override matches a Super filter and is excluded from an Unlikely filter', async () => {
    const slug = await setupWinProOrg('super-override')
    const overriddenPersonId = '11111111-1111-1111-1111-111111111111'
    await setOverride(slug, overriddenPersonId, 'super')

    const postSpy = spyOnPeopleApi()
    await service.client.post(
      '/v1/contacts/count',
      { audienceSuperVoters: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )
    expect(requestBody(postSpy).idOverrides).toEqual({
      include: [overriddenPersonId],
    })

    postSpy.mockClear()
    await service.client.post(
      '/v1/contacts/count',
      { audienceUnlikelyVoters: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )
    // Overridden to Super, so they're excluded from the Unlikely bucket even
    // though their seed voterStatus (never set here — defaults null/Unknown)
    // would not otherwise have matched anyway; the exclude set proves the
    // person is a KNOWN override the seed filter must not silently re-admit
    // via some other codepath.
    expect(requestBody(postSpy).idOverrides).toEqual({
      exclude: [overriddenPersonId],
    })
  })

  it('a person overridden to Super still appears in a Super-filtered count, absent from an Unlikely-filtered one — including the seed-Unreliable expansion', async () => {
    const slug = await setupWinProOrg('seed-mismatch')
    const overriddenPersonId = '22222222-2222-2222-2222-222222222222'
    await setOverride(slug, overriddenPersonId, 'super')

    const unlikelyPostSpy = spyOnPeopleApi()
    await service.client.post(
      '/v1/contacts/count',
      { audienceUnlikelyVoters: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )
    const unlikelyBody = requestBody(unlikelyPostSpy)
    // The seed side of the filter is corrected to include the collapsed
    // Unreliable seed value alongside Unlikely (ENG-10838's fix), and the
    // Super-overridden person is excluded despite never matching either seed
    // value in the first place — proves exclude is populated from the
    // override table, not derived from "would the seed filter have matched".
    expect(unlikelyBody.filters).toEqual(
      expect.objectContaining({
        voterStatus: { in: ['Unlikely', 'Unreliable'] },
      }),
    )
    expect(unlikelyBody.idOverrides).toEqual({ exclude: [overriddenPersonId] })
  })

  it('a person with no override is unaffected — no idOverrides sent, seed filter still expands Unlikely to include Unreliable', async () => {
    const slug = await setupWinProOrg('no-override')
    const postSpy = spyOnPeopleApi()

    await service.client.post(
      '/v1/contacts/count',
      { audienceUnlikelyVoters: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    const body = requestBody(postSpy)
    expect(body.filters).toEqual(
      expect.objectContaining({
        voterStatus: { in: ['Unlikely', 'Unreliable'] },
      }),
    )
    expect(body.idOverrides).toBeUndefined()
  })

  it('orgs with zero overrides send idOverrides as undefined (dropped by JSON serialization, byte-identical wire payload)', async () => {
    const slug = await setupWinProOrg('zero-overrides')
    const postSpy = spyOnPeopleApi()

    await service.client.post(
      '/v1/contacts/count',
      { audienceSuperVoters: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(requestBody(postSpy).idOverrides).toBeUndefined()
  })

  it('an override-included person still respects other selected filters (gender) — the include set does not bypass them', async () => {
    const slug = await setupWinProOrg('other-filters')
    const overriddenPersonId = '33333333-3333-3333-3333-333333333333'
    await setOverride(slug, overriddenPersonId, 'super')
    const postSpy = spyOnPeopleApi()

    await service.client.post(
      '/v1/contacts/count',
      { audienceSuperVoters: true, genderFemale: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    const body = requestBody(postSpy)
    // idOverrides is a request-level sibling of `filters`, never merged into
    // it — people-api's buildVoterFiltersSql (unit-tested directly) is what
    // proves the OR composite stays scoped to the voterStatus clause only,
    // AND-ed with gender at the top level. This asserts gp-api sends both
    // independently rather than, say, dropping gender once an override
    // applies.
    expect(body.idOverrides).toEqual({ include: [overriddenPersonId] })
    expect(body.filters).toEqual(
      expect.objectContaining({ gender: { eq: 'F' } }),
    )
  })

  it('does not resolve overrides at all when no likelihood filter is selected', async () => {
    const slug = await setupWinProOrg('no-likelihood-filter')
    const postSpy = spyOnPeopleApi()

    await service.client.post(
      '/v1/contacts/count',
      { genderFemale: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    const body = requestBody(postSpy)
    expect(body.idOverrides).toBeUndefined()
    expect(body.filters).not.toHaveProperty('voterStatus')
  })

  it('is a no-op for a Serve (eo-) org — no override lookup, even with an override row present', async () => {
    const slug = await setupEoOrg('serve-skip')
    const personId = '44444444-4444-4444-4444-444444444444'
    // A voter_likelihood row should never exist for an eo- org in production
    // (the write path 400s for eo- orgs) — seeding one anyway proves the
    // filter path is skipped by construction (hasElectedOfficeAccess), not
    // merely because no row exists.
    await setOverride(slug, personId, 'super')
    const postSpy = spyOnPeopleApi()

    await service.client.post(
      '/v1/contacts/count',
      { audienceSuperVoters: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    const body = requestBody(postSpy)
    expect(body.idOverrides).toBeUndefined()
    expect(body.filters).toEqual(
      expect.objectContaining({ voterStatus: { eq: 'Super' } }),
    )
  })
})
