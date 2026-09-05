import jwt from 'jsonwebtoken'
import { useTestService } from '@/test-service'
import { describe, expect, it } from 'vitest'
import { GeoJsonPolygon } from '@goodparty_org/contracts'
import {
  DoorKnockingMode,
  OrganizationRole,
  OutreachType,
  PhoneBankingPurpose,
} from '@/generated/prisma'

const service = useTestService()

// A minimal placeholder — this suite is about notes access, not the
// geometry, and geoPoly is NOT NULL on the turf.
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

const ORG_SLUG_HEADER = 'X-Organization-Slug'

const seedWinOrg = async (opts: {
  slug: string
  ownerId: number
  isPro: boolean
}) => {
  await service.prisma.organization.create({
    data: { slug: opts.slug, ownerId: opts.ownerId },
  })
  await service.prisma.campaign.create({
    data: {
      userId: opts.ownerId,
      slug: `${opts.slug}-campaign`,
      organizationSlug: opts.slug,
      isPro: opts.isPro,
    },
  })
}

const seedEoOrg = (slug: string) =>
  service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })

const authHeaderFor = (clerkId: string) => ({
  Authorization: `Bearer ${jwt.sign(
    { sub: clerkId },
    process.env.AUTH_SECRET!,
    { expiresIn: '1h' },
  )}`,
})

const createVolunteer = async (
  orgSlug: string,
  opts: { clerkId: string; email: string },
) => {
  const volunteer = await service.prisma.user.create({
    data: {
      email: opts.email,
      clerkId: opts.clerkId,
      firstName: 'Vera',
      lastName: 'Volunteer',
    },
  })
  await service.prisma.organizationMembership.create({
    data: {
      organizationSlug: orgSlug,
      userId: volunteer.id,
      role: OrganizationRole.volunteer,
    },
  })
  return volunteer
}

const assignOutreach = (orgSlug: string, outreachId: number, userId: number) =>
  service.prisma.outreachAssignment.create({
    data: { organizationSlug: orgSlug, outreachId, assigneeUserId: userId },
  })

// Builds an assignable outreach envelope reaching personId through the
// phone-banking chain (Outreach -> PhoneBankingList -> ...Entry -> ...Person).
const createPhoneBankingReachablePerson = async (
  orgSlug: string,
  personId: string,
) => {
  const filter = await service.prisma.voterFileFilter.create({
    data: { organizationSlug: orgSlug, name: 'notes audience' },
  })
  const list = await service.prisma.phoneBankingList.create({
    data: {
      organizationSlug: orgSlug,
      voterFileFilterId: filter.id,
      name: 'Notes calls',
      script: 'Hi',
      sheetCount: 1,
      purpose: PhoneBankingPurpose.introduce_myself,
    },
  })
  const outreach = await service.prisma.outreach.create({
    data: {
      organizationSlug: orgSlug,
      outreachType: OutreachType.nativePhoneBanking,
      phoneBankingListId: list.id,
    },
  })
  const entry = await service.prisma.phoneBankingListEntry.create({
    data: {
      phoneBankingListId: list.id,
      seq: 1,
      sheetIndex: 1,
      phone: '3075550001',
    },
  })
  await service.prisma.phoneBankingListEntryPerson.create({
    data: { phoneBankingListEntryId: entry.id, personId, name: 'Jane Voter' },
  })
  return outreach.id
}

// Builds an assignable outreach envelope reaching personId through the
// door-knocking chain (Outreach -> Route -> Stop -> StopTarget).
const createDoorKnockingReachablePerson = async (
  orgSlug: string,
  personId: string,
) => {
  const filter = await service.prisma.voterFileFilter.create({
    data: { organizationSlug: orgSlug, name: 'dk notes audience' },
  })
  const turf = await service.prisma.doorKnockingTurf.create({
    data: {
      voterFileFilterId: filter.id,
      name: 'Turf A',
      color: '#ff0000',
      geoPoly: GEO_POLY,
    },
  })
  const route = await service.prisma.doorKnockingRoute.create({
    data: {
      doorKnockingTurfId: turf.id,
      mode: DoorKnockingMode.walk,
      loop: false,
      totalSeconds: 100,
      totalMeters: 100,
      credits: 1,
    },
  })
  const outreach = await service.prisma.outreach.create({
    data: {
      organizationSlug: orgSlug,
      outreachType: OutreachType.nativeDoorKnocking,
      doorKnockingRouteId: route.id,
    },
  })
  const stop = await service.prisma.doorKnockingStop.create({
    data: {
      doorKnockingRouteId: route.id,
      seq: 1,
      lat: 0,
      lng: 0,
      displayAddress: '123 Main St',
      legSeconds: 1,
      legMeters: 1,
    },
  })
  await service.prisma.doorKnockingStopTarget.create({
    data: {
      doorKnockingStopId: stop.id,
      personId,
      addressKey: 'key-1',
      name: 'Jane Voter',
    },
  })
  return outreach.id
}

