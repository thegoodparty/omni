import { describe, expect, it, vi } from 'vitest'
import { LlmService } from '@/llm/services/llm.service'
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

// A draft-ready ordinance (non-empty draftBody) so the quality-report endpoint
// gets past its empty-draft guard.
const seedDraftOrdinance = async (header: ReturnType<typeof orgHeader>) => {
  const created = await service.client.post(
    '/v1/ordinances',
    { seedType: 'new', goalText: 'Tree canopy' },
    header,
  )
  const { slug } = created.data
  await service.client.patch(
    `/v1/ordinances/${slug}`,
    {
      status: 'draft',
      draftTitle: 'Draft amendment to Chapter 34',
      draftBody: 'Section 34.21 Canopy goal of forty percent by 2040.',
    },
    header,
  )
  return slug as string
}

// The six-check model output the QC service expects, mocked so no real model
// call runs. Statuses give a deterministic pass:5 flag:1 tally.
const qcModelOutput = {
  object: {
    checks: [
      { id: 'authority', status: 'pass', note: 'Within council power.' },
      { id: 'legal_conflict', status: 'pass', note: 'No conflict.' },
      { id: 'precedent_grounding', status: 'pass', note: 'Grounded.' },
      { id: 'completeness', status: 'flag', note: 'Add an effective date.' },
      { id: 'clarity', status: 'pass', note: 'Clear.' },
      { id: 'voice', status: 'pass', note: 'Plain municipal voice.' },
    ],
  },
  tokens: 10,
  model: 'claude-sonnet-4-6',
}

