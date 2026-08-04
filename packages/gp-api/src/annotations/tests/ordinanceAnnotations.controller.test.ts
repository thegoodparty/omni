import { describe, expect, it } from 'vitest'
import { OrdinanceSeedType } from '../../generated/prisma'
import { useTestService } from '@/test-service'

const service = useTestService()

const ANNOTATION_LIMIT = 200

const seedElectedOffice = async (orgSlug: string, userId?: number) => {
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: userId ?? service.user.id },
  })
  return service.prisma.electedOffice.create({
    data: {
      organizationSlug: orgSlug,
      userId: userId ?? service.user.id,
    },
  })
}

const seedOrdinance = async (eoId: string) =>
  service.prisma.ordinance.create({
    data: { electedOfficeId: eoId, seedType: OrdinanceSeedType.new },
  })

const orgHeader = (slug: string) => ({
  headers: { 'x-organization-slug': slug },
})

// Ordinance bug reports anchor resource-wide (the draft is editable, so a
// passage anchor goes stale) and carry the flagged text in `excerpt`.
const ordinanceBug = {
  kind: 'bug_report' as const,
  anchor: { json_path: null, start: null, end: null },
  payload: {
    description: 'This clause contradicts the fee schedule.',
    excerpt: 'No permit fee shall exceed twenty-five dollars.',
  },
}

describe('POST /v1/ordinances/:slug/annotations', () => {
  it('creates a bug_report with the flagged excerpt', async () => {
    const orgSlug = 'ord-bug-create'
    const eo = await seedElectedOffice(orgSlug)
    const ordinance = await seedOrdinance(eo.id)

    const result = await service.client.post(
      `/v1/ordinances/${ordinance.slug}/annotations`,
      ordinanceBug,
      orgHeader(orgSlug),
    )

    expect(result.status).toBe(201)
    expect(result.data).toMatchObject({
      kind: 'bug_report',
      resource_type: 'ordinance',
      author_user_id: service.user.id,
      json_path: null,
      start: null,
      end: null,
      bug_report: {
        description: 'This clause contradicts the fee schedule.',
        excerpt: 'No permit fee shall exceed twenty-five dollars.',
      },
    })
  })

  it('accepts a bug_report with no excerpt', async () => {
    const orgSlug = 'ord-bug-no-excerpt'
    const eo = await seedElectedOffice(orgSlug)
    const ordinance = await seedOrdinance(eo.id)

    const result = await service.client.post(
      `/v1/ordinances/${ordinance.slug}/annotations`,
      { ...ordinanceBug, payload: { description: 'Something is off.' } },
      orgHeader(orgSlug),
    )

    expect(result.status).toBe(201)
    expect(result.data.bug_report.excerpt).toBeNull()
  })

  it('rejects a non-bug_report kind on an ordinance', async () => {
    const orgSlug = 'ord-note-reject'
    const eo = await seedElectedOffice(orgSlug)
    const ordinance = await seedOrdinance(eo.id)

    const result = await service.client.post(
      `/v1/ordinances/${ordinance.slug}/annotations`,
      {
        kind: 'note',
        anchor: { json_path: null, start: null, end: null },
        payload: { body: 'a note' },
      },
      orgHeader(orgSlug),
    )

    expect(result.status).toBe(400)
  })

  it('returns 404 for a slug the office does not own', async () => {
    const ownOrg = 'ord-own'
    await seedElectedOffice(ownOrg)

    const otherUser = await service.prisma.user.create({
      data: {
        clerkId: 'ord_other_office',
        email: 'ord-other@goodparty.org',
        firstName: 'Other',
        lastName: 'Office',
      },
    })
    const otherEo = await seedElectedOffice('ord-other-office', otherUser.id)
    const otherOrdinance = await seedOrdinance(otherEo.id)

    const result = await service.client.post(
      `/v1/ordinances/${otherOrdinance.slug}/annotations`,
      ordinanceBug,
      orgHeader(ownOrg),
    )

    expect(result.status).toBe(404)
  })

  it('rejects creation past the per-user-per-ordinance limit', async () => {
    const orgSlug = 'ord-limit'
    const eo = await seedElectedOffice(orgSlug)
    const ordinance = await seedOrdinance(eo.id)

    await service.prisma.annotation.createMany({
      data: Array.from({ length: ANNOTATION_LIMIT }, () => ({
        authorUserId: service.user.id,
        kind: 'bug_report' as const,
        resourceType: 'ordinance' as const,
        resourceId: ordinance.id,
      })),
    })

    const result = await service.client.post(
      `/v1/ordinances/${ordinance.slug}/annotations`,
      ordinanceBug,
      orgHeader(orgSlug),
    )

    expect(result.status).toBe(403)
  })
})

describe('GET /v1/ordinances/:slug/annotations', () => {
  it('returns only the requesting user own bug reports for the draft', async () => {
    const orgSlug = 'ord-list-isolation'
    const eo = await seedElectedOffice(orgSlug)
    const ordinance = await seedOrdinance(eo.id)

    const otherUser = await service.prisma.user.create({
      data: {
        clerkId: 'ord_list_other',
        email: 'ord-list-other@goodparty.org',
        firstName: 'Other',
        lastName: 'User',
      },
    })

    await service.prisma.annotation.create({
      data: {
        author: { connect: { id: service.user.id } },
        kind: 'bug_report',
        resourceType: 'ordinance',
        resourceId: ordinance.id,
        bugReport: { create: { description: 'mine', excerpt: 'my passage' } },
      },
    })
    await service.prisma.annotation.create({
      data: {
        author: { connect: { id: otherUser.id } },
        kind: 'bug_report',
        resourceType: 'ordinance',
        resourceId: ordinance.id,
        bugReport: { create: { description: 'theirs' } },
      },
    })

    const result = await service.client.get(
      `/v1/ordinances/${ordinance.slug}/annotations`,
      orgHeader(orgSlug),
    )

    expect(result.status).toBe(200)
    expect(result.data.annotations).toHaveLength(1)
    expect(result.data.annotations[0].author_user_id).toBe(service.user.id)
    expect(result.data.annotations[0].bug_report.description).toBe('mine')
    expect(result.data.annotations[0].bug_report.excerpt).toBe('my passage')
  })

  it('returns 404 for an unknown ordinance slug', async () => {
    const orgSlug = 'ord-list-missing'
    await seedElectedOffice(orgSlug)

    const result = await service.client.get(
      '/v1/ordinances/does-not-exist/annotations',
      orgHeader(orgSlug),
    )

    expect(result.status).toBe(404)
  })
})
