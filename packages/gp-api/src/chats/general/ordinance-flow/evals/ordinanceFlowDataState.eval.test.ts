import { overrideEnvForEvals } from '../../../evals/envOverride'

// Must run before the app graph constructs LlmService, so the real ANTHROPIC
// key from .env wins over the .env.test stub.
overrideEnvForEvals()

import { HttpStatus } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { ChatScope } from '../../../../generated/prisma'
import { useTestService } from '@/test-service'
import {
  seedSyntheticEntry,
  syntheticEntryByName,
  type SyntheticOrdinanceEntry,
} from './fixtures/syntheticEntries'

// Real-Claude eval pinning the #874 jurisdiction-fallback behavior across the
// data-state axis: whether a verified OrdinanceCodeRecord exists for the org.
// With one, the current-law/authority steps ground in the verified
// municipality; without one, the agent must ask for or flag the missing
// jurisdiction rather than invent it. Gated by RUN_LLM_EVALS=1 — skipped in the
// normal suite and in CI, run by hand:
//   RUN_LLM_EVALS=1 npx vitest run \
//     src/chats/general/ordinance-flow/evals/ordinanceFlowDataState.eval.test.ts
const RUN = process.env.RUN_LLM_EVALS === '1'
const d = RUN ? describe : describe.skip

const SCOPE = ChatScope.ordinance_flow
const STEP_TIMEOUT_MS = 240_000

type DataStateStep = 'authority' | 'current_law'

const KICKOFFS: Record<DataStateStep, string> = {
  authority:
    "Let's begin. Check whether we have the legal authority to enact this.",
  current_law:
    "Let's begin. Show me what current law already does here and the gaps.",
}

// Cross-step design invariant: governance framing, never campaign framing.
const assertGovernanceVoice = (assistantText: string): void => {
  expect(/\bvoters\b/i.test(assistantText)).toBe(false)
}

// The agent surfaces that it does not know the jurisdiction — asking which
// city/state it is or flagging that no verified code source is on file —
// instead of silently inventing one. Broad by design: the contract is that the
// missing jurisdiction is named, not the exact phrasing.
const JURISDICTION_FLAG_PATTERNS: RegExp[] = [
  /which (city|municipality|jurisdiction|town)/i,
  /what (city|municipality|jurisdiction|town)/i,
  /city (and|or) state/i,
  /which state/i,
  /(confirm|tell me|let me know|need to know|not sure|don'?t (?:have|know)|couldn'?t (?:find|locate)|no verified)[^.?!]*\b(city|municipality|jurisdiction|code source|which)\b/i,
  /haven'?t (?:been )?(?:able to )?(?:confirm|identify|verify)[^.?!]*\b(city|municipality|jurisdiction)\b/i,
]
const flagsMissingJurisdiction = (text: string): boolean =>
  JURISDICTION_FLAG_PATTERNS.some((re) => re.test(text))

// The step grounded in the verified municipality: it names the place or state.
// The place names are distinctive; the state is matched on a word boundary so
// "NC" doesn't hit inside another word.
const mentionsJurisdiction = (
  text: string,
  place: string,
  state: string,
): boolean =>
  text.toLowerCase().includes(place.toLowerCase()) ||
  new RegExp(`\\b${state}\\b`).test(text)

const service = useTestService()

const anchorFor = (ordinanceId: string, step: string) => ({
  resourceType: 'ordinance',
  resourceId: ordinanceId,
  url: `https://goodparty.org/ordinances/${ordinanceId}`,
  snapshot: { title: 'Eval ordinance', summary: 'Eval synthetic entry.' },
  step,
})

// Drive one step's opening turn end to end against a goal-only synthetic entry
// and return the persisted result: the ordinance row and the assistant turn's
// tool + text segments. Reads back from the DB — the persisted state is the
// source of truth the UI and later steps depend on.
const runStep = async (entry: SyntheticOrdinanceEntry, step: DataStateStep) => {
  const seeded = await seedSyntheticEntry(
    service.prisma,
    service.user.id,
    entry,
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
  // Read message.content, not text segments: content always carries the full
  // assistant text, while segments are only written for tool-bearing turns —
  // a pure-text turn (e.g. the no-code-record prose flag this file exists to
  // probe) has no segments, which made these assertions run against ''.
  const assistantText = messages
    .filter((m) => m.role === 'assistant')
    .map((m) => m.content ?? '')
    .join('\n')

  return { seeded, ordinance, toolNames, payloadsFor, assistantText }
}

d('ordinance-flow data-state evals (real Claude)', () => {
  // With a verified code record, current-law grounds does/gaps in the real
  // municipality and persists the findings.
  it(
    'current-law with a code record grounds in the verified jurisdiction',
    async () => {
      const entry = syntheticEntryByName('late-night-noise')
      const { ordinance, toolNames, payloadsFor, assistantText } =
        await runStep(entry, 'current_law')

      expect(toolNames).toContain('get_code_source')
      expect(toolNames).toContain('present_current_law_summary')
      expect(toolNames).toContain('save_existing_law')
      const summary = payloadsFor('present_current_law_summary')[0] as {
        does?: unknown[]
        gaps?: unknown[]
      }
      expect((summary.does ?? []).length).toBeGreaterThan(0)
      expect((summary.gaps ?? []).length).toBeGreaterThan(0)
      expect(ordinance.existingLaw).not.toBeNull()

      const grounded = mentionsJurisdiction(
        [
          assistantText,
          JSON.stringify(payloadsFor('present_current_law_summary')),
          JSON.stringify(ordinance.existingLaw),
        ].join('\n'),
        entry.place,
        entry.state,
      )
      expect(grounded).toBe(true)
      assertGovernanceVoice(assistantText)
    },
    STEP_TIMEOUT_MS,
  )

  // Same topic, code record removed: the agent cannot know the jurisdiction, so
  // it must flag/ask for it and must NOT fabricate a current-law summary.
  it(
    'current-law without a code record flags the jurisdiction, not invents',
    async () => {
      const entry = syntheticEntryByName('late-night-noise')
      const { ordinance, assistantText } = await runStep(
        { ...entry, hasCodeRecord: false },
        'current_law',
      )

      expect(flagsMissingJurisdiction(assistantText)).toBe(true)
      // No verified municipality → nothing to ground on → no persisted law.
      expect(ordinance.existingLaw).toBeNull()
      assertGovernanceVoice(assistantText)
    },
    STEP_TIMEOUT_MS,
  )

  // The flag behavior holds across topics on the authority step (which has no
  // clarify-question tool, so the agent must surface the gap in prose).
  for (const name of ['food-truck-permitting', 'tree-canopy']) {
    it(
      `authority without a code record flags the jurisdiction (${name})`,
      async () => {
        const entry = syntheticEntryByName(name)
        const { assistantText } = await runStep(
          { ...entry, hasCodeRecord: false },
          'authority',
        )

        expect(flagsMissingJurisdiction(assistantText)).toBe(true)
        assertGovernanceVoice(assistantText)
      },
      STEP_TIMEOUT_MS,
    )
  }
})
