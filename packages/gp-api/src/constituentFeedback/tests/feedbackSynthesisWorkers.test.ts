import { randomUUID } from 'node:crypto'
import { formatISO, subMinutes } from 'date-fns'
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
import {
  createServeOrg,
  seedKnockMemo,
  seedTurfEffort,
} from './issueCaptureFixtures'

const service = useTestService({ jobs: true })

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

    const stubFetch = () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      onTestFinished(() => {
        vi.unstubAllGlobals()
      })
      return fetchMock
    }

    it("writes the memo CSV where the bucket's trigger watches", async () => {
      const upload = vi
        .spyOn(service.app.get(S3Service), 'uploadFile')
        .mockResolvedValue('https://s3/whatever')
      onTestFinished(() => upload.mockRestore())
      const fetchMock = stubFetch()

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
      expect(fetchMock).not.toHaveBeenCalled()
      const after = await service.prisma.feedbackSynthesisRun.findUniqueOrThrow(
        { where: { id: run.id } },
      )
      expect(after.status).toBe(SynthesisRunStatus.running)
    })

    it('fails the run when the upload fails', async () => {
      const upload = vi
        .spyOn(service.app.get(S3Service), 'uploadFile')
        .mockRejectedValue(new Error('AccessDenied'))
      onTestFinished(() => upload.mockRestore())

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
    it('fails runs stuck past thirty minutes and frees their scope', async () => {
      const stale = await createRun(subMinutes(new Date(), 31))
      const fresh = await createRun(subMinutes(new Date(), 5))

      await service.jobs.runSchedule('feedbackSynthesisStaleRuns')

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
  })
})
