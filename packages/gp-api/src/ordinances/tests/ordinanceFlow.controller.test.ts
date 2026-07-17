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

// A hand-rolled deferred so a test can hold the model call open and observe
// the 'running' state before deciding when (and how) the run finishes.
const deferQcLlm = () => {
  let resolve!: (value: typeof qcModelOutput) => void
  let reject!: (err: Error) => void
  const promise = new Promise<typeof qcModelOutput>((res, rej) => {
    resolve = res
    reject = rej
  })
  const spy = vi
    .spyOn(service.app.get(LlmService), 'jsonCompletion')
    .mockImplementation(() => promise)
  return { spy, resolve, reject }
}

const getRun = (slug: string, header: ReturnType<typeof orgHeader>) =>
  service.client.get(`/v1/ordinances/${slug}/quality-report`, header)

const waitForRunStatus = (
  slug: string,
  header: ReturnType<typeof orgHeader>,
  status: 'done' | 'error',
) =>
  vi.waitFor(
    async () => {
      const res = await getRun(slug, header)
      expect(res.data.status).toBe(status)
      return res
    },
    { timeout: 5000, interval: 100 },
  )

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

  it('allows changing status in either direction', async () => {
    const orgSlug = 'eo-ordinances-status-change'
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
    // Moving a status backward is allowed so a user can correct a wrong pick.
    const res = await service.client.patch(
      `/v1/ordinances/${slug}`,
      { status: 'in_review' },
      header,
    )
    expect(res.status).toBe(200)
    expect(res.data.status).toBe('in_review')
    const after = await service.client.get(`/v1/ordinances/${slug}`, header)
    expect(after.data.status).toBe('in_review')
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

  it('accepts a run, reports running, then reaches done via polling', async () => {
    const orgSlug = 'eo-ordinances-qc-happy'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const slug = await seedDraftOrdinance(header)

    const before = await service.client.get(`/v1/ordinances/${slug}`, header)
    expect(before.data.qualityRunStatus).toBe('idle')

    const { spy, resolve } = deferQcLlm()
    try {
      const accepted = await service.client.post(
        `/v1/ordinances/${slug}/quality-report`,
        {},
        header,
      )
      // 202 with the run envelope lands before the model call resolves.
      expect(accepted.status).toBe(202)
      expect(accepted.data.status).toBe('running')
      expect(accepted.data.error).toBeNull()
      expect(typeof accepted.data.startedAt).toBe('string')

      const inFlight = await getRun(slug, header)
      expect(inFlight.status).toBe(200)
      expect(inFlight.data.status).toBe('running')

      const during = await service.client.get(`/v1/ordinances/${slug}`, header)
      expect(during.data.qualityRunStatus).toBe('running')

      resolve(qcModelOutput)
      const done = await waitForRunStatus(slug, header, 'done')
      expect(done.data.report.checks).toHaveLength(6)
      expect(done.data.report.tally).toEqual({
        pass: 5,
        flag: 1,
        attention: 0,
      })
      expect(done.data.report.stale).toBe(false)
      expect(done.data.error).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })

  it('joins an in-flight run instead of starting a second one', async () => {
    const orgSlug = 'eo-ordinances-qc-join'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const slug = await seedDraftOrdinance(header)

    const { spy, resolve } = deferQcLlm()
    try {
      const first = await service.client.post(
        `/v1/ordinances/${slug}/quality-report`,
        {},
        header,
      )
      expect(first.status).toBe(202)
      expect(first.data.status).toBe('running')

      const second = await service.client.post(
        `/v1/ordinances/${slug}/quality-report`,
        {},
        header,
      )
      expect(second.status).toBe(202)
      expect(second.data.status).toBe('running')
      expect(spy).toHaveBeenCalledTimes(1)

      resolve(qcModelOutput)
      await waitForRunStatus(slug, header, 'done')
    } finally {
      spy.mockRestore()
    }
  })

  it('surfaces a failed run and keeps the previous report', async () => {
    const orgSlug = 'eo-ordinances-qc-fail'
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
      await waitForRunStatus(slug, header, 'done')

      await service.client.patch(
        `/v1/ordinances/${slug}`,
        { draftBody: 'Section 34.21 Canopy goal of ninety percent by 2040.' },
        header,
      )
      spy.mockRejectedValue(new Error('model exploded'))
      const rerun = await service.client.post(
        `/v1/ordinances/${slug}/quality-report`,
        {},
        header,
      )
      expect(rerun.status).toBe(202)
      expect(rerun.data.status).toBe('running')

      const failed = await waitForRunStatus(slug, header, 'error')
      // Provider errors can embed key/billing/model detail; the API must
      // serve a fixed generic message, never the raw error.
      expect(failed.data.error).toBe('Quality check failed. Please try again.')
      // The failed re-run must not cost the previously stored report.
      expect(failed.data.report.checks).toHaveLength(6)
      expect(failed.data.report.stale).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  it('heals an interrupted run to error and allows a fresh claim', async () => {
    const orgSlug = 'eo-ordinances-qc-interrupted'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const slug = await seedDraftOrdinance(header)
    await service.prisma.ordinance.update({
      where: { slug },
      data: {
        qualityRunStatus: 'running',
        qualityRunStartedAt: new Date(Date.now() - 11 * 60_000),
      },
    })

    const healed = await getRun(slug, header)
    expect(healed.status).toBe(200)
    expect(healed.data.status).toBe('error')
    expect(healed.data.error).toBe(
      'The last run was interrupted. Please try again.',
    )

    const spy = mockQcLlm()
    try {
      const res = await service.client.post(
        `/v1/ordinances/${slug}/quality-report`,
        {},
        header,
      )
      expect(res.status).toBe(202)
      expect(res.data.status).toBe('running')
      expect(spy).toHaveBeenCalledTimes(1)
      await waitForRunStatus(slug, header, 'done')
    } finally {
      spy.mockRestore()
    }
  })

  it('reclaims a wedged running run that has no startedAt', async () => {
    const orgSlug = 'eo-ordinances-qc-wedged'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const slug = await seedDraftOrdinance(header)
    // A row can end up 'running' with no startedAt (e.g. a partial manual
    // write). `lt` never matches NULL, so without a dedicated claim branch no
    // retry could ever reclaim it.
    await service.prisma.ordinance.update({
      where: { slug },
      data: { qualityRunStatus: 'running', qualityRunStartedAt: null },
    })

    const healed = await getRun(slug, header)
    expect(healed.data.status).toBe('error')
    expect(healed.data.error).toBe(
      'The last run was interrupted. Please try again.',
    )

    const spy = mockQcLlm()
    try {
      const res = await service.client.post(
        `/v1/ordinances/${slug}/quality-report`,
        {},
        header,
      )
      expect(res.status).toBe(202)
      expect(res.data.status).toBe('running')
      await waitForRunStatus(slug, header, 'done')
    } finally {
      spy.mockRestore()
    }
  })

  it('discards a stale run finishing after a newer claim took over', async () => {
    const orgSlug = 'eo-ordinances-qc-zombie'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const slug = await seedDraftOrdinance(header)

    let resolveA!: (value: typeof qcModelOutput) => void
    let resolveB!: (value: typeof qcModelOutput) => void
    const runA = new Promise<typeof qcModelOutput>((res) => {
      resolveA = res
    })
    const runB = new Promise<typeof qcModelOutput>((res) => {
      resolveB = res
    })
    const spy = vi
      .spyOn(service.app.get(LlmService), 'jsonCompletion')
      .mockImplementationOnce(() => runA)
      .mockImplementationOnce(() => runB)
    try {
      const first = await service.client.post(
        `/v1/ordinances/${slug}/quality-report`,
        {},
        header,
      )
      expect(first.data.status).toBe('running')

      // Age run A's claim past the staleness window so a second POST reclaims
      // the row while A's model call is still in flight.
      await service.prisma.ordinance.update({
        where: { slug },
        data: { qualityRunStartedAt: new Date(Date.now() - 11 * 60_000) },
      })
      const second = await service.client.post(
        `/v1/ordinances/${slug}/quality-report`,
        {},
        header,
      )
      expect(second.data.status).toBe('running')
      expect(spy).toHaveBeenCalledTimes(2)

      resolveA(qcModelOutput)
      await new Promise((res) => setTimeout(res, 150))
      // A finished against a claim it no longer owns; the startedAt guard on
      // the terminal writes must discard it, leaving B's run in charge.
      const during = await getRun(slug, header)
      expect(during.data.status).toBe('running')

      resolveB(qcModelOutput)
      await waitForRunStatus(slug, header, 'done')
    } finally {
      spy.mockRestore()
    }
  })

  it('keeps serving when the terminal-state write fails', async () => {
    const orgSlug = 'eo-ordinances-qc-db-down'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const slug = await seedDraftOrdinance(header)

    const { spy, resolve } = deferQcLlm()
    try {
      const accepted = await service.client.post(
        `/v1/ordinances/${slug}/quality-report`,
        {},
        header,
      )
      expect(accepted.data.status).toBe('running')

      // service.prisma is the PrismaService instance the service's this.model
      // reads from, and Prisma caches model delegates per client, so this spy
      // intercepts the runner's writes.
      const updateManySpy = vi
        .spyOn(service.prisma.ordinance, 'updateMany')
        .mockRejectedValue(new Error('db down'))
      try {
        resolve(qcModelOutput)
        // The done-write fails, then the error-write fails too; the runner
        // must swallow both instead of surfacing an unhandled rejection.
        await vi.waitFor(() => expect(updateManySpy).toHaveBeenCalledTimes(2))
      } finally {
        updateManySpy.mockRestore()
      }
    } finally {
      spy.mockRestore()
    }

    // The terminal write was lost — the accepted degraded outcome. The row
    // stays 'running' until the read-side staleness heal, and the API still
    // serves.
    const after = await getRun(slug, header)
    expect(after.status).toBe(200)
    expect(after.data.status).toBe('running')
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
      await waitForRunStatus(slug, header, 'done')
      const detail = await service.client.get(`/v1/ordinances/${slug}`, header)
      expect(detail.data.qualityReport.checks).toHaveLength(6)
      expect(detail.data.qualityReport.stale).toBe(false)
      expect(detail.data.qualityRunStatus).toBe('done')
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
      expect(first.status).toBe(202)
      await waitForRunStatus(slug, header, 'done')

      const second = await service.client.post(
        `/v1/ordinances/${slug}/quality-report`,
        {},
        header,
      )
      expect(second.status).toBe(202)
      // The second call was served from the stored report as an already-done
      // run, not a fresh model call.
      expect(second.data.status).toBe('done')
      expect(second.data.report.tally).toEqual({
        pass: 5,
        flag: 1,
        attention: 0,
      })
      expect(second.data.report.stale).toBe(false)
      expect(spy).toHaveBeenCalledTimes(1)
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
      await waitForRunStatus(slug, header, 'done')
      await service.client.patch(
        `/v1/ordinances/${slug}`,
        { draftBody: 'Section 34.21 Canopy goal of sixty percent by 2040.' },
        header,
      )
      const rerun = await service.client.post(
        `/v1/ordinances/${slug}/quality-report`,
        {},
        header,
      )
      expect(rerun.data.status).toBe('running')
      await waitForRunStatus(slug, header, 'done')
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      spy.mockRestore()
    }
  })

  it('exports the draft as a downloadable PDF', async () => {
    const orgSlug = 'eo-ordinances-export-pdf'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const slug = await seedDraftOrdinance(header)

    const res = await service.client.get(
      `/v1/ordinances/${slug}/export?format=pdf`,
      { ...header, responseType: 'arraybuffer' },
    )
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(Buffer.from(res.data).subarray(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('exports the draft as a downloadable Word document', async () => {
    const orgSlug = 'eo-ordinances-export-docx'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const slug = await seedDraftOrdinance(header)

    const res = await service.client.get(
      `/v1/ordinances/${slug}/export?format=docx`,
      { ...header, responseType: 'arraybuffer' },
    )
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('wordprocessingml.document')
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(Buffer.from(res.data).subarray(0, 2).toString('ascii')).toBe('PK')
  })

  it('rejects an unknown export format', async () => {
    const orgSlug = 'eo-ordinances-export-bad'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const slug = await seedDraftOrdinance(header)

    const res = await service.client.get(
      `/v1/ordinances/${slug}/export?format=txt`,
      header,
    )
    expect(res.status).toBe(400)
  })

  it('marks a stored report stale after the draft changes', async () => {
    const orgSlug = 'eo-ordinances-qc-stale'
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
      const ran = await waitForRunStatus(slug, header, 'done')
      expect(ran.data.report.stale).toBe(false)

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
