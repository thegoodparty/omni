/**
 * Blind graded-pairwise judging of two agent outputs for the same input.
 *
 * The judge never learns which variant produced which output, and never learns
 * that one of them is the incumbent. It sees "Output 1" and "Output 2" in an
 * order derived from the case id, so the assignment is arbitrary but reproducible.
 *
 * Every pair is judged twice with the presentation swapped. A pair whose verdict
 * reverses under the swap is recorded as unstable and excluded from scoring rather
 * than silently averaged away. That flip rate is the cheapest available check that
 * the judge is measuring the outputs and not their position.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CaseVerdict, Margin, VariantRole } from './types.js'

const HERE = dirname(fileURLToPath(import.meta.url))
export const RUBRIC_DIR = join(HERE, '..', 'rubrics')

export const DEFAULT_JUDGE_MODEL = 'claude-opus-4-7'

const PRICE_IN_PER_TOKEN = 15 / 1_000_000
const PRICE_OUT_PER_TOKEN = 75 / 1_000_000

/**
 * Artifacts vary wildly in size — a meeting briefing dwarfs an issue list. Cap
 * each side so one huge output cannot crowd the rubric out of the context window.
 */
const MAX_OUTPUT_CHARS = 60_000

const VERDICT_TOOL = {
  name: 'record_verdict',
  description: 'Record the comparison verdict. Call exactly once.',
  input_schema: {
    type: 'object' as const,
    properties: {
      winner: {
        type: 'string',
        enum: ['output_1', 'output_2', 'tie'],
        description: 'Which output is better, or tie.',
      },
      margin: {
        type: 'string',
        enum: ['much_better', 'better', 'tie'],
        description:
          'How much better. Must be "tie" when winner is "tie", and must not be "tie" otherwise.',
      },
      deciding_criterion: {
        type: 'string',
        description:
          'The single rubric criterion that decided it, named as it appears in the rubric. Use "none" for a tie.',
      },
      rationale: {
        type: 'string',
        description:
          'Two to four sentences citing the specific text that demonstrates the deciding criterion.',
      },
    },
    required: ['winner', 'margin', 'deciding_criterion', 'rationale'],
  },
}

export const loadRubric = (agent: string, rubricDir = RUBRIC_DIR) => {
  const universal = readFileSync(join(rubricDir, 'universal.md'), 'utf8')
  const addendumPath = join(rubricDir, `${agent}.md`)
  if (!existsSync(addendumPath)) return universal
  return [
    universal,
    '---',
    `# Agent-specific addendum: ${agent}`,
    'These criteria are additional to the universal rubric above, not a replacement',
    'for it. Tier precedence still applies.',
    readFileSync(addendumPath, 'utf8'),
  ].join('\n\n')
}

const render = (output: unknown) => {
  const text =
    typeof output === 'string' ? output : JSON.stringify(output, null, 2)
  return text.length <= MAX_OUTPUT_CHARS
    ? text
    : `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[... truncated for length ...]`
}

const buildPrompt = (input: unknown, first: unknown, second: unknown) =>
  [
    'Two variants of the same system produced these two outputs from the same input.',
    'Compare them using the rubric and record your verdict.',
    '',
    '## Input both outputs were given',
    '',
    '```json',
    JSON.stringify(input, null, 2),
    '```',
    '',
    '## Output 1',
    '',
    '```json',
    render(first),
    '```',
    '',
    '## Output 2',
    '',
    '```json',
    render(second),
    '```',
    '',
    'Call record_verdict exactly once.',
  ].join('\n')

export type SingleJudgement = {
  winner: VariantRole | 'tie'
  margin: Margin
  decidingCriterion: string
  rationale: string
  costUsd: number
}

