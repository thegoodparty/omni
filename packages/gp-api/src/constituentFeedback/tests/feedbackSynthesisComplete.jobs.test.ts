import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import type { FeedbackSynthesisCompleteEvent } from '@goodparty_org/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SynthesisRunStatus } from '@/generated/prisma'
import { JobsService } from '@/jobs/jobs.service'
import { LlmService } from '@/llm/services/llm.service'
import { useTestService } from '@/test-service'
import { FeedbackSynthesisIngestService } from '../services/feedbackSynthesisIngest.service'
import { MockSynthesisEngine } from '../services/mockSynthesisEngine'
import {
  completionEvent,
  createServeOrg,
  ownerHeaders,
  seedKnockMemo,
  seedTurfEffort,
} from './issueCaptureFixtures'

const service = useTestService({ jobs: true })

let slug: string
let runId: string
let memoIds: string[]

beforeEach(async () => {
  // The run's results come from the job below, not the mock engine.
  vi.spyOn(
    service.app.get(MockSynthesisEngine),
    'scheduleCompletion',
  ).mockImplementation(() => {})
  vi.spyOn(service.app.get(LlmService), 'jsonCompletion').mockRejectedValue(
    new Error('No model in this suite'),
  )

  slug = await createServeOrg(service)
  const effort = await seedTurfEffort(service, slug, { people: 5 })
  memoIds = []
  for (const target of effort.targets) {
    const { memo } = await seedKnockMemo(service, {
      slug,
      outreachId: effort.outreachId,
      personId: target.personId,
    })
    memoIds.push(memo.id)
  }
  const res = await service.client.post(
    `/v1/constituent-feedback/efforts/${effort.outreachId}/synthesize`,
    {},
    ownerHeaders(slug),
  )
  expect(res.status).toBe(HttpStatus.CREATED)
  runId = res.data.id
})

// What the SQS consumer does with a feedbackSynthesisComplete message.
const receive = (data: FeedbackSynthesisCompleteEvent['data']) =>
  service.app
    .get(JobsService)
    .sendMany('feedbackSynthesisComplete', [
      { data, key: randomUUID(), group: data.sourceId },
    ])

describe('the feedbackSynthesisComplete job', () => {
  it('completes the run with the themes it names', async () => {
    await receive(
      completionEvent(runId, [{ theme: 'Street flooding', memberIds: memoIds }])
        .data,
    )
    await service.jobs.settle()

    const run = await service.prisma.feedbackSynthesisRun.findUniqueOrThrow({
      where: { id: runId },
    })
    expect(run.status).toBe(SynthesisRunStatus.completed)
    const themes = await service.prisma.feedbackTheme.findMany({
      where: { runId },
      select: { title: true },
    })
    expect(themes).toEqual([{ title: 'Street flooding' }])
  })

  it('warns when the run used the in-repo theme prompt', async () => {
    const warn = vi.spyOn(
      service.app.get(FeedbackSynthesisIngestService).logger,
      'warn',
    )

    await receive({
      ...completionEvent(runId, []).data,
      promptSource: 'fallback',
    })
    await service.jobs.settle()

    expect(warn).toHaveBeenCalledWith(
      { sourceType: 'constituent_feedback', sourceId: runId },
      'Synthesis run used the in-repo theme prompt',
    )
  })

  it.each([['hosted' as const], [undefined]])(
    'does not warn when the prompt source is %s',
    async (promptSource) => {
      const warn = vi.spyOn(
        service.app.get(FeedbackSynthesisIngestService).logger,
        'warn',
      )

      await receive({ ...completionEvent(runId, []).data, promptSource })
      await service.jobs.settle()

      expect(warn).not.toHaveBeenCalledWith(
        expect.anything(),
        'Synthesis run used the in-repo theme prompt',
      )
    },
  )
})
