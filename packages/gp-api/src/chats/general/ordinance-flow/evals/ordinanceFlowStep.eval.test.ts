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
type EvalStep =
  | 'clarify'
  | 'authority'
  | 'current_law'
  | 'comparables'
  | 'draft'

const KICKOFFS: Record<EvalStep, string> = {
  clarify:
    "Let's begin. Ask me your first clarifying question about this ordinance.",
  authority:
    "Let's begin. Check whether we have the legal authority to enact this.",
  current_law:
    "Let's begin. Show me what current law already does here and the gaps.",
  comparables: "Let's begin. Show me how comparable cities handled this.",
  draft: "Let's begin. Draft the ordinance from what the prior steps settled.",
}

// Cross-step design invariant: governance framing, never campaign framing.
const assertGovernanceVoice = (assistantText: string): void => {
  expect(/\bvoters\b/i.test(assistantText)).toBe(false)
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
  step: EvalStep,
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
  const segments = messages.flatMap((m) => m.segments)
  const toolNames = segments
    .filter((s) => s.toolName !== null)
    .map((s) => s.toolName as string)
  const payloadsFor = (tool: string): unknown[] =>
    segments.filter((s) => s.toolName === tool).map((s) => s.payload)
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
    payloadsFor,
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
      assertGovernanceVoice(assistantText)
    },
    STEP_TIMEOUT_MS,
  )

  // Authority (design: one verdict card, status + explanation + source, then
  // offer next). Faithfulness of the cited statute is a judge dimension.
  it(
    'authority step presents one sourced verdict and offers next',
    async () => {
      const { toolNames, payloadsFor, ordinance, assistantText } =
        await runStep('bike-parking', 'authority')

      const verdicts = payloadsFor('present_authority_finding')
      expect(verdicts.length).toBe(1)
      const v = verdicts[0] as {
        status?: string
        explanation?: string
        source?: unknown
      }
      expect(['pass', 'flag', 'attention']).toContain(v.status)
      expect((v.explanation ?? '').length).toBeGreaterThan(40)
      expect(v.source).toBeTruthy()
      expect(ordinance.authority).not.toBeNull()
      expect(toolNames).toContain('offer_next_step')
      assertGovernanceVoice(assistantText)
    },
    STEP_TIMEOUT_MS,
  )

  // Current law (design: get_code_source first, save_existing_law before
  // offering, a does/gaps summary with the chapter source).
  it(
    'current-law step grounds in the code source and saves findings',
    async () => {
      const { toolNames, payloadsFor, ordinance, assistantText } =
        await runStep('bike-parking', 'current_law')

      expect(toolNames).toContain('get_code_source')
      expect(toolNames).toContain('present_current_law_summary')
      expect(toolNames).toContain('save_existing_law')
      expect(toolNames).toContain('offer_next_step')
      const summary = payloadsFor('present_current_law_summary')[0] as {
        does?: unknown[]
        gaps?: unknown[]
      }
      expect((summary.does ?? []).length).toBeGreaterThan(0)
      expect((summary.gaps ?? []).length).toBeGreaterThan(0)
      expect(ordinance.existingLaw).not.toBeNull()
      assertGovernanceVoice(assistantText)
    },
    STEP_TIMEOUT_MS,
  )

  // Comparables (design: 3-5 cards, each sourced, ≥1 instructive failure, then
  // "write the first draft"). Real-jurisdiction faithfulness is a judge dim.
  it(
    'comparables step presents 3-5 sourced cards and offers the draft',
    async () => {
      const { toolNames, payloadsFor, assistantText } = await runStep(
        'bike-parking',
        'comparables',
      )

      const presented = payloadsFor('present_comparables')
      expect(presented.length).toBe(1)
      const cards =
        (presented[0] as { comparables?: unknown[] }).comparables ?? []
      expect(cards.length).toBeGreaterThanOrEqual(3)
      expect(cards.length).toBeLessThanOrEqual(5)
      for (const c of cards as { status?: string; source?: unknown }[]) {
        expect(['passed', 'repealed', 'unknown']).toContain(c.status)
        expect(c.source).toBeTruthy()
      }
      expect(toolNames).toContain('offer_next_step')
      assertGovernanceVoice(assistantText)
    },
    STEP_TIMEOUT_MS,
  )
})
