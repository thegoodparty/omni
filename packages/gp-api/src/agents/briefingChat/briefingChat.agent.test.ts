import { ModuleRef } from '@nestjs/core'
import { describe, expect, it, vi } from 'vitest'
import { LlmService, type LlmStreamResult } from '@/llm/services/llm.service'
import { useTestService } from '@/test-service'
import { AGENTS } from '../agents.registry'
import { fullBriefing } from '../meetingBriefing/meetingBriefingArtifact.fixture'

const service = useTestService()

const reply = (text: string): LlmStreamResult => ({
  textStream: (async function* () {
    yield text
  })(),
  finalText: Promise.resolve(text),
  toolCalls: Promise.resolve([]),
  usage: Promise.resolve({
    inputTokens: 100,
    outputTokens: 10,
    totalTokens: 110,
  }),
  model: 'claude-sonnet-4-6',
})

describe('briefingChat on the AI SDK engine', () => {
  it('streams a turn over the briefing the background agent wrote', async () => {
    const slug = 'eo-briefing-chat-engine'
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    const office = await service.prisma.electedOffice.create({
      data: { organizationSlug: slug, userId: service.user.id },
    })
    await AGENTS.meetingBriefing.onArtifact(
      fullBriefing,
      {
        runId: 'run-chat',
        input: {
          organizationSlug: slug,
          electedOfficeId: office.id,
          requestedAt: '2026-05-14T12:00:00Z',
          officialName: 'Rowan Ledbetter',
          state: 'NC',
          meetingDate: '2026-05-19',
        },
      },
      service.app.get(ModuleRef),
    )

    let artifactsSeen: unknown
    let system = ''
    let toolNames: string[] = []
    vi.spyOn(
      service.app.get(LlmService),
      'streamChatCompletion',
    ).mockImplementation(async ({ messages, tools = {} }) => {
      system = JSON.stringify(messages[0])
      toolNames = Object.keys(tools)
      const getArtifacts = tools.get_artifacts
      if (getArtifacts && 'execute' in getArtifacts) {
        artifactsSeen = await getArtifacts.execute({})
      }
      return reply('Lift Station 33 is the one vote.')
    })

    const chat = await service.client.post('/v1/briefing-chats', {
      meetingDate: '2026-05-19',
      anchor: { jsonPath: null, start: null, end: null },
    })
    expect(chat.status).toBe(201)

    const sent = await service.client.post(
      `/v1/briefing-chats/${chat.data.annotationId}/messages`,
      { content: 'What do I vote on?' },
      { responseType: 'text' },
    )
    expect(sent.status).toBe(200)
    expect(sent.data).toContain('"type":"text"')
    expect(sent.data).toContain('Lift Station 33 is the one vote.')
    expect(sent.data).toContain('"type":"done"')

    expect(system).toContain('Lift Station 33')
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'get_artifacts',
        'get_my_notes',
        'list_district_topics',
        'district_insights',
      ]),
    )
    expect(artifactsSeen).toEqual(expect.any(Array))

    const history = await service.client.get(
      `/v1/briefing-chats/${chat.data.annotationId}`,
    )
    expect(history.data.messages.map((m: { role: string }) => m.role)).toEqual([
      'user',
      'assistant',
    ])
  })
})
