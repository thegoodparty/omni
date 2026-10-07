import { BadGatewayException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiGenerationService } from './aiGeneration.service'
import { S3Service } from 'src/vendors/aws/services/s3.service'
import { CampaignTaskType } from '../campaignTasks.types'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'

vi.mock('src/queue/queue.config', () => ({
  queueConfig: {
    name: 'test-queue',
    queueUrl: 'https://sqs.us-west-2.amazonaws.com/123/test-queue',
    region: 'us-west-2',
  },
  campaignPlanQueueConfig: {
    resultsBucket: 'test-bucket',
  },
}))

const mockS3Service: Partial<S3Service> = {
  getFile: vi.fn(),
}

const validS3Payload = JSON.stringify({
  campaignId: 1,
  tasks: [
    {
      title: 'Town Hall Meeting',
      description: 'Meet voters at town hall',
      cta: 'Attend event',
      flowType: CampaignTaskType.events,
      week: 10,
      date: '2026-08-15',
      url: 'https://example.com/event',
    },
  ],
  taskCount: 1,
  generationTimestamp: '2026-04-08T00:00:00Z',
})

describe('AiGenerationService', () => {
  let service: AiGenerationService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new AiGenerationService(
      mockS3Service as S3Service,
      createMockLogger(),
    )
  })

  describe('readResultFromS3', () => {
    it('reads and parses valid S3 payload', async () => {
      vi.mocked(mockS3Service.getFile!).mockResolvedValue(validS3Payload)

      const result = await service.readResultFromS3('results/1/test.json')

      expect(result.campaignId).toBe(1)
      expect(result.tasks).toHaveLength(1)
      expect(result.tasks[0]?.title).toBe('Town Hall Meeting')
    })

    it('throws when file not found in S3', async () => {
      vi.mocked(mockS3Service.getFile!).mockResolvedValue(undefined)

      await expect(
        service.readResultFromS3('results/1/missing.json'),
      ).rejects.toThrow(BadGatewayException)
    })

    it('throws when payload is invalid JSON', async () => {
      vi.mocked(mockS3Service.getFile!).mockResolvedValue('not json')

      await expect(
        service.readResultFromS3('results/1/bad.json'),
      ).rejects.toThrow(BadGatewayException)
    })

    it('throws when payload does not match schema', async () => {
      vi.mocked(mockS3Service.getFile!).mockResolvedValue(
        JSON.stringify({ wrong: 'shape' }),
      )

      await expect(
        service.readResultFromS3('results/1/bad-schema.json'),
      ).rejects.toThrow(BadGatewayException)
    })
  })

  describe('parseCompletionResult', () => {
    it('reads S3 and returns parsed tasks', async () => {
      vi.mocked(mockS3Service.getFile!).mockResolvedValue(validS3Payload)

      const { campaignId, tasks } = await service.parseCompletionResult({
        campaignId: 1,
        status: 'completed',
        s3Key: 'results/1/test.json',
        taskCount: 1,
        generationTimestamp: '2026-04-08T00:00:00Z',
      })

      expect(campaignId).toBe(1)
      expect(tasks).toHaveLength(1)
      expect(tasks[0]).toEqual(
        expect.objectContaining({
          title: 'Town Hall Meeting',
          flowType: CampaignTaskType.events,
          link: 'https://example.com/event',
        }),
      )
    })
  })

  describe('parseLambdaResultToTasks', () => {
    it('maps Lambda output to CampaignTask format', () => {
      const result = service.parseLambdaResultToTasks(
        {
          campaignId: 1,
          tasks: [
            {
              title: 'Event',
              description: 'Desc',
              cta: 'Go',
              flowType: CampaignTaskType.events,
              week: 5,
              date: '2026-09-01',
              url: 'https://example.com',
            },
          ],
          taskCount: 1,
          generationTimestamp: '2026-04-08T00:00:00Z',
        },
        42,
      )

      expect(result).toHaveLength(1)
      expect(result[0]?.title).toBe('Event')
      expect(result[0]?.flowType).toBe(CampaignTaskType.events)
      expect(result[0]?.link).toBe('https://example.com')
      expect(result[0]?.id).toMatch(/^event-42-0-/)
    })

    it('throws on unknown flowType via Zod parsing', async () => {
      const payloadWithBadFlowType = JSON.stringify({
        campaignId: 1,
        tasks: [
          {
            title: 'Event',
            description: 'Desc',
            cta: 'Go',
            flowType: 'unknown_type',
            week: 1,
            date: '2026-09-01',
          },
        ],
        taskCount: 1,
        generationTimestamp: '2026-04-08T00:00:00Z',
      })
      vi.mocked(mockS3Service.getFile!).mockResolvedValue(
        payloadWithBadFlowType,
      )

      await expect(
        service.readResultFromS3('results/1/test.json'),
      ).rejects.toThrow(BadGatewayException)
    })

    it('maps url to link, undefined when absent', () => {
      const result = service.parseLambdaResultToTasks(
        {
          campaignId: 1,
          tasks: [
            {
              title: 'No URL',
              description: 'Desc',
              cta: 'Go',
              flowType: CampaignTaskType.events,
              week: 1,
              date: '2026-09-01',
            },
          ],
          taskCount: 1,
          generationTimestamp: '2026-04-08T00:00:00Z',
        },
        1,
      )

      expect(result[0]).toEqual({
        id: 'event-1-0-2026-04-08T00:00:00Z',
        title: 'No URL',
        description: 'Desc',
        cta: 'Go',
        flowType: CampaignTaskType.events,
        week: 1,
        date: '2026-09-01',
        link: undefined,
        proRequired: false,
      })
    })
  })
})
