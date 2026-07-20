import { format } from 'date-fns'
import { z } from 'zod'
import type { LlmJsonCompletionOptions } from '../../../../llm/services/llm.service'
import type { LlmMessage } from '../../../../llm/types/llmMessages.types'

// One entry per judge seat — genuinely different models, so a panel is real
// independent review, not the same temperature-0 model answered twice. Each
// coldJudge call pins ONE model (jsonCompletion would otherwise fall back down
// a shared list and every seat would converge on the same first model).
// Three seats with a 2-of-3 majority (not two, where "majority" collapses to
// unanimous): a faithfulness gate must survive one over-strict or weak seat
// without false-failing a faithful artifact, while two agreeing seats still
// catch a real defect. Small/mid/large families for perspective diversity.
const JUDGE_SEAT_MODELS = [
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
]

export const JudgeVerdictSchema = z.object({
  pass: z.boolean(),
  score: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  reasoning: z.string(),
})

export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>

export interface RubricDimension {
  key: string
  kind: 'gate' | 'score'
  prompt: string
}

export interface ColdJudgeInput {
  rubric: string
  artifact: string
  dimension: string
  // Provided source material the artifact's claims must trace to (the fetched
  // chapter for current_law, the settled clarify/prior-step answers for the
  // draft). A blind judge can only check faithfulness it can see: with ground
  // truth it catches claims that contradict or aren't supported by it; without
  // it, a "real citation" gate is only a has-a-source proxy, not fact-checking.
  groundTruth?: string
  // Web-search results the harness gathered for the specific statutes/laws the
  // artifact cites, so an existence gate ("is this citation real?") is grounded
  // in an actual lookup instead of the judge guessing. Corroboration = real;
  // no trace of a specifically-numbered provision = fabricated. Without it, a
  // blind judge cannot tell a genuine recent law from an invented one.
  verificationEvidence?: string
}

// The subset of LlmService a cold judge needs. LlmService satisfies this
// structurally (service.app.get(LlmService) in the real-Claude eval); a fake
// satisfies it in unit tests, so the scaffold never drags in the app graph.
export interface JsonJudgeModel {
  jsonCompletion<T>(
    options: LlmJsonCompletionOptions<T>,
  ): Promise<{ object: T; tokens: number; model: string }>
}

export interface JudgePanelResult {
  verdicts: JudgeVerdict[]
  agree: boolean
  majorityPass: boolean
}

const buildSystem = (now: Date): string =>
  [
    'You are a reviewer scoring ONE artifact against ONE rubric dimension.',
    'You never saw the rubric being written and you did not write the',
    'artifact. Score 1 (fails) to 5 (fully satisfies).',
    `Today's date is ${format(now, 'MMMM d, yyyy')}; treat it as the current`,
    'date. A law, ordinance, court decision, or event dated on or before today',
    'is NOT impossible or fabricated merely because it is recent or falls after',
    'your training cutoff. Recency alone is never evidence of fabrication.',
    'On a faithfulness GATE, set pass=false ONLY when you have positive',
    'evidence the artifact is unfaithful:',
    '(a) a claim CONTRADICTS the ground truth or verification evidence',
    'provided; (b) a cited source or quoted excerpt does NOT actually support',
    'the specific claim it is attached to (judge this from the excerpt shown —',
    'a real source misattributed to a claim it does not establish still',
    'fails); (c) the artifact is internally inconsistent or logically',
    'impossible; or (d) a specific figure, threshold, statute number, or quote',
    'is asserted with NO source and cannot be derived from the material.',
    'Do NOT set pass=false merely because you cannot personally verify a',
    'specific, sourced, plausible claim — inability to browse is not evidence',
    'of fabrication. When VERIFICATION EVIDENCE is provided, use it: if it',
    'corroborates a cited provision, treat the citation as real; if it',
    'contradicts the claim or finds no trace of a specifically-numbered',
    'statute or law, treat that as fabrication. When you have no positive',
    'evidence of unfaithfulness, PASS the gate and note the residual',
    'uncertainty in your reasoning. Return only the structured verdict.',
  ].join(' ')

const buildUserPrompt = ({
  rubric,
  artifact,
  dimension,
  groundTruth,
  verificationEvidence,
}: ColdJudgeInput) =>
  [
    'Full rubric (for context only):',
    rubric,
    '',
    'The one dimension you are scoring right now:',
    dimension,
    ...(groundTruth
      ? [
          '',
          'GROUND TRUTH — the source material claims must trace to:',
          groundTruth,
        ]
      : []),
    ...(verificationEvidence
      ? [
          '',
          'VERIFICATION EVIDENCE — web-search results for the citations this',
          'artifact makes, gathered so you can check whether they are real:',
          verificationEvidence,
        ]
      : []),
    '',
    'The artifact under review:',
    artifact,
  ].join('\n')

export const coldJudge = async (
  llm: JsonJudgeModel,
  input: ColdJudgeInput,
  model?: string,
  now: Date = new Date(),
): Promise<JudgeVerdict> => {
  const messages: LlmMessage[] = [
    { role: 'system', content: buildSystem(now) },
    { role: 'user', content: buildUserPrompt(input) },
  ]
  const { object } = await llm.jsonCompletion({
    messages,
    schema: JudgeVerdictSchema,
    // One pinned model per seat (no fallback list) so panel seats stay
    // genuinely independent instead of converging on the same first model.
    ...(model ? { models: [model] } : {}),
    temperature: 0,
  })
  return object
}

// One seat per distinct judge model, so agreement means two different models
// concur — a real reliability signal, not the same model answered twice.
export const judgePanel = async (
  llm: JsonJudgeModel,
  input: ColdJudgeInput,
  seatModels: string[] = JUDGE_SEAT_MODELS,
  now: Date = new Date(),
): Promise<JudgePanelResult> => {
  const verdicts = await Promise.all(
    seatModels.map((model) => coldJudge(llm, input, model, now)),
  )
  const passes = verdicts.filter((v) => v.pass).length
  // Inter-judge agreement on the gate is the reliability signal: a split
  // pass/fail means the rubric dimension is ambiguous, not that the artifact
  // is borderline (per runbooks build-output-quality-rubric.md).
  const agree = verdicts.every((v) => v.pass === verdicts[0]?.pass)
  return { verdicts, agree, majorityPass: passes * 2 > verdicts.length }
}