describe('Contact notes routes', () => {
  describe('full CRUD cycle', () => {
    it.each([
      {
        name: 'Win Pro org',
        setup: async () => {
          const slug = `win-pro-${Date.now()}`
          await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
          return slug
        },
      },
      {
        name: 'eo- org',
        setup: async () => {
          const slug = `eo-${Date.now()}`
          await seedEoOrg(slug)
          return slug
        },
      },
    ])(
      'create, list, edit, delete for $name',
      async ({ setup }) => {
        const slug = await setup()
        const personId = 'person-1'
        const headers = { [ORG_SLUG_HEADER]: slug }

        const created = await service.client.post(
          `/v1/contacts/${personId}/notes`,
          { body: 'first note' },
          { headers },
        )
        expect(created.status).toBe(201)
        expect(created.data).toMatchObject({
          personId,
          body: 'first note',
          actorName: `${service.user.firstName} ${service.user.lastName}`,
        })
        expect(created.data.createdAt).toBeDefined()
        expect(created.data.updatedAt).toBeDefined()
        const noteId = created.data.id

        const listed = await service.client.get(
          `/v1/contacts/${personId}/notes`,
          { headers },
        )
        expect(listed.status).toBe(200)
        expect(listed.data.results).toHaveLength(1)
        expect(listed.data.results[0]).toMatchObject({
          id: noteId,
          body: 'first note',
          actorName: `${service.user.firstName} ${service.user.lastName}`,
        })

        const edited = await service.client.patch(
          `/v1/contacts/notes/${noteId}`,
          { body: 'edited note' },
          { headers },
        )
        expect(edited.status).toBe(200)
        expect(edited.data.body).toBe('edited note')
        expect(edited.data.actorName).toBe(
          `${service.user.firstName} ${service.user.lastName}`,
        )

        const deleted = await service.client.delete(
          `/v1/contacts/notes/${noteId}`,
          { headers },
        )
        expect(deleted.status).toBe(204)

        const listedAfterDelete = await service.client.get(
          `/v1/contacts/${personId}/notes`,
          { headers },
        )
        expect(listedAfterDelete.data.results).toEqual([])
        // 6 sequential round-trips against a cold testcontainer clear the
        // vitest 5000ms default (reproduced at 5705ms/5386ms) but stay well
        // under this on a warm one.
      },
      15_000,
    )
  })

  it('returns notes newest first with createdAt and updatedAt', async () => {
    const slug = `win-pro-order-${Date.now()}`
    await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
    const headers = { [ORG_SLUG_HEADER]: slug }
    const personId = 'person-order'

    await service.prisma.contactNote.create({
      data: {
        organizationSlug: slug,
        personId,
        body: 'older',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    })
    await service.prisma.contactNote.create({
      data: {
        organizationSlug: slug,
        personId,
        body: 'newer',
        createdAt: new Date('2026-02-01T00:00:00Z'),
      },
    })

    const result = await service.client.get(`/v1/contacts/${personId}/notes`, {
      headers,
    })

    expect(result.status).toBe(200)
    expect(result.data.results.map((n: { body: string }) => n.body)).toEqual([
      'newer',
      'older',
    ])
    for (const note of result.data.results) {
      expect(note.createdAt).toEqual(expect.any(String))
      expect(note.updatedAt).toEqual(expect.any(String))
    }
  })

  it('renders a legacy null-actor note authorless', async () => {
    const slug = `win-pro-legacy-${Date.now()}`
    await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
    const headers = { [ORG_SLUG_HEADER]: slug }
    const personId = 'person-legacy'

    await service.prisma.contactNote.create({
      data: { organizationSlug: slug, personId, body: 'no author' },
    })

    const result = await service.client.get(`/v1/contacts/${personId}/notes`, {
      headers,
    })

    expect(result.status).toBe(200)
    expect(result.data.results[0]).toMatchObject({
      body: 'no author',
      actorName: null,
    })
  })

  describe('non-pro Win campaign', () => {
    it.each([
      {
        name: 'list',
        call: (headers: Record<string, string>, personId: string) =>
          service.client.get(`/v1/contacts/${personId}/notes`, { headers }),
      },
      {
        name: 'create',
        call: (headers: Record<string, string>, personId: string) =>
          service.client.post(
            `/v1/contacts/${personId}/notes`,
            { body: 'note' },
            { headers },
          ),
      },
    ])('rejects $name with 400', async ({ call }) => {
      const slug = `win-nonpro-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: false })
      const headers = { [ORG_SLUG_HEADER]: slug }

      const result = await call(headers, 'person-1')

      expect(result.status).toBe(400)
    })

    it('rejects edit and delete with 400', async () => {
      const proSlug = `win-pro-seed-${Date.now()}`
      await seedWinOrg({ slug: proSlug, ownerId: service.user.id, isPro: true })
      const note = await service.prisma.contactNote.create({
        data: {
          organizationSlug: proSlug,
          personId: 'person-1',
          body: 'seed note',
        },
      })

      const slug = `win-nonpro-edit-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: false })
      const headers = { [ORG_SLUG_HEADER]: slug }

      const edited = await service.client.patch(
        `/v1/contacts/notes/${note.id}`,
        { body: 'hijack attempt' },
        { headers },
      )
      expect(edited.status).toBe(400)

      const deleted = await service.client.delete(
        `/v1/contacts/notes/${note.id}`,
        { headers },
      )
      expect(deleted.status).toBe(400)
    })
  })

  describe('cross-org PATCH and DELETE', () => {
    it('returns 404 and leaves the row unchanged', async () => {
      const ownerSlug = `win-owner-${Date.now()}`
      await seedWinOrg({
        slug: ownerSlug,
        ownerId: service.user.id,
        isPro: true,
      })
      const otherSlug = `win-other-${Date.now()}`
      await seedWinOrg({
        slug: otherSlug,
        ownerId: service.user.id,
        isPro: true,
      })

      const note = await service.prisma.contactNote.create({
        data: {
          organizationSlug: ownerSlug,
          personId: 'person-1',
          body: 'original',
        },
      })
      const otherHeaders = { [ORG_SLUG_HEADER]: otherSlug }

      const edited = await service.client.patch(
        `/v1/contacts/notes/${note.id}`,
        { body: 'hijacked' },
        { headers: otherHeaders },
      )
      expect(edited.status).toBe(404)

      const deleted = await service.client.delete(
        `/v1/contacts/notes/${note.id}`,
        { headers: otherHeaders },
      )
      expect(deleted.status).toBe(404)

      const persisted = await service.prisma.contactNote.findUniqueOrThrow({
        where: { id: note.id },
      })
      expect(persisted.body).toBe('original')
    })
  })

  describe('body length validation', () => {
    it('rejects an empty body with 400', async () => {
      const slug = `win-pro-empty-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      const headers = { [ORG_SLUG_HEADER]: slug }

      const result = await service.client.post(
        '/v1/contacts/person-1/notes',
        { body: '' },
        { headers },
      )

      expect(result.status).toBe(400)
    })

    it('rejects a 10,001-char body with 400', async () => {
      const slug = `win-pro-toolong-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      const headers = { [ORG_SLUG_HEADER]: slug }

      const result = await service.client.post(
        '/v1/contacts/person-1/notes',
        { body: 'a'.repeat(10_001) },
        { headers },
      )

      expect(result.status).toBe(400)
    })

    it('accepts a 10,000-char body', async () => {
      const slug = `win-pro-maxlen-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      const headers = { [ORG_SLUG_HEADER]: slug }

      const result = await service.client.post(
        '/v1/contacts/person-1/notes',
        { body: 'a'.repeat(10_000) },
        { headers },
      )

      expect(result.status).toBe(201)
      expect(result.data.body).toHaveLength(10_000)
    })
  })

  describe('volunteer access (ENG-11057)', () => {
    it('assigned volunteer (phone-banking chain) gets full CRUD, attributed to them', async () => {
      const slug = `win-pro-vol-pb-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      const personId = 'person-pb-1'
      const outreachId = await createPhoneBankingReachablePerson(slug, personId)
      const volunteer = await createVolunteer(slug, {
        clerkId: 'user_notes_pb_assigned',
        email: 'notes-pb-assigned@example.com',
      })
      await assignOutreach(slug, outreachId, volunteer.id)
      const headers = {
        [ORG_SLUG_HEADER]: slug,
        ...authHeaderFor('user_notes_pb_assigned'),
      }

      const listedEmpty = await service.client.get(
        `/v1/contacts/${personId}/notes`,
        { headers },
      )
      expect(listedEmpty.status).toBe(200)
      expect(listedEmpty.data.results).toEqual([])

      const created = await service.client.post(
        `/v1/contacts/${personId}/notes`,
        { body: 'volunteer note' },
        { headers },
      )
      expect(created.status).toBe(201)
      expect(created.data.actorName).toBe('Vera Volunteer')
      const noteId = created.data.id
      const persistedCreate =
        await service.prisma.contactNote.findUniqueOrThrow({
          where: { id: noteId },
        })
      expect(persistedCreate.actorUserId).toBe(volunteer.id)

      const listed = await service.client.get(
        `/v1/contacts/${personId}/notes`,
        { headers },
      )
      expect(listed.status).toBe(200)
      expect(listed.data.results).toHaveLength(1)

      const edited = await service.client.patch(
        `/v1/contacts/notes/${noteId}`,
        { body: 'edited by volunteer' },
        { headers },
      )
      expect(edited.status).toBe(200)
      expect(edited.data.body).toBe('edited by volunteer')

      const deleted = await service.client.delete(
        `/v1/contacts/notes/${noteId}`,
        { headers },
      )
      expect(deleted.status).toBe(204)
      expect(
        await service.prisma.contactNote.findUnique({ where: { id: noteId } }),
      ).toBeNull()
    })

    it('assigned volunteer (door-knocking chain) can list notes', async () => {
      const slug = `win-pro-vol-dk-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      const personId = 'person-dk-1'
      const outreachId = await createDoorKnockingReachablePerson(slug, personId)
      const volunteer = await createVolunteer(slug, {
        clerkId: 'user_notes_dk_assigned',
        email: 'notes-dk-assigned@example.com',
      })
      await assignOutreach(slug, outreachId, volunteer.id)
      const headers = {
        [ORG_SLUG_HEADER]: slug,
        ...authHeaderFor('user_notes_dk_assigned'),
      }

      const listed = await service.client.get(
        `/v1/contacts/${personId}/notes`,
        { headers },
      )
      expect(listed.status).toBe(200)
      expect(listed.data.results).toEqual([])
    })

    it('unassigned volunteer 404s all four routes', async () => {
      const slug = `win-pro-vol-unassigned-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      const reachablePersonId = 'person-reachable'
      const otherOutreachId = await createPhoneBankingReachablePerson(
        slug,
        reachablePersonId,
      )
      const volunteer = await createVolunteer(slug, {
        clerkId: 'user_notes_unassigned',
        email: 'notes-unassigned@example.com',
      })
      await assignOutreach(slug, otherOutreachId, volunteer.id)

      // A note left by the owner on a person the volunteer is NOT assigned
      // to reach.
      const unreachablePersonId = 'person-unreachable'
      const note = await service.prisma.contactNote.create({
        data: {
          organizationSlug: slug,
          personId: unreachablePersonId,
          body: 'owner note',
        },
      })
      const headers = {
        [ORG_SLUG_HEADER]: slug,
        ...authHeaderFor('user_notes_unassigned'),
      }

      const listed = await service.client.get(
        `/v1/contacts/${unreachablePersonId}/notes`,
        { headers },
      )
      expect(listed.status).toBe(404)

      const created = await service.client.post(
        `/v1/contacts/${unreachablePersonId}/notes`,
        { body: 'should not be allowed' },
        { headers },
      )
      expect(created.status).toBe(404)

      const edited = await service.client.patch(
        `/v1/contacts/notes/${note.id}`,
        { body: 'hijack attempt' },
        { headers },
      )
      expect(edited.status).toBe(404)

      const deleted = await service.client.delete(
        `/v1/contacts/notes/${note.id}`,
        { headers },
      )
      expect(deleted.status).toBe(404)

      const persisted = await service.prisma.contactNote.findUniqueOrThrow({
        where: { id: note.id },
      })
      expect(persisted.body).toBe('owner note')
    })

    it('404s once the assignment granting access is removed', async () => {
      const slug = `win-pro-vol-revoked-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      const personId = 'person-revoked'
      const outreachId = await createPhoneBankingReachablePerson(slug, personId)
      const volunteer = await createVolunteer(slug, {
        clerkId: 'user_notes_revoked',
        email: 'notes-revoked@example.com',
      })
      await assignOutreach(slug, outreachId, volunteer.id)
      const headers = {
        [ORG_SLUG_HEADER]: slug,
        ...authHeaderFor('user_notes_revoked'),
      }

      const before = await service.client.get(
        `/v1/contacts/${personId}/notes`,
        { headers },
      )
      expect(before.status).toBe(200)

      await service.prisma.outreachAssignment.delete({
        where: {
          outreachId_assigneeUserId: {
            outreachId,
            assigneeUserId: volunteer.id,
          },
        },
      })

      const after = await service.client.get(`/v1/contacts/${personId}/notes`, {
        headers,
      })
      expect(after.status).toBe(404)
    })

    it('cross-org note id 404s for a volunteer', async () => {
      const ownerSlug = `win-pro-vol-crossorg-owner-${Date.now()}`
      await seedWinOrg({
        slug: ownerSlug,
        ownerId: service.user.id,
        isPro: true,
      })
      const note = await service.prisma.contactNote.create({
        data: {
          organizationSlug: ownerSlug,
          personId: 'person-1',
          body: 'original',
        },
      })

      const volunteerSlug = `win-pro-vol-crossorg-vol-${Date.now()}`
      await seedWinOrg({
        slug: volunteerSlug,
        ownerId: service.user.id,
        isPro: true,
      })
      const volunteer = await createVolunteer(volunteerSlug, {
        clerkId: 'user_notes_crossorg',
        email: 'notes-crossorg@example.com',
      })
      const outreachId = await createPhoneBankingReachablePerson(
        volunteerSlug,
        'person-1',
      )
      await assignOutreach(volunteerSlug, outreachId, volunteer.id)
      const headers = {
        [ORG_SLUG_HEADER]: volunteerSlug,
        ...authHeaderFor('user_notes_crossorg'),
      }

      const edited = await service.client.patch(
        `/v1/contacts/notes/${note.id}`,
        { body: 'hijacked' },
        { headers },
      )
      expect(edited.status).toBe(404)

      const deleted = await service.client.delete(
        `/v1/contacts/notes/${note.id}`,
        { headers },
      )
      expect(deleted.status).toBe(404)

      const persisted = await service.prisma.contactNote.findUniqueOrThrow({
        where: { id: note.id },
      })
      expect(persisted.body).toBe('original')
    })

    it('campaignAdmin CRUD is unchanged', async () => {
      const slug = `win-pro-vol-admin-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      const personId = 'person-admin-1'
      const admin = await service.prisma.user.create({
        data: {
          email: `notes-admin-${Date.now()}@example.com`,
          clerkId: 'user_notes_campaignadmin',
        },
      })
      await service.prisma.organizationMembership.create({
        data: {
          organizationSlug: slug,
          userId: admin.id,
          role: OrganizationRole.campaignAdmin,
        },
      })
      const headers = {
        [ORG_SLUG_HEADER]: slug,
        ...authHeaderFor('user_notes_campaignadmin'),
      }

      const created = await service.client.post(
        `/v1/contacts/${personId}/notes`,
        { body: 'admin note' },
        { headers },
      )
      expect(created.status).toBe(201)

      const listed = await service.client.get(
        `/v1/contacts/${personId}/notes`,
        { headers },
      )
      expect(listed.status).toBe(200)
      expect(listed.data.results).toHaveLength(1)

      const edited = await service.client.patch(
        `/v1/contacts/notes/${created.data.id}`,
        { body: 'edited by admin' },
        { headers },
      )
      expect(edited.status).toBe(200)

      const deleted = await service.client.delete(
        `/v1/contacts/notes/${created.data.id}`,
        { headers },
      )
      expect(deleted.status).toBe(204)
    })
  })
})
