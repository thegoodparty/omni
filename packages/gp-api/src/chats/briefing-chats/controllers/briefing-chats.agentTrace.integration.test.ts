import { HttpStatus } from '@nestjs/common'
import { trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { createAnthropic } from '@ai-sdk/anthropic'
import { type LanguageModel } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AnnotationKind,
  AnnotationResourceType,
  ChatScope,
  ExperimentRunStatus,
} from '../../../generated/prisma'
import { firstOrThrow } from '@/shared/test-utils/arrays.util'
import { LlmService } from '@/llm/services/llm.service'
import { useTestService } from '@/test-service'
import { S3Service } from '@/vendors/aws/services/s3.service'

// The briefing route passes no `scope` (scope also decides attachment
// injection and which product a citation is attributed to), so its turns used
// to reach Grafana Agent Observability as the generic 'chat' agent. The turn
// names its own agent instead; this drives the real model loop and reads the
// spans the AI SDK exports.

const service = useTestService()

const BRIEFING_BUCKET = 'briefings-bucket'
const ARTIFACT_CONTENT = '# Briefing\n\nbody'

const streamingModel = () =>
  new MockLanguageModelV3({
    provider: 'anthropic.messages',
    modelId: 'claude-sonnet-4-6',
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          controller.enqueue({ type: 'text-start', id: 't1' })
          controller.enqueue({ type: 'text-delta', id: 't1', delta: 'On it.' })
          controller.enqueue({ type: 'text-end', id: 't1' })
          controller.enqueue({
            type: 'finish',
            usage: {
              inputTokens: {
                total: 11,
                noCache: 11,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 3, text: 3, reasoning: 0 },
            },
            finishReason: { unified: 'stop', raw: 'stop' },
          })
          controller.close()
        },
      }),
    }),
  })

type ProviderSlot = { anthropicProvider: unknown }

describe('briefing chat turns in Agent Observability', () => {
  let exporter: InMemorySpanExporter
  let provider: BasicTracerProvider
  let originalProvider: unknown
  let annotationId: string
  let conversationId: string

  beforeEach(async () => {
    const slug = `agents-${service.user.id}-${Math.random().toString(36).slice(2, 10)}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    const electedOffice = await service.prisma.electedOffice.create({
      data: { organizationSlug: slug, userId: service.user.id },
    })
    const run = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: slug,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.COMPLETED,
      },
    })
    const briefing = await service.prisma.meetingBriefing.create({
      data: {
        electedOfficeId: electedOffice.id,
        experimentRunId: run.runId,
        artifactBucket: BRIEFING_BUCKET,
        artifactKey: `${slug}/briefing.md`,
        meetingDate: new Date('2026-06-01T00:00:00Z'),
        meetingTime: '18:00',
        meetingTimezone: 'America/New_York',
      },
    })
    const conversation = await service.prisma.chatConversation.create({
      data: { ownerUserId: service.user.id },
    })
    const annotation = await service.prisma.annotation.create({
      data: {
        authorUserId: service.user.id,
        kind: AnnotationKind.chat,
        resourceId: briefing.id,
        resourceType: AnnotationResourceType.briefing,
        chatConversationId: conversation.id,
      },
    })
    annotationId = annotation.id
    conversationId = conversation.id

    vi.spyOn(service.app.get(S3Service), 'getFile').mockResolvedValue(
      ARTIFACT_CONTENT,
    )

    const anthropic = createAnthropic({ apiKey: 'test' })
    const llm = service.app.get(LlmService) as unknown as ProviderSlot
    originalProvider = llm.anthropicProvider
    const model = streamingModel()
    llm.anthropicProvider = {
      languageModel: () => model as LanguageModel,
      webSearchTool: (spec: { maxUses?: number }) =>
        anthropic.tools.webSearch_20250305(spec),
    }

    exporter = new InMemorySpanExporter()
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    trace.setGlobalTracerProvider(provider)
  })

  afterEach(() => {
    trace.disable()
    ;(
      service.app.get(LlmService) as unknown as ProviderSlot
    ).anthropicProvider = originalProvider
  })

  it('files the generation under briefing_annotation, not the generic chat agent', async () => {
    const res = await service.client.post(
      `/v1/briefing-chats/${annotationId}/messages`,
      { content: 'what is on the agenda?' },
    )
    expect(res.status).toBe(HttpStatus.OK)

    const generation = firstOrThrow(
      exporter
        .getFinishedSpans()
        .filter((s) => s.attributes['gen_ai.operation.name'] === 'chat'),
    )
    expect(generation.attributes).toMatchObject({
      'agento11y.record': true,
      'gen_ai.conversation.id': conversationId,
      'gen_ai.agent.name': ChatScope.briefing_annotation,
    })
  })
})
