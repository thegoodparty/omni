import { randomUUID } from 'node:crypto'
import { addMinutes, formatISO, subMinutes } from 'date-fns'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  SynthesisRunStatus,
  SynthesisScope,
  type FeedbackSynthesisRun,
} from '@/generated/prisma'
import { LlmService } from '@/llm/services/llm.service'
import { useTestService } from '@/test-service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { MockSynthesisEngine } from '../services/mockSynthesisEngine'
import { PipelineSynthesisEngine } from '../services/pipelineSynthesisEngine'
import { SynthesisStaleRunSweepService } from '../services/synthesisStaleRunSweep.service'
import {
  createServeOrg,
  seedKnockMemo,
  seedTurfEffort,
} from './issueCaptureFixtures'

const service = useTestService()

describe('feedback synthesis workers', () => {
  let slug: string
  let outreachId: number

  beforeEach(async () => {
    slug = await createServeOrg(service)
    outreachId = (await seedTurfEffort(service, slug, { people: 1 })).outreachId
  })

  const createRun = (createdAt = new Date()) =>
    service.prisma.feedbackSynthesisRun.create({
      data: {
        organizationSlug: slug,
        scope: SynthesisScope.effort,
        outreachId,
        status: SynthesisRunStatus.running,
        activeKey: `${slug}:${outreachId}:${createdAt.toISOString()}`,
        conversations: 5,
        memos: 5,
        confirmed: 5,
        engine: 'v1_pipeline',
        createdAt,
      },
    })

  describe('the pipeline engine', () => {
    let run: FeedbackSynthesisRun
    let memos: Array<{ id: string; text: string; occurredAt: Date }>

    beforeEach(async () => {
      vi.stubEnv('AI_PIPELINE_BASE_URL', 'https://ai.test')
      vi.stubEnv('AI_PIPELINE_API_KEY', 'pipeline-key')
      vi.stubEnv('SERVE_ANALYSIS_BUCKET_NAME', 'serve-analyze-test')
      onTestFinished(() => {
        vi.unstubAllEnvs()
      })
      run = await createRun()
      const effort = await service.prisma.outreach.findUniqueOrThrow({
        where: { id: outreachId },
        include: {
          doorKnockingTurf: {
            include: { stops: { include: { targets: true } } },
          },
        },
      })
      const personId = effort.doorKnockingTurf!.stops[0]!.targets[0]!.personId
      const { memo } = await seedKnockMemo(service, {
        slug,
        outreachId,
        personId,
        transcript: 'She said "fix the drain", and soon.',
      })
      memos = [
        {
          id: memo.id,
          text: memo.transcript!,
          occurredAt: memo.occurredAt,
        },
      ]
    })

    const stubFetch = (response: Response | Error) => {
      const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
        if (response instanceof Error) throw response
        return response
      })
      vi.stubGlobal('fetch', fetchMock)
      onTestFinished(() => {
        vi.unstubAllGlobals()
      })
      return fetchMock
    }

    const stubUpload = () => {
      const upload = vi
        .spyOn(service.app.get(S3Service), 'uploadFile')
        .mockResolvedValue('https://s3/whatever')
      onTestFinished(() => upload.mockRestore())
      return upload
    }

    it('writes the memo CSV and triggers the pipeline', async () => {
      const upload = stubUpload()
      const fetchMock = stubFetch(new Response(null, { status: 202 }))

      await service.app.get(PipelineSynthesisEngine).start(run, memos)

      const key = `feedback-input/${run.id}.csv`
      expect(upload).toHaveBeenCalledWith(
        'serve-analyze-test',
        [
          'respondent_id,message_text,sent_at',
          `"${memos[0]!.id}","She said ""fix the drain"", and soon.",` +
            `"${formatISO(memos[0]!.occurredAt)}"`,
          '',
        ].join('\n'),
        key,
        { contentType: 'text/csv' },
      )
      expect(fetchMock).toHaveBeenCalledWith(
        'https://ai.test/serve/messages/process',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'x-api-key': 'pipeline-key' }),
        }),
      )
      const init = fetchMock.mock.calls[0]![1]
      expect(JSON.parse(String(init.body))).toEqual({
        sourceType: 'constituent_feedback',
        sourceId: run.id,
        csvS3Path: `s3://serve-analyze-test/${key}`,
        topN: 10,
      })
      const after = await service.prisma.feedbackSynthesisRun.findUniqueOrThrow(
        { where: { id: run.id } },
      )
      expect(after.status).toBe(SynthesisRunStatus.running)
    })

    it('fails the run when the pipeline answers non-2xx', async () => {
      stubUpload()
      stubFetch(new Response('nope', { status: 503 }))

      await service.app.get(PipelineSynthesisEngine).start(run, memos)

      const after = await service.prisma.feedbackSynthesisRun.findUniqueOrThrow(
        { where: { id: run.id } },
      )
      expect(after.status).toBe(SynthesisRunStatus.failed)
      expect(after.activeKey).toBeNull()
      expect(after.error).toContain('503')
    })

    it('fails the run when the pipeline cannot be reached', async () => {
      stubUpload()
      stubFetch(new Error('ECONNREFUSED'))

      await service.app.get(PipelineSynthesisEngine).start(run, memos)

      const after = await service.prisma.feedbackSynthesisRun.findUniqueOrThrow(
        { where: { id: run.id } },
      )
      expect(after.status).toBe(SynthesisRunStatus.failed)
      expect(after.activeKey).toBeNull()
    })
  })

  describe('the mock engine’s model grouping', () => {
    it('groups with one model call and a prompt that names no product', async () => {
      vi.stubEnv('FEEDBACK_SYNTHESIS_MOCK_GROUPING', 'llm')
      onTestFinished(() => {
        vi.unstubAllEnvs()
      })
      const run = await createRun()
      const memos = []
      for (const personId of [randomUUID(), randomUUID()]) {
        const { memo } = await seedKnockMemo(service, {
          slug,
          outreachId,
          personId,
        })
        memos.push({
          id: memo.id,
          text: memo.transcript!,
          occurredAt: memo.occurredAt,
        })
      }
      const completion = vi
        .spyOn(service.app.get(LlmService), 'jsonCompletion')
        .mockResolvedValue({
          object: {
            themes: [
              {
                title: 'Street flooding',
                summary: 's',
                analysis: 'a',
                memoIds: [memos[0]!.id],
              },
              {
                title: 'Storm drains',
                summary: 's',
                analysis: 'a',
                memoIds: [memos[1]!.id],
              },
            ],
          },
          tokens: 1,
          inputTokens: 1,
          outputTokens: 1,
          model: 'claude-test',
        })
      onTestFinished(() => completion.mockRestore())

      await service.app.get(MockSynthesisEngine).complete(run.id, memos)

      expect(completion).toHaveBeenCalledTimes(1)
      const prompt = JSON.stringify(completion.mock.calls[0]![0].messages)
      expect(prompt).not.toMatch(/voter|constituent/i)
      const themes = await service.prisma.feedbackTheme.findMany({
        where: { runId: run.id },
      })
      expect(themes.map((theme) => theme.title).sort()).toEqual([
        'Storm drains',
        'Street flooding',
      ])
    })
  })

  describe('the stale-run sweep', () => {
    beforeEach(async () => {
      await service.prisma.cronRun.deleteMany({})
    })

    it('fails runs stuck past thirty minutes and frees their scope', async () => {
      const stale = await createRun(subMinutes(new Date(), 31))
      const fresh = await createRun(subMinutes(new Date(), 5))

      await service.app.get(SynthesisStaleRunSweepService).sweep(new Date())

      const swept = await service.prisma.feedbackSynthesisRun.findUniqueOrThrow(
        { where: { id: stale.id } },
      )
      expect(swept).toMatchObject({
        status: SynthesisRunStatus.failed,
        error: 'timeout',
        activeKey: null,
      })
      const untouched =
        await service.prisma.feedbackSynthesisRun.findUniqueOrThrow({
          where: { id: fresh.id },
        })
      expect(untouched.status).toBe(SynthesisRunStatus.running)
    })

    // Prod runs two replicas, and both fire the same @Cron. The second
    // firing in a slot must do nothing, even with work waiting.
    it('runs once per ten-minute slot', async () => {
      const now = new Date()
      const sweeper = service.app.get(SynthesisStaleRunSweepService)

      await sweeper.sweep(now)
      const stale = await createRun(subMinutes(now, 31))
      await sweeper.sweep(now)

      const skipped =
        await service.prisma.feedbackSynthesisRun.findUniqueOrThrow({
          where: { id: stale.id },
        })
      expect(skipped.status).toBe(SynthesisRunStatus.running)

      await sweeper.sweep(addMinutes(now, 10))

      const swept = await service.prisma.feedbackSynthesisRun.findUniqueOrThrow(
        { where: { id: stale.id } },
      )
      expect(swept.status).toBe(SynthesisRunStatus.failed)
    })
  })
})
