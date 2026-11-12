import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import type { Message } from '@aws-sdk/client-sqs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueueType } from '../queue.types'
import { QueueConsumerService } from './queueConsumer.service'

describe('QueueConsumerService - message type routing', () => {
  let service: QueueConsumerService
  let mockJobs: {
    sendMany: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mockJobs = {
      sendMany: vi.fn().mockResolvedValue(['job-1']),
    }
    service = new QueueConsumerService(createMockLogger(), mockJobs as never)
  })

  it('forwards campaignPlanComplete to its job, keyed by the message and grouped by campaign', async () => {
    const data = {
      campaignId: 123,
      status: 'completed',
      s3Key: 'results/123/test.json',
      taskCount: 10,
    }

    const result = await service.processMessage({
      MessageId: 'msg-plan-complete',
      Body: JSON.stringify({ type: QueueType.CAMPAIGN_PLAN_COMPLETE, data }),
    })

    expect(result).toBe(true)
    expect(mockJobs.sendMany).toHaveBeenCalledExactlyOnceWith(
      'campaignPlanComplete',
      [{ data, key: 'msg-plan-complete', group: '123' }],
    )
  })

  it('acks and drops a malformed campaignPlanComplete without queueing a job', async () => {
    const result = await service.processMessage({
      MessageId: 'msg-plan-bad',
      Body: JSON.stringify({
        type: QueueType.CAMPAIGN_PLAN_COMPLETE,
        data: { campaignId: 123, status: 'completed' },
      }),
    })

    expect(result).toBe(true)
    expect(mockJobs.sendMany).not.toHaveBeenCalled()
  })

  it('forwards pollAnalysisComplete to its job, grouped by poll', async () => {
    const data = {
      pollId: 'poll-1',
      totalResponses: 0,
      responsesLocation: 'polls/poll-1/all_cluster_analysis.json',
      issues: [],
    }

    const result = await service.processMessage({
      MessageId: 'msg-poll-analysis',
      Body: JSON.stringify({ type: QueueType.POLL_ANALYSIS_COMPLETE, data }),
    })

    expect(result).toBe(true)
    expect(mockJobs.sendMany).toHaveBeenCalledExactlyOnceWith(
      'pollAnalysisComplete',
      [{ data, key: 'msg-poll-analysis', group: 'poll-1' }],
    )
  })

  it('throws a malformed pollAnalysisComplete toward the DLQ', async () => {
    await expect(
      service.processMessage({
        MessageId: 'msg-poll-analysis-bad',
        Body: JSON.stringify({
          type: QueueType.POLL_ANALYSIS_COMPLETE,
          data: { pollId: 'poll-1' },
        }),
      }),
    ).rejects.toThrow()
    expect(mockJobs.sendMany).not.toHaveBeenCalled()
  })

  it('forwards agentExperimentResult to its job, grouped by run', async () => {
    const data = { runId: 'run-1', status: 'started' }

    const result = await service.processMessage({
      MessageId: 'msg-agent-result',
      Body: JSON.stringify({ type: QueueType.AGENT_EXPERIMENT_RESULT, data }),
    })

    expect(result).toBe(true)
    expect(mockJobs.sendMany).toHaveBeenCalledExactlyOnceWith(
      'agentExperimentResult',
      [{ data, key: 'msg-agent-result', group: 'run-1' }],
    )
  })

  it.each([
    ['an unknown status', { runId: 'run-1', status: 'weird' }],
    ['no runId', { status: 'success' }],
  ])(
    'throws an agentExperimentResult with %s toward the DLQ',
    async (_case, data) => {
      await expect(
        service.processMessage({
          MessageId: 'msg-agent-result-bad',
          Body: JSON.stringify({
            type: QueueType.AGENT_EXPERIMENT_RESULT,
            data,
          }),
        }),
      ).rejects.toThrow()
      expect(mockJobs.sendMany).not.toHaveBeenCalled()
    },
  )

  it('lets a failed send propagate so the message redelivers', async () => {
    mockJobs.sendMany.mockRejectedValue(new Error('db down'))

    await expect(
      service.processMessage({
        MessageId: 'msg-agent-result-db-down',
        Body: JSON.stringify({
          type: QueueType.AGENT_EXPERIMENT_RESULT,
          data: { runId: 'run-1', status: 'started' },
        }),
      }),
    ).rejects.toThrow('db down')
  })

  it.each(['someUnknownFutureType', 'outreachTextSend'])(
    'acks a %s message without queueing a job',
    async (type) => {
      const message: Message = {
        MessageId: 'msg-unknown',
        Body: JSON.stringify({ type, data: {} }),
      }

      const result = await service.processMessage(message)

      expect(result).toBe(true)
      expect(mockJobs.sendMany).not.toHaveBeenCalled()
    },
  )
})

describe('QueueConsumerService - FEEDBACK_SYNTHESIS_COMPLETE', () => {
  const buildService = (sendMany: ReturnType<typeof vi.fn>) =>
    new QueueConsumerService(createMockLogger(), { sendMany } as never)

  const synthesisMessage = (data: object): Message => ({
    MessageId: 'msg-synthesis-1',
    Body: JSON.stringify({ type: QueueType.FEEDBACK_SYNTHESIS_COMPLETE, data }),
  })

  it('forwards a valid event to its job, grouped by run', async () => {
    const sendMany = vi.fn().mockResolvedValue(['job-1'])
    const service = buildService(sendMany)
    const data = {
      sourceType: 'constituent_feedback',
      sourceId: 'run-1',
      totalResponses: 2,
      responsesLocation: 'output/feedback/run-1.json',
      issues: [
        {
          rank: 1,
          theme: 'Street flooding',
          summary: 's',
          analysis: 'a',
          responseCount: 2,
          quotes: [{ quote: 'q', respondent_id: 'feedback-1' }],
        },
      ],
    }

    const result = await service.processMessage(synthesisMessage(data))

    expect(result).toBe(true)
    expect(sendMany).toHaveBeenCalledExactlyOnceWith(
      'feedbackSynthesisComplete',
      [{ data, key: 'msg-synthesis-1', group: 'run-1' }],
    )
  })

  it('acks and drops a malformed event instead of requeueing', async () => {
    const sendMany = vi.fn()
    const service = buildService(sendMany)

    const result = await service.processMessage(
      synthesisMessage({ sourceId: 'run-1' }),
    )

    expect(result).toBe(true)
    expect(sendMany).not.toHaveBeenCalled()
  })
})