const judgeOnce = async (
  client: Anthropic,
  rubric: string,
  input: unknown,
  first: unknown,
  second: unknown,
  firstRole: VariantRole,
  secondRole: VariantRole,
  model: string,
): Promise<SingleJudgement> => {
  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    system: rubric,
    tools: [VERDICT_TOOL],
    tool_choice: { type: 'tool', name: 'record_verdict' },
    messages: [{ role: 'user', content: buildPrompt(input, first, second) }],
  })

  const block = response.content.find((b) => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') {
    throw new Error(
      `judge returned no tool call (stop: ${response.stop_reason})`,
    )
  }

  const data = block.input as {
    winner: string
    margin: Margin
    deciding_criterion: string
    rationale: string
  }

  let winner: VariantRole | 'tie' =
    data.winner === 'output_1'
      ? firstRole
      : data.winner === 'output_2'
        ? secondRole
        : 'tie'
  let margin: Margin = winner === 'tie' ? 'tie' : data.margin
  // A model that picks a side but grades the margin as a tie has not picked a side.
  if (margin === 'tie') winner = 'tie'

  return {
    winner,
    margin,
    decidingCriterion: data.deciding_criterion,
    rationale: data.rationale,
    costUsd:
      response.usage.input_tokens * PRICE_IN_PER_TOKEN +
      response.usage.output_tokens * PRICE_OUT_PER_TOKEN,
  }
}

/** Arbitrary but reproducible: the same case always gets the same starting order. */
const baselineFirst = (caseId: string) =>
  createHash('sha256').update(caseId).digest()[0] % 2 === 0

const MARGIN_RANK: Record<Margin, number> = {
  tie: 0,
  better: 1,
  much_better: 2,
}

export const judgePair = async (args: {
  caseId: string
  input: unknown
  baselineOutput: unknown
  candidateOutput: unknown
  agent: string
  client: Anthropic
  model?: string
  rubric?: string
}): Promise<CaseVerdict> => {
  const model = args.model ?? DEFAULT_JUDGE_MODEL
  const rubric = args.rubric ?? loadRubric(args.agent)
  const orders = [baselineFirst(args.caseId), !baselineFirst(args.caseId)]

  const judgements: SingleJudgement[] = []
  for (const baseIsFirst of orders) {
    judgements.push(
      baseIsFirst
        ? await judgeOnce(
            args.client,
            rubric,
            args.input,
            args.baselineOutput,
            args.candidateOutput,
            'baseline',
            'candidate',
            model,
          )
        : await judgeOnce(
            args.client,
            rubric,
            args.input,
            args.candidateOutput,
            args.baselineOutput,
            'candidate',
            'baseline',
            model,
          ),
    )
  }

  const [first, second] = judgements
  return reconcile(args.caseId, first, second)
}

/**
 * Combine the two order-swapped judgements into one verdict.
 *
 * Disagreement about direction means the judge was reading position rather than
 * content, so the pair is marked unstable instead of being resolved by fiat. When
 * both passes agree on direction but not on strength, the weaker margin wins: one
 * enthusiastic pass should not be able to inflate a result.
 */
export const reconcile = (
  caseId: string,
  first: SingleJudgement,
  second: SingleJudgement,
): CaseVerdict => {
  const judgeCostUsd = first.costUsd + second.costUsd

  if (first.winner !== second.winner) {
    return {
      caseId,
      winner: 'tie',
      margin: 'tie',
      decidingCriterion: 'unstable',
      rationale:
        `Unstable under order swap. Shown one way the judge picked ${first.winner} ` +
        `(${first.margin}); shown the other way it picked ${second.winner} ` +
        `(${second.margin}). First rationale: ${first.rationale}`,
      flipped: true,
      judgeCostUsd,
    }
  }

  return {
    caseId,
    winner: first.winner,
    margin:
      MARGIN_RANK[first.margin] <= MARGIN_RANK[second.margin]
        ? first.margin
        : second.margin,
    decidingCriterion: first.decidingCriterion,
    rationale: first.rationale,
    flipped: false,
    judgeCostUsd,
  }
}

export const makeClient = () => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. In CI it comes from repo secrets; locally, export it before running.',
    )
  }
  return new Anthropic({ apiKey })
}
