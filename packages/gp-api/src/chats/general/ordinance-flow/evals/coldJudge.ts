import { z } from 'zod'
import type { LlmJsonCompletionOptions } from '../../../../llm/services/llm.service'
import type { LlmMessage } from '../../../../llm/types/llmMessages.types'

// One entry per judge seat — genuinely different models, so a panel is real
// independent review, not the same temperature-0 model answered twice. Each
// coldJudge call pins ONE model (jsonCompletion would otherwise fall back down
// a shared list and every seat would converge on the same first model).
const JUDGE_SEAT_MODELS = ['claude-haiku-4-5', 'claude-sonnet-4-6']

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

const JUDGE_SYSTEM = [
  'You are a blind reviewer scoring ONE artifact against ONE rubric',
  'dimension. You never saw the rubric being written and you did not write',
  'the artifact. Judge only from the artifact and any GROUND TRUTH provided;',
  'do not rely on outside knowledge of the specific jurisdiction.',
  'Score 1 (fails) to 5 (fully satisfies).',
  'On a faithfulness gate, set pass=false when a claim CONTRADICTS the',
  'ground truth, or asserts a specific fact, statute number, figure, or',
  'quote that has no supporting source in the artifact or ground truth.',
  'Do NOT fail a claim merely because you personally cannot verify an',
  'external fact that the artifact backs with a cited source — a blind',
  'reviewer cannot fact-check the open web; flag unsupported assertions,',
  'not sourced ones. Return only the structured verdict.',
].join(' ')

const buildUserPrompt = ({
  rubric,
  artifact,
  dimension,
  groundTruth,
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
    '',
    'The artifact under review:',
    artifact,
  ].join('\n')

export const coldJudge = async (
  llm: JsonJudgeModel,
  input: ColdJudgeInput,
  model?: string,
): Promise<JudgeVerdict> => {
  const messages: LlmMessage[] = [
    { role: 'system', content: JUDGE_SYSTEM },
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
): Promise<JudgePanelResult> => {
  const verdicts = await Promise.all(
    seatModels.map((model) => coldJudge(llm, input, model)),
  )
  const passes = verdicts.filter((v) => v.pass).length
  // Inter-judge agreement on the gate is the reliability signal: a split
  // pass/fail means the rubric dimension is ambiguous, not that the artifact
  // is borderline (per runbooks build-output-quality-rubric.md).
  const agree = verdicts.every((v) => v.pass === verdicts[0]?.pass)
  return { verdicts, agree, majorityPass: passes * 2 > verdicts.length }
}
