import { overrideEnvForEvals } from '../../../evals/envOverride'

// Must run before the app graph constructs LlmService, so the real ANTHROPIC
// key from .env wins over the .env.test stub.
overrideEnvForEvals()

import { HttpStatus } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { ChatScope } from '../../../../generated/prisma'
import { useTestService } from '@/test-service'
import { LlmService } from '../../../../llm/services/llm.service'
import { OrdinanceFlowSearchService } from '../services/ordinanceFlowSearch.service'
import { seedFromFixture } from './seedFromFixture'
import { measureStepVerbosity } from './verbosity'
import { judgePanel } from './coldJudge'
import { gatherVerificationEvidence } from './verifyCitations'
import { stepRubrics, type RubricStep } from './rubrics'

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
// The judged tests add a real cold-judge panel (several small-model
// jsonCompletion calls) on top of the driven step turn, so they need a wider
// budget than the mechanical-only turns.
const JUDGE_TIMEOUT_MS = 480_000
// SCORE dims advise rather than block; a median at or above this is acceptable.
const SCORE_THRESHOLD = 3

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

const median = (nums: number[]): number => {
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const hi = sorted[mid] ?? 0
  const lo = sorted[mid - 1] ?? hi
  return sorted.length % 2 === 0 ? (lo + hi) / 2 : hi
}

// Assemble the artifact a blind judge scores: the step's short framing prose
// plus its persisted present_* payload(s) — the same bytes the design intends
// the UI to render. Reading the persisted payload (not the stream) keeps the
// judge scoring what the product actually ships.
const buildArtifact = (assistantText: string, payloadJson: string): string =>
  [
    'Assistant framing prose:',
    assistantText,
    '',
    'Structured step payload:',
    payloadJson,
  ].join('\n')

// Advisory reading-load report, logged every run so a prompt change shows its
// verbosity delta next to the judge results. Not a gate — budgets only become
// gates once baselines and product targets agree.
const reportVerbosity = (
  step: string,
  assistantText: string,
  payloads: unknown[],
): void => {
  const v = measureStepVerbosity({ assistantText, payloads })
  // Direct stream write — vitest's console interception hides console.*
  // output from passing tests, and this report must survive a green run.
  process.stdout.write(
    `verbosity ${step}: prose=${v.proseWords}w payload=${v.payloadWords}w total=${v.totalWords}w\n`,
  )
}

// Run the step's cold-judge rubric against one persisted artifact. Faithfulness
// GATE dims hard-fail the step on a majority no-pass; SCORE dims advise — a
// median below threshold is recorded and warned, per the gate-mechanical vs
// advise-judge split in runbooks build-output-quality-rubric.md.
const runJudges = async (
  step: RubricStep,
  artifact: string,
  groundTruth?: string,
): Promise<void> => {
  const llm = service.app.get(LlmService)
  const rubric = stepRubrics[step]
  const fullRubric = rubric
    .map((dim) => `- ${dim.key} (${dim.kind}): ${dim.prompt}`)
    .join('\n')
  // Existence gates ("is this cited statute/law real?") are unanswerable by a
  // blind judge for recent or obscure provisions — it cannot tell a genuine
  // 2026 session law from an invented one. Ground the gate in an actual web
  // lookup of the exact citations the artifact makes, so corroboration reads as
  // real and off-topic/no results reads as fabricated.
  const verificationEvidence =
    step === 'authority' || step === 'comparables'
      ? await gatherVerificationEvidence(
          service.app.get(OrdinanceFlowSearchService),
          artifact,
        )
      : undefined
  for (const dim of rubric) {
    const panel = await judgePanel(llm, {
      rubric: fullRubric,
      artifact,
      dimension: dim.prompt,
      ...(groundTruth ? { groundTruth } : {}),
      ...(verificationEvidence ? { verificationEvidence } : {}),
    })
    const why = panel.verdicts.map((v) => v.reasoning).join(' | ')
    if (dim.kind === 'gate') {
      expect(panel.majorityPass, `gate ${step}/${dim.key}: ${why}`).toBe(true)
      continue
    }
    // Two-tier by design (build-output-quality-rubric.md): faithfulness GATES
    // block, quality SCORES advise. A low score is surfaced as a warning to act
    // on when sharpening prompts, but does NOT fail the run — subjective quality
    // dims (e.g. whether an instructive-failure comparable happened to surface
    // this run) vary run-to-run and are not faithfulness violations. Asserting
    // on them made an advisory dim block, contradicting this split.
    const score = median(panel.verdicts.map((v) => v.score))
    if (score < SCORE_THRESHOLD) {
      console.warn(`advisory ${step}/${dim.key} scored ${score}: ${why}`)
    }
  }
}

