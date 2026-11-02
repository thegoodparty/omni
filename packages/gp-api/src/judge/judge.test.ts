import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { ChatMessageRole, ChatScope } from '@/generated/prisma'
import { JUDGE_CHAT_EMAIL } from './judgeTelemetry.util'
import { useTestService } from '@/test-service'
import { JudgeTurnTelemetryService } from './services/judgeTurnTelemetry.service'
import { appEnvOverrides } from '@/shared/test-utils/appEnvOverrides'
import { isNonProdDeploy } from '@/shared/util/appEnvironment.util'

// The deploy gate is a module constant read by the guard on every request.
// Driving the REAL derivation from a stubbed OTEL_SERVICE_ENVIRONMENT is the
// point of these tests: what has to hold is that the fail-closed allowlist
// refuses an absent or misspelled value, not only the literal 'prod'.

const service = useTestService()

const CONVERSATION_ID = 'judge-conversation-1'
const turnsUrl = (id: string) => `/v1/judge/conversations/${id}/turns`

const seedConversation = async (id: string, ownerUserId: number) =>
  service.prisma.chatConversation.create({
    data: {
      id,
      ownerUserId,
      scope: ChatScope.chief_of_staff,
      organizationSlug: 'judge-chief-of-staff-case-1-abcd1234',
    },
  })

const seedAssistantMessage = async (conversationId: string) =>
  service.prisma.chatMessage.create({
    data: {
      conversationId,
      role: ChatMessageRole.assistant,
      content: 'an answer',
      model: 'claude-sonnet-4',
      inputTokens: 1200,
      outputTokens: 340,
    },
  })

const seedTurn = async (args: {
  conversationId: string
  turnIndex: number
  assistantMessageId?: string
  sweepId?: string
}) =>
  service.prisma.judgeTurnTelemetry.create({
    data: {
      conversationId: args.conversationId,
      turnIndex: args.turnIndex,
      sweepId: args.sweepId ?? 'chief-of-staff-case-1-abcd1234',
      promptHash: `sha256:${'0'.repeat(64)}`,
      promptHashVersion: 'sha256-system-prompt-v1',
      toolNames: ['query_constituent_data'],
      toolSteps: [{ toolCallId: 'a', name: 'query_constituent_data' }],
      toolQueries: ['SELECT 1'],
      ...(args.assistantMessageId !== undefined && {
        assistantMessageId: args.assistantMessageId,
      }),
    },
  })

const becomeJudge = async () =>
  service.prisma.user.update({
    where: { id: service.user.id },
    data: { email: JUDGE_CHAT_EMAIL },
  })

