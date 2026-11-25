import { COVERED_SCOPES } from '@/caseScout/caseScout.config'
import {
  productMapReference,
  SCORING_MODEL,
  SCORING_PROMPT,
  SECOND_READ_PROMPT,
} from '@/caseScout/caseScout.prompts'
import type { CaseListInfo } from '@/caseScout/services/caseScoutCaseLists.service'
import { buildDraftingPrompt } from '@/caseScout/util/drafting.util'
import { segmentIntoSessions } from '@/caseScout/util/sessions.util'
import {
  renderSessionTranscript,
  sessionSourceTexts,
} from '@/caseScout/util/transcript.util'
import { CASES_DIR } from '../judge/cases'
import {
  conversationIdOf,
  fixtureMessages,
  type BenchFixture,
} from './fixtures'
import { readLocalCaseList, type RecordedCall, type Stage } from './runner'

// What a live bench run should cost, before it runs and after. An estimate
// from character counts, not metering: the model service returns only the
// reply. The scout's own flat $0.75 a call is a runaway guard about 7 times
// the real price, so it would overstate a bench run several times over.

// List price for SCORING_MODEL, per million tokens.
const INPUT_USD_PER_MTOK = 5
const OUTPUT_USD_PER_MTOK = 25

// Conservative for English prose on the Opus 4.7 tokenizer, which spends more
// tokens per character than earlier Claude models did.
const CHARS_PER_TOKEN = 3

const ASSUMED_OUTPUT_TOKENS: Record<Stage, number> = {
  score: 700,
  draft: 600,
  gate: 100,
}
const ASSUMED_GATE_DRAFT_CHARS = 1_500

const STAGES: Stage[] = ['score', 'draft', 'gate']

export type CostEstimate = {
  model: string
  expectedUsd: number
  worstUsd: number
  expectedCalls: Record<Stage, number>
  worstCalls: Record<Stage, number>
}

export type CostAfter = {
  model: string
  calls: Record<Stage, number>
  estimatedUsd: number
  estimatedUsdByStage: Partial<Record<Stage, number>>
}

const usd = (inputChars: number, outputTokens: number): number =>
  ((inputChars / CHARS_PER_TOKEN) * INPUT_USD_PER_MTOK) / 1e6 +
  (outputTokens * OUTPUT_USD_PER_MTOK) / 1e6

const round = (value: number, places: number): number =>
  Number(value.toFixed(places))

const zeroes = (): Record<Stage, number> => ({ score: 0, draft: 0, gate: 0 })

// `expected` assumes the scout does what each fixture's label says (every
// should_draft or duplicate fixture reaches drafting, every should_draft one
// reaches the gate). `worst` assumes every covered fixture is drafted and
// gated and every call needs its one retry.
export const estimateBefore = (
  fixtures: BenchFixture[],
  casesDir: string = CASES_DIR,
): CostEstimate => {
  const byConversation = new Map(
    fixtures.map((fixture) => [conversationIdOf(fixture), fixture]),
  )
  const lists = new Map<string, CaseListInfo>()
  const expected = zeroes()
  const worst = zeroes()
  const expectedCalls = zeroes()
  const worstCalls = zeroes()

  for (const session of segmentIntoSessions(fixtureMessages(fixtures))) {
    const fixture = byConversation.get(session.conversationId)
    if (!fixture || !COVERED_SCOPES.has(session.scope)) continue
    const transcript = renderSessionTranscript(session)
    const caseList =
      lists.get(session.scope) ?? readLocalCaseList(session.scope, casesDir)
    lists.set(session.scope, caseList)
    const system = buildDraftingPrompt({
      agentId: session.scope,
      fixtureDescription: caseList.fixtureDescription,
      currentConditions: caseList.conditions,
      recentProposals: [],
    })

    const reference = productMapReference(session.scope).length
    const source = sessionSourceTexts(session).join('\n---\n').length
    const costs: Record<Stage, number> = {
      score: usd(
        reference + SCORING_PROMPT.length + transcript.length,
        ASSUMED_OUTPUT_TOKENS.score,
      ),
      draft: usd(
        reference + system.length + transcript.length,
        ASSUMED_OUTPUT_TOKENS.draft,
      ),
      gate: usd(
        SECOND_READ_PROMPT.length + ASSUMED_GATE_DRAFT_CHARS + source,
        ASSUMED_OUTPUT_TOKENS.gate,
      ),
    }
    const reaches: Record<Stage, boolean> = {
      score: true,
      draft: fixture.expect.should_draft || fixture.expect.covered_by !== null,
      gate: fixture.expect.should_draft,
    }
    for (const stage of STAGES) {
      worst[stage] += 2 * costs[stage]
      worstCalls[stage] += 2
      if (reaches[stage]) {
        expected[stage] += costs[stage]
        expectedCalls[stage] += 1
      }
    }
  }

  const sum = (values: Record<Stage, number>) =>
    STAGES.reduce((total, stage) => total + values[stage], 0)
  return {
    model: SCORING_MODEL,
    expectedUsd: round(sum(expected), 2),
    worstUsd: round(sum(worst), 2),
    expectedCalls,
    worstCalls,
  }
}

export const estimateAfter = (calls: RecordedCall[]): CostAfter => {
  const byStage: Partial<Record<Stage, number>> = {}
  const counts = zeroes()
  for (const call of calls) {
    counts[call.stage] += 1
    byStage[call.stage] =
      (byStage[call.stage] ?? 0) +
      usd(call.inputChars, call.outputChars / CHARS_PER_TOKEN)
  }
  const total = Object.values(byStage).reduce((sum, value) => sum + value, 0)
  return {
    model: SCORING_MODEL,
    calls: counts,
    estimatedUsd: round(total, 2),
    estimatedUsdByStage: Object.fromEntries(
      Object.entries(byStage).map(([stage, value]) => [stage, round(value, 3)]),
    ),
  }
}
