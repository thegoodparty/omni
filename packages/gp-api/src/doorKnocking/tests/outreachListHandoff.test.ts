import { beforeEach, describe, expect, it } from 'vitest'
import type { GeoJsonPolygon } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'

// The server half of the "Send outreach → door knocking" journey covered end to
// end in
// gp-webapp/e2e-tests/tests/app/dashboard/outreach/outreach-list-to-door-knocking.spec.ts.
//
// The browser test proves the list carries through and lands preselected in the
// create flow's who step. What it cannot prove cheaply is the negative that
// makes that the CORRECT behaviour rather than a missing feature: a
// door-knocking saved list is a `DoorKnockingTurf`, and a turf needs a drawn
// polygon as well as the list it narrows. The handoff carries an integer in a
// query param and no geography, so it could not create one even if it wanted
// to. Asserted here, where it is a Prisma count instead of a WebGL canvas.
const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'
const DISTRICT_ID = '10000000-0000-0000-0000-000000000000'

// A closed triangle over Cheyenne — the district the door-knocking e2e specs
// pin. Nothing here knocks it, so it only has to satisfy GeoJsonPolygonSchema:
// at least four positions with the first repeated as the last.
const RING: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-104.83, 41.13],
      [-104.81, 41.13],
      [-104.82, 41.15],
      [-104.83, 41.13],
    ],
  ],
}

describe('outreach list handoff to door knocking', () => {
  let orgSlug: string

  const orgHeaders = () => ({ headers: { [ORG_SLUG_HEADER]: orgSlug } })

  beforeEach(async () => {
    const suffix = Date.now()
    orgSlug = `campaign-handoff-${suffix}`
    await service.prisma.organization.create({
      data: {
        slug: orgSlug,
        ownerId: service.user.id,
        overrideDistrictId: DISTRICT_ID,
      },
    })
    // Pro: every door-knocking route but the two suppression writes is gated on
    // it (ContactsService.assertProAccess), and so is saving a voter list.
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${orgSlug}-campaign`,
        organizationSlug: orgSlug,
        isPro: true,
      },
    })
  })

  // The literal question: saving a list in Voter Data and pressing "Send
  // outreach" — does a door-knocking saved list appear? Creating the list is
  // the only write that whole gesture performs; the two steps after it are
  // navigations.
  it('saving a voter list creates no door-knocking turf', async () => {
    const created = await service.client.post(
      '/v1/voters/voter-file/filter',
      { name: 'GOTV walk list', partyIndependent: true },
      orgHeaders(),
    )
    expect(created.status).toBe(201)

    const listed = await service.client.get(
      '/v1/door-knocking/turfs',
      orgHeaders(),
    )
    expect(listed.status).toBe(200)
    expect(listed.data).toHaveLength(0)
    expect(
      await service.prisma.doorKnockingTurf.count({
        where: { voterFileFilter: { organizationSlug: orgSlug } },
      }),
    ).toBe(0)
  })

  // Why the answer above is right rather than a gap: the polygon is required,
  // so the id the handoff carries is genuinely not enough on its own. Both
  // halves are asserted against the same list so the only difference between
  // the refusal and the success is the geography.
  it('a turf needs the drawn polygon as well as the list', async () => {
    const { data: list } = await service.client.post(
      '/v1/voters/voter-file/filter',
      { name: 'GOTV walk list' },
      orgHeaders(),
    )

    const withoutPolygon = await service.client.post(
      '/v1/door-knocking/turfs',
      { voterFileFilterId: list.id, name: 'No shape', color: '#2563eb' },
      { ...orgHeaders(), validateStatus: () => true },
    )
    expect(withoutPolygon.status).toBe(400)

    const withPolygon = await service.client.post(
      '/v1/door-knocking/turfs',
      {
        voterFileFilterId: list.id,
        name: 'Elm St walk',
        color: '#2563eb',
        geoPoly: RING,
      },
      orgHeaders(),
    )
    expect(withPolygon.status).toBe(201)

    // The turf narrows the list rather than copying it: same row, still one
    // audience. This is what lets the same saved list back a phone bank and a
    // walk without either owning it — and why the create flow attaches the
    // carried id instead of minting a second list from it.
    expect(withPolygon.data.voterFileFilterId).toBe(list.id)
    const listed = await service.client.get(
      '/v1/door-knocking/turfs',
      orgHeaders(),
    )
    expect(listed.data).toHaveLength(1)
    expect(
      await service.prisma.voterFileFilter.count({
        where: { organizationSlug: orgSlug },
      }),
    ).toBe(1)
  })
})