describe('GET /v1/judge/conversations/:id/turns', () => {
  beforeEach(() => {
    appEnvOverrides.IS_NON_PROD_DEPLOY = isNonProdDeploy('dev')
  })

  describe('the deploy gate', () => {
    // The whole point of the fail-closed allowlist: an absent or unexpected
    // OTEL_SERVICE_ENVIRONMENT must deny, not silently ungate prod. Asserted
    // for the judge user, so the 404 can only be the gate.
    it.each([
      ['prod', 'prod'],
      ['unset', undefined],
      ['a typo', 'devv'],
      ['production, which is not in the allowlist', 'production'],
      ['staging', 'staging'],
    ])('404s when OTEL_SERVICE_ENVIRONMENT is %s', async (_label, value) => {
      await becomeJudge()
      await seedConversation(CONVERSATION_ID, service.user.id)
      await seedTurn({ conversationId: CONVERSATION_ID, turnIndex: 1 })
      appEnvOverrides.IS_NON_PROD_DEPLOY = isNonProdDeploy(value)

      const res = await service.client.get(turnsUrl(CONVERSATION_ID))

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })

    it.each(['dev', 'preview'])('serves on a %s deploy', async (value) => {
      await becomeJudge()
      await seedConversation(CONVERSATION_ID, service.user.id)
      await seedTurn({ conversationId: CONVERSATION_ID, turnIndex: 1 })
      appEnvOverrides.IS_NON_PROD_DEPLOY = isNonProdDeploy(value)

      const res = await service.client.get(turnsUrl(CONVERSATION_ID))

      expect(res.status).toBe(HttpStatus.OK)
    })
  })

  describe('who may read', () => {
    it('404s for a signed-in user who is not the judge', async () => {
      await seedConversation(CONVERSATION_ID, service.user.id)
      await seedTurn({ conversationId: CONVERSATION_ID, turnIndex: 1 })

      const res = await service.client.get(turnsUrl(CONVERSATION_ID))

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })

    // A conversation id alone must not hand its prompt hash and tool set to
    // whoever holds it.
    it("404s on another user's conversation", async () => {
      await becomeJudge()
      const stranger = await service.prisma.user.create({
        data: {
          clerkId: 'user_stranger',
          email: 'stranger@example.com',
          firstName: 'S',
          lastName: 'T',
        },
      })
      await seedConversation(CONVERSATION_ID, stranger.id)
      await seedTurn({ conversationId: CONVERSATION_ID, turnIndex: 1 })

      const res = await service.client.get(turnsUrl(CONVERSATION_ID))

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
      expect(JSON.stringify(res.data)).not.toContain('SELECT 1')
    })

    it('404s on a conversation that does not exist', async () => {
      await becomeJudge()

      const res = await service.client.get(turnsUrl('nope'))

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })
  })

  describe('what it returns', () => {
    it('orders by turnIndex and joins spend from the assistant message', async () => {
      await becomeJudge()
      await seedConversation(CONVERSATION_ID, service.user.id)
      const message = await seedAssistantMessage(CONVERSATION_ID)
      await seedTurn({
        conversationId: CONVERSATION_ID,
        turnIndex: 3,
        assistantMessageId: message.id,
      })
      await seedTurn({ conversationId: CONVERSATION_ID, turnIndex: 1 })

      const res = await service.client.get(turnsUrl(CONVERSATION_ID))

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.conversationId).toBe(CONVERSATION_ID)
      expect(
        res.data.turns.map((t: { turnIndex: number }) => t.turnIndex),
      ).toEqual([1, 3])
      expect(res.data.turns[1]).toMatchObject({
        assistantMessageId: message.id,
        model: 'claude-sonnet-4',
        inputTokens: 1200,
        outputTokens: 340,
        toolNames: ['query_constituent_data'],
        toolSteps: [{ toolCallId: 'a', name: 'query_constituent_data' }],
        toolQueries: ['SELECT 1'],
        dataVersion: null,
      })
    })

    // Spend lives on ChatMessage and is deliberately not duplicated here, so
    // a turn with no assistant row reports nulls rather than zeros.
    it('reports null spend for a turn that persisted no assistant row', async () => {
      await becomeJudge()
      await seedConversation(CONVERSATION_ID, service.user.id)
      await seedTurn({ conversationId: CONVERSATION_ID, turnIndex: 1 })

      const res = await service.client.get(turnsUrl(CONVERSATION_ID))

      expect(res.data.turns[0]).toMatchObject({
        assistantMessageId: null,
        model: null,
        inputTokens: null,
        outputTokens: null,
      })
    })

    it('is an empty list for a conversation the judge never recorded', async () => {
      await becomeJudge()
      await seedConversation(CONVERSATION_ID, service.user.id)

      const res = await service.client.get(turnsUrl(CONVERSATION_ID))

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.turns).toEqual([])
    })
  })
})

describe('JudgeTurnTelemetryService.recordTurn', () => {
  it('upserts, so a retried turn overwrites its own row', async () => {
    const telemetry = service.app.get(JudgeTurnTelemetryService)
    await seedConversation(CONVERSATION_ID, service.user.id)

    await telemetry.recordTurn({
      sweepId: 'run-key',
      conversationId: CONVERSATION_ID,
      turnIndex: 2,
      systemPrompt: 'first attempt',
      toolEvents: [],
    })
    await telemetry.recordTurn({
      sweepId: 'run-key',
      conversationId: CONVERSATION_ID,
      turnIndex: 2,
      systemPrompt: 'second attempt',
      toolEvents: [
        {
          toolCallId: 'a',
          name: 'query_constituent_data',
          args: { sql: 'SELECT 1' },
          status: 'returned',
          result: {},
        },
      ],
    })

    const rows = await service.prisma.judgeTurnTelemetry.findMany({
      where: { conversationId: CONVERSATION_ID },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      turnIndex: 2,
      toolNames: ['query_constituent_data'],
      toolQueries: ['SELECT 1'],
    })
  })

  it('keeps two turns of one conversation apart', async () => {
    const telemetry = service.app.get(JudgeTurnTelemetryService)
    await seedConversation(CONVERSATION_ID, service.user.id)

    await telemetry.recordTurn({
      sweepId: 'run-key',
      conversationId: CONVERSATION_ID,
      turnIndex: 1,
      systemPrompt: 'turn one',
      toolEvents: [],
    })
    await telemetry.recordTurn({
      sweepId: 'run-key',
      conversationId: CONVERSATION_ID,
      turnIndex: 3,
      systemPrompt: 'turn two',
      toolEvents: [],
    })

    const rows = await service.prisma.judgeTurnTelemetry.findMany({
      where: { conversationId: CONVERSATION_ID },
      orderBy: { turnIndex: 'asc' },
    })
    expect(rows.map((row) => row.turnIndex)).toEqual([1, 3])
    expect(rows[0]!.promptHash).not.toBe(rows[1]!.promptHash)
  })
})
