import { overrideEnvForEvals } from '../../../evals/envOverride'

// Must run before the app graph constructs LlmService, so the real ANTHROPIC
// key from .env wins over the .env.test stub.
overrideEnvForEvals()

import { HttpStatus } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { ChatScope } from '../../../../generated/prisma'
import { useTestService } from '@/test-service'
import { seedFromFixture } from './seedFromFixture'

// Real-Claude eval: boots the real app, seeds a step-entry state from a captured
// fixture, and drives the step's opening turn through the real chat pipeline
// (no stream mock). Gated by RUN_LLM_EVALS=1 — skipped in the normal suite and
// in CI, run by hand:
//   RUN_LLM_EVALS=1 npx vitest run \
//     src/chats/general/ordinance-flow/evals/ordinanceFlowStep.eval.test.ts
const RUN = process.env.RUN_LLM_EVALS === '1'
const d = RUN ? describe : describe.skip

const SCOPE = ChatScope.ordinance_flow
const STEP_TIMEOUT_MS = 240_000

// The hidden opener the webapp sends per step to make the agent take the first
// turn (mirrors OrdinanceFlowChat KICKOFFS). The draft opener must instruct
// drafting, not questioning.
const KICKOFFS: Record<string, string> = {
  clarify:
    "Let's begin. Ask me your first clarifying question about this ordinance.",
  draft: "Let's begin. Draft the ordinance from what the prior steps settled.",
}

const service = useTestService()

const anchorFor = (ordinanceId: string, step: string) => ({
  resourceType: 'ordinance',
  resourceId: ordinanceId,
  url: `https://goodparty.org/ordinances/${ordinanceId}`,
  snapshot: { title: 'Eval ordinance', summary: 'Eval fixture.' },
  step,
})

// Drive one step's opening turn end to end and return the persisted result:
// the ordinance row (draft columns, clarify answers) and the assistant turn's
// tool segments. Reads back from the DB, not the stream — the persisted state
// is the source of truth the UI and later steps depend on.
const runStep = async (
  fixture: Parameters<typeof seedFromFixture>[2],
  step: 'clarify' | 'draft',
) => {
  const seeded = await seedFromFixture(
    service.prisma,
    service.user.id,
    fixture,
    step,
  )
  const headers = {
    headers: { 'X-Organization-Slug': seeded.organizationSlug },
  }

  const created = await service.client.post(
    '/v1/chats',
    { scope: SCOPE, anchor: anchorFor(seeded.ordinanceId, step) },
    headers,
  )
  expect(created.status).toBe(HttpStatus.CREATED)
  const conversationId = created.data.conversationId as string

  const res = await service.client.post(
    `/v1/chats/${conversationId}/messages?scope=${SCOPE}`,
    { content: KICKOFFS[step] },
    headers,
  )
  expect(res.status).toBe(HttpStatus.OK)

  const ordinance = await service.prisma.ordinance.findUniqueOrThrow({
    where: { id: seeded.ordinanceId },
  })
  const messages = await service.prisma.chatMessage.findMany({
    where: { conversationId },
    include: { segments: true },
    orderBy: { createdAt: 'asc' },
  })
  const toolNames = messages
    .flatMap((m) => m.segments)
    .filter((s) => s.toolName !== null)
    .map((s) => s.toolName as string)
  const assistantText = messages
    .filter((m) => m.role === 'assistant')
    .flatMap((m) => m.segments)
    .filter((s) => s.kind === 'text')
    .map((s) => s.text ?? '')
    .join('\n')

  return {
    seeded,
    ordinance,
    toolNames,
    assistantText,
    streamed: String(res.data),
  }
}

d('ordinance-flow step evals (real Claude)', () => {
  it(
    'draft step persists a draft via present_draft',
    async () => {
      const { ordinance, toolNames } = await runStep('bike-parking', 'draft')

      expect(toolNames).toContain('present_draft')
      expect(ordinance.draftBody?.length ?? 0).toBeGreaterThan(500)
      expect(ordinance.draftTitle?.length ?? 0).toBeGreaterThan(0)
      expect(ordinance.status).toBe('draft')
    },
    STEP_TIMEOUT_MS,
  )

  it(
    'draft step does not interview in prose',
    async () => {
      const { assistantText, toolNames } = await runStep(
        'bike-parking',
        'draft',
      )

      const clarifyCalls = toolNames.filter(
        (t) => t === 'ask_clarify_question',
      ).length
      expect(clarifyCalls).toBeLessThanOrEqual(1)
      const questionMarks = (assistantText.match(/\?/g) ?? []).length
      expect(questionMarks).toBeLessThanOrEqual(1)
    },
    STEP_TIMEOUT_MS,
  )
})