d('ordinance-flow step evals (real Claude)', () => {
  // Clarify opening turn (design: ask ONE question via ask_clarify_question with
  // 2-4 options, the question lives in the payload not prose, sequential reveal
  // so no synthesis/offer yet). Parameter-grade, distinct, sourced options are
  // judge dimensions.
  it(
    'clarify step asks one sourced, parameter-grade question',
    async () => {
      const { toolNames, payloadsFor, assistantText } = await runStep(
        'bike-parking',
        'clarify',
      )

      const questions = payloadsFor('ask_clarify_question')
      expect(questions.length).toBeGreaterThanOrEqual(1)
      expect(toolNames).toContain('ask_clarify_question')
      const q = questions[0] as { options?: unknown[] }
      expect((q.options ?? []).length).toBeGreaterThanOrEqual(2)
      expect((q.options ?? []).length).toBeLessThanOrEqual(4)
      const questionMarks = (assistantText.match(/\?/g) ?? []).length
      expect(questionMarks).toBe(0)
      assertGovernanceVoice(assistantText)
      reportVerbosity('clarify', assistantText, questions)

      await runJudges(
        'clarify',
        buildArtifact(assistantText, JSON.stringify(questions[0], null, 2)),
      )
    },
    JUDGE_TIMEOUT_MS,
  )

  it(
    'draft step persists a draft via present_draft',
    async () => {
      const { ordinance, toolNames, assistantText, payloadsFor } =
        await runStep('bike-parking', 'draft')

      expect(toolNames).toContain('present_draft')
      expect(ordinance.draftBody?.length ?? 0).toBeGreaterThan(500)
      expect(ordinance.draftTitle?.length ?? 0).toBeGreaterThan(0)
      expect(ordinance.status).toBe('draft')
      // The turn's reading load is the prose plus the draft CARD copy — the
      // body is the document itself, rendered on the draft page, and counting
      // it would track document length instead of turn verbosity.
      const draftCard = payloadsFor('present_draft')[0] as {
        title?: string
        description?: string
      }
      reportVerbosity('draft', assistantText, [
        { title: draftCard?.title, description: draftCard?.description },
      ])

      await runJudges(
        'draft',
        [
          `Draft title: ${ordinance.draftTitle ?? ''}`,
          'Draft body:',
          ordinance.draftBody ?? '',
          '',
          'Prior-step material the draft must trace to:',
          `Clarify answers: ${JSON.stringify(ordinance.clarifyAnswers)}`,
          `Current-law findings: ${JSON.stringify(ordinance.existingLaw)}`,
          `Comparables: ${JSON.stringify(ordinance.comparables)}`,
        ].join('\n'),
      )
    },
    JUDGE_TIMEOUT_MS,
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
      reportVerbosity('authority', assistantText, verdicts)

      await runJudges(
        'authority',
        buildArtifact(assistantText, JSON.stringify(verdicts[0], null, 2)),
      )
    },
    JUDGE_TIMEOUT_MS,
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
      reportVerbosity('current_law', assistantText, [
        summary,
        ...payloadsFor('present_legislative_history'),
      ])

      await runJudges(
        'current_law',
        buildArtifact(
          assistantText,
          JSON.stringify(
            { summary, history: payloadsFor('present_legislative_history') },
            null,
            2,
          ),
        ),
        // The fetched chapter is the ground truth the does/gaps gate checks
        // against — without it a blind judge can't tell grounded from invented.
        `Fetched current law on the record: ${JSON.stringify(ordinance.existingLaw)}`,
      )
    },
    JUDGE_TIMEOUT_MS,
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
      reportVerbosity('comparables', assistantText, presented)

      await runJudges(
        'comparables',
        buildArtifact(assistantText, JSON.stringify(presented[0], null, 2)),
      )
    },
    JUDGE_TIMEOUT_MS,
  )
})
