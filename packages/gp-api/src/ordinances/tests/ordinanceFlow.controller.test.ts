import { describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'

const service = useTestService()

const orgHeader = (slug: string) => ({
  headers: { 'x-organization-slug': slug },
})

const seedElectedOffice = async (orgSlug: string) => {
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  return service.prisma.electedOffice.create({
    data: { organizationSlug: orgSlug, userId: service.user.id },
  })
}

describe('Ordinances endpoints', () => {
  it('creates, lists, reads, updates, and soft-deletes an ordinance', async () => {
    const orgSlug = 'eo-ordinances-crud'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)

    const created = await service.client.post(
      '/v1/ordinances',
      { seedType: 'new', goalText: 'Reduce late-night noise' },
      header,
    )
    expect(created.status).toBe(201)
    expect(created.data.status).toBe('in_progress')
    expect(created.data.seedType).toBe('new')
    expect(created.data.goalText).toBe('Reduce late-night noise')
    const { slug } = created.data

    const listed = await service.client.get('/v1/ordinances', header)
    expect(listed.status).toBe(200)
    expect(listed.data.items).toHaveLength(1)
    expect(listed.data.counts.in_progress).toBe(1)

    const detail = await service.client.get(`/v1/ordinances/${slug}`, header)
    expect(detail.data.slug).toBe(slug)

    const updated = await service.client.patch(
      `/v1/ordinances/${slug}`,
      { status: 'draft', draftBody: 'Section 1. ...' },
      header,
    )
    expect(updated.data.status).toBe('draft')
    expect(updated.data.draftBody).toBe('Section 1. ...')

    const removed = await service.client.delete(
      `/v1/ordinances/${slug}`,
      header,
    )
    expect(removed.status).toBe(204)

    const afterDelete = await service.client.get('/v1/ordinances', header)
    expect(afterDelete.data.items).toHaveLength(0)
    const gone = await service.client.get(`/v1/ordinances/${slug}`, header)
    expect(gone.status).toBe(404)
  })

  it('persists a clarify answer by questionId', async () => {
    const orgSlug = 'eo-ordinances-clarify-save'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const created = await service.client.post(
      '/v1/ordinances',
      { seedType: 'new', goalText: 'Noise' },
      header,
    )
    const { slug } = created.data

    const saved = await service.client.post(
      `/v1/ordinances/${slug}/clarify-answers`,
      { questionId: 'q1', question: 'What hours?', answer: '10pm-6am' },
      header,
    )
    expect(saved.status).toBe(201)
    expect(saved.data.clarifyAnswers).toEqual([
      { questionId: 'q1', question: 'What hours?', answer: '10pm-6am' },
    ])
  })

  it('replaces an existing answer when the same questionId is re-answered', async () => {
    const orgSlug = 'eo-ordinances-clarify-replace'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const created = await service.client.post(
      '/v1/ordinances',
      { seedType: 'new', goalText: 'Noise' },
      header,
    )
    const { slug } = created.data

    await service.client.post(
      `/v1/ordinances/${slug}/clarify-answers`,
      { questionId: 'q1', question: 'What hours?', answer: '10pm-6am' },
      header,
    )
    const reanswered = await service.client.post(
      `/v1/ordinances/${slug}/clarify-answers`,
      { questionId: 'q1', question: 'What hours?', answer: '11pm-5am' },
      header,
    )
    expect(reanswered.data.clarifyAnswers).toEqual([
      { questionId: 'q1', question: 'What hours?', answer: '11pm-5am' },
    ])
  })

  it('requires issueSlug when the seed type is issue', async () => {
    const orgSlug = 'eo-ordinances-validate'
    await seedElectedOffice(orgSlug)
    const res = await service.client.post(
      '/v1/ordinances',
      { seedType: 'issue' },
      orgHeader(orgSlug),
    )
    expect(res.status).toBe(400)
  })

  it('scopes ordinances to the requesting elected office', async () => {
    await seedElectedOffice('eo-ordinances-a')
    await seedElectedOffice('eo-ordinances-b')

    await service.client.post(
      '/v1/ordinances',
      { seedType: 'new', goalText: 'Office A ordinance' },
      orgHeader('eo-ordinances-a'),
    )

    const bList = await service.client.get(
      '/v1/ordinances',
      orgHeader('eo-ordinances-b'),
    )
    expect(bList.data.items).toHaveLength(0)
  })
})
