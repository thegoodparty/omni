import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { GeoJsonPolygon } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import {
  Campaign,
  ContactStatusField,
  ContactStatusSource,
  DoNotKnockStatus,
  DoorKnockOutcome,
  OutreachStatus,
  OutreachType,
  VoterFileFilter,
} from '../../generated/prisma'

const service = useTestService()

// Two people behind one door at the first stop, one person at the second: the
// pair is what proves doors are addresses rather than stop rows or targets.
const PERSON_A1 = '00000001-1111-1111-1111-111111111111'
const PERSON_A2 = '00000002-1111-1111-1111-111111111111'
const PERSON_B = '00000003-1111-1111-1111-111111111111'

// Production unit-key format (DOOR_KNOCKING_UNIT_KEY_COLUMNS order).
const KEY_A = '1200|W|ELM|ST||3B|62704'
const KEY_B = '1204|W|ELM|ST|||62704'

const GEO_POLY: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-87.66, 41.89],
      [-87.64, 41.89],
      [-87.65, 41.91],
      [-87.66, 41.89],
    ],
  ],
}

describe('GET /v1/outreach/:id — doorKnocking block', () => {
  let campaign: Campaign
  let orgSlug: string
  let filter: VoterFileFilter

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    orgSlug = `outreach-dk-${suffix}`

    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `outreach-dk-campaign-${suffix}`,
        organizationSlug: orgSlug,
        isPro: true,
        details: {},
        data: {},
        aiContent: {},
      },
    })
    filter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: orgSlug, name: 'DK audience' },
    })
  })

  // The frozen chain the knock transaction writes, built directly rather than
  // through the knock endpoint: this suite is about the READ, and going
  // through the knock would put a stubbed Geoapify plan between the fixture
  // and the assertion.
  const knockedTurf = async ({
    completedAt = null,
    archivedAt = null,
    deletedAt = null,
    name = 'Elm St walk',
  }: {
    completedAt?: Date | null
    archivedAt?: Date | null
    deletedAt?: Date | null
    name?: string
  } = {}) => {
    const turf = await service.prisma.doorKnockingTurf.create({
      data: {
        voterFileFilterId: filter.id,
        name,
        color: '#22aa55',
        geoPoly: GEO_POLY,
        completedAt,
        archivedAt,
        deletedAt,
      },
    })
    const route = await service.prisma.doorKnockingRoute.create({
      data: {
        doorKnockingTurfId: turf.id,
        mode: 'walk',
        loop: false,
        totalSeconds: 900,
        totalMeters: 1200,
        credits: 30,
        stops: {
          create: [
            {
              seq: 1,
              lat: 41.9,
              lng: -87.65,
              displayAddress: '1200 W Elm St',
              legSeconds: 0,
              legMeters: 0,
              targets: {
                create: [
                  {
                    personId: PERSON_A1,
                    name: 'Liv Current',
                    addressKey: KEY_A,
                  },
                  { personId: PERSON_A2, name: 'Also Here', addressKey: KEY_A },
                ],
              },
            },
            {
              seq: 2,
              lat: 41.901,
              lng: -87.651,
              displayAddress: '1204 W Elm St',
              legSeconds: 60,
              legMeters: 100,
              targets: {
                create: [
                  {
                    personId: PERSON_B,
                    name: 'Marisol Vega',
                    addressKey: KEY_B,
                  },
                ],
              },
            },
          ],
        },
      },
    })
    const outreach = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: orgSlug,
        outreachType: OutreachType.nativeDoorKnocking,
        status: OutreachStatus.in_progress,
        name,
        voterFileFilterId: filter.id,
        doorKnockingRouteId: route.id,
        date: new Date(),
      },
    })
    return { turf, route, outreach }
  }

  // `not_home` on purpose: "logged" is every door somebody recorded an
  // outcome at, and three of the outcomes are not conversations. A fixture
  // that only ever logged `answered` would pass just as well against a
  // "reached" count, which is the wrong number.
  const logKnock = (personId: string) =>
    service.prisma.contactInteractionDoorKnock.create({
      data: {
        organizationSlug: orgSlug,
        personId,
        occurredAt: new Date(),
        outcome: DoorKnockOutcome.not_home,
        sourceId: `src-${personId}`,
      },
    })

  const markDoNotKnock = async (personId: string) => {
    await service.prisma.contactCurrentStatus.create({
      data: {
        organizationSlug: orgSlug,
        personId,
        field: ContactStatusField.do_not_knock,
        value: DoNotKnockStatus.active,
      },
    })
    await service.prisma.contactStatusEvent.create({
      data: {
        organizationSlug: orgSlug,
        personId,
        field: ContactStatusField.do_not_knock,
        toValue: DoNotKnockStatus.active,
        source: ContactStatusSource.manual,
      },
    })
  }

  const detail = async (id: number) => {
    const res = await service.client.get(`/v1/outreach/${id}`, {
      headers: { 'x-organization-slug': orgSlug },
    })
    expect(res.status).toBe(HttpStatus.OK)
    return res.data
  }

  it('reports doors, people and logged progress off the frozen route', async () => {
    const { turf, route, outreach } = await knockedTurf()
    await logKnock(PERSON_A1)

    const data = await detail(outreach.id)

    expect(data.doorKnocking).toMatchObject({
      turfId: turf.id,
      routeId: route.id,
      turfName: 'Elm St walk',
      // Two stops, and the two targets sharing KEY_A at the first are one
      // door: doors are addresses within a stop, never target rows.
      doorCount: 2,
      peopleCount: 3,
      loggedCount: 1,
    })
  })

  // The counting rule that has to match the rail exactly: a flagged resident
  // leaves `peopleCount` (nobody to talk to) but their house is still a door
  // on the sheet. Getting this backwards is how the drawer would hold a
  // canvasser who correctly skipped a flagged house below 100%.
  it('drops do-not-knock residents from people but not their door', async () => {
    const { outreach } = await knockedTurf()
    await markDoNotKnock(PERSON_B)

    const data = await detail(outreach.id)

    expect(data.doorKnocking).toMatchObject({
      doorCount: 2,
      peopleCount: 2,
      loggedCount: 0,
    })
  })

  // The whole reason for the reverse edge: these live on the turf, and the
  // envelope's own columns are mirrors written off them.
  it('carries the turf lifecycle rather than the envelope mirror', async () => {
    const completedAt = new Date('2026-08-01T12:00:00.000Z')
    const archivedAt = new Date('2026-08-02T12:00:00.000Z')
    const { outreach } = await knockedTurf({ completedAt, archivedAt })

    const data = await detail(outreach.id)

    expect(data.doorKnocking?.completedAt).toEqual(completedAt.toISOString())
    expect(data.doorKnocking?.archivedAt).toEqual(archivedAt.toISOString())
    // The envelope itself was never mirrored in this fixture, which is the
    // pre-mirror drift the drawer must read past rather than reproduce.
    expect(data.archivedAt).toBeNull()
  })

  // A hard delete would cascade the paid route and the envelope away; a
  // tombstone leaves both standing with no list to describe.
  it('omits the block for a tombstoned turf', async () => {
    const { outreach } = await knockedTurf({ deletedAt: new Date() })

    const data = await detail(outreach.id)

    expect(data.doorKnocking).toBeUndefined()
    expect(data.doorKnockingRouteId).not.toBeNull()
  })

  it('omits the block for a row that is not a native door-knocking walk', async () => {
    const outreach = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: orgSlug,
        outreachType: OutreachType.socialMedia,
        status: OutreachStatus.completed,
        name: 'A post',
      },
    })

    const data = await detail(outreach.id)

    expect(data.doorKnocking).toBeUndefined()
  })
})
