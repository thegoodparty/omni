import { useTestService } from '@/test-service'
import { describe, expect, it } from 'vitest'

const service = useTestService()

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
})