const mockQcLlm = () =>
  vi
    .spyOn(service.app.get(LlmService), 'jsonCompletion')
    .mockResolvedValue(qcModelOutput)

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
      {
        status: 'draft',
        draftTitle: 'Draft ordinance limiting late-night noise',
        draftBody: 'Section 1. ...',
      },
      header,
    )
    expect(updated.data.status).toBe('draft')
    expect(updated.data.draftTitle).toBe(
      'Draft ordinance limiting late-night noise',
    )
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

  it('applies a partial PATCH without clobbering unspecified draft fields', async () => {
    const orgSlug = 'eo-ordinances-partial-patch'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const created = await service.client.post(
      '/v1/ordinances',
      { seedType: 'new', goalText: 'Noise' },
      header,
    )
    const { slug } = created.data

    await service.client.patch(
      `/v1/ordinances/${slug}`,
      {
        status: 'draft',
        draftTitle: 'Noise ordinance draft',
        draftBody: 'Section 1. Quiet hours.',
      },
      header,
    )
    // A status-only PATCH (e.g. advancing the lifecycle) must leave the draft
    // title/body untouched — they are omitted, not nulled.
    const advanced = await service.client.patch(
      `/v1/ordinances/${slug}`,
      { status: 'in_review' },
      header,
    )
    expect(advanced.data.status).toBe('in_review')
    expect(advanced.data.draftTitle).toBe('Noise ordinance draft')
    expect(advanced.data.draftBody).toBe('Section 1. Quiet hours.')
  })

  it('rejects a PATCH that would blank the draft title', async () => {
    const orgSlug = 'eo-ordinances-blank-title'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const created = await service.client.post(
      '/v1/ordinances',
      { seedType: 'new', goalText: 'Noise' },
      header,
    )
    const res = await service.client.patch(
      `/v1/ordinances/${created.data.slug}`,
      { draftTitle: '' },
      header,
    )
    expect(res.status).toBe(400)
  })

  it('rejects a PATCH with empty draftSources', async () => {
    const orgSlug = 'eo-ordinances-empty-sources'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const created = await service.client.post(
      '/v1/ordinances',
      { seedType: 'new', goalText: 'Noise' },
      header,
    )
    const res = await service.client.patch(
      `/v1/ordinances/${created.data.slug}`,
      { draftSources: [] },
      header,
    )
    expect(res.status).toBe(400)
  })

  it('refuses to downgrade an ordinance status', async () => {
    const orgSlug = 'eo-ordinances-downgrade'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const created = await service.client.post(
      '/v1/ordinances',
      { seedType: 'new', goalText: 'Noise' },
      header,
    )
    const { slug } = created.data
    await service.client.patch(
      `/v1/ordinances/${slug}`,
      { status: 'proposed' },
      header,
    )
    const res = await service.client.patch(
      `/v1/ordinances/${slug}`,
      { status: 'in_progress' },
      header,
    )
    expect(res.status).toBe(403)
    const after = await service.client.get(`/v1/ordinances/${slug}`, header)
    expect(after.data.status).toBe('proposed')
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

  it('rejects a quality report on an empty draft', async () => {
    const orgSlug = 'eo-ordinances-qc-empty'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const created = await service.client.post(
      '/v1/ordinances',
      { seedType: 'new', goalText: 'Noise' },
      header,
    )
    const res = await service.client.post(
      `/v1/ordinances/${created.data.slug}/quality-report`,
      {},
      header,
    )
    expect(res.status).toBe(400)
  })

  it('generates and returns a quality report', async () => {
    const orgSlug = 'eo-ordinances-qc-happy'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const slug = await seedDraftOrdinance(header)
    const spy = mockQcLlm()
    try {
      const res = await service.client.post(
        `/v1/ordinances/${slug}/quality-report`,
        {},
        header,
      )
      expect(res.status).toBe(201)
      expect(res.data.qualityReport.checks).toHaveLength(6)
      expect(res.data.qualityReport.tally).toEqual({
        pass: 5,
        flag: 1,
        attention: 0,
      })
      expect(res.data.qualityReport.stale).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })

  it('persists the generated report for a later read', async () => {
    const orgSlug = 'eo-ordinances-qc-persist'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const slug = await seedDraftOrdinance(header)
    const spy = mockQcLlm()
    try {
      await service.client.post(
        `/v1/ordinances/${slug}/quality-report`,
        {},
        header,
      )
      const detail = await service.client.get(`/v1/ordinances/${slug}`, header)
      expect(detail.data.qualityReport.checks).toHaveLength(6)
      expect(detail.data.qualityReport.stale).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })

  it('returns 404 running a quality report on another office ordinance', async () => {
    await seedElectedOffice('eo-ordinances-qc-a')
    await seedElectedOffice('eo-ordinances-qc-b')
    const slug = await seedDraftOrdinance(orgHeader('eo-ordinances-qc-a'))

    const res = await service.client.post(
      `/v1/ordinances/${slug}/quality-report`,
      {},
      orgHeader('eo-ordinances-qc-b'),
    )
    expect(res.status).toBe(404)
  })

  it('reuses the stored report without a second LLM call on an unchanged draft', async () => {
    const orgSlug = 'eo-ordinances-qc-idempotent'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const slug = await seedDraftOrdinance(header)
    const spy = mockQcLlm()
    try {
      const first = await service.client.post(
        `/v1/ordinances/${slug}/quality-report`,
        {},
        header,
      )
      const second = await service.client.post(
        `/v1/ordinances/${slug}/quality-report`,
        {},
        header,
      )
      expect(first.status).toBe(201)
      expect(second.status).toBe(201)
      // The second call was served from the stored report, not a fresh model
      // call.
      expect(spy).toHaveBeenCalledTimes(1)
      expect(second.data.qualityReport.tally).toEqual(
        first.data.qualityReport.tally,
      )
      expect(second.data.qualityReport.stale).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })

  it('re-runs the model when the draft changed since the last report', async () => {
    const orgSlug = 'eo-ordinances-qc-rerun'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const slug = await seedDraftOrdinance(header)
    const spy = mockQcLlm()
    try {
      await service.client.post(
        `/v1/ordinances/${slug}/quality-report`,
        {},
        header,
      )
      await service.client.patch(
        `/v1/ordinances/${slug}`,
        { draftBody: 'Section 34.21 Canopy goal of sixty percent by 2040.' },
        header,
      )
      await service.client.post(
        `/v1/ordinances/${slug}/quality-report`,
        {},
        header,
      )
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      spy.mockRestore()
    }
  })

  it('marks a stored report stale after the draft changes', async () => {
    const orgSlug = 'eo-ordinances-qc-stale'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const slug = await seedDraftOrdinance(header)
    const spy = mockQcLlm()
    try {
      const ran = await service.client.post(
        `/v1/ordinances/${slug}/quality-report`,
        {},
        header,
      )
      expect(ran.data.qualityReport.stale).toBe(false)

      // Editing the draft body changes the hashed input, so the stored report
      // reads as stale without a re-run.
      await service.client.patch(
        `/v1/ordinances/${slug}`,
        { draftBody: 'Section 34.21 Canopy goal of fifty percent by 2040.' },
        header,
      )
      const detail = await service.client.get(`/v1/ordinances/${slug}`, header)
      expect(detail.data.qualityReport.stale).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})
