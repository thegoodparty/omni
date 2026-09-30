// Prints one rendered report from the wave-0 fixtures. Scratch only.
import { createRng } from '../../packages/gp-api/src/chats/evals/judge/bootstrap'
import { DEFAULT_JUDGE_CONFIG } from '../../packages/gp-api/src/chats/evals/judge/config'
import {
  CHAT_PAIR,
  TOOL_ERROR_PAIR,
} from '../../packages/gp-api/src/chats/evals/judge/fixtures/records'
import { judgeAll } from '../../packages/gp-api/src/chats/evals/judge/judge'
import { normalizeAgent } from '../../packages/gp-api/src/chats/evals/judge/normalize'
import { renderReport } from '../../packages/gp-api/src/chats/evals/judge/report'
import { scoreAgent } from '../../packages/gp-api/src/chats/evals/judge/score'
import type { RunRecord } from '../../packages/gp-api/src/chats/evals/judge/record'
import type { JsonJudgeModel } from '../../packages/gp-api/src/chats/general/ordinance-flow/evals/coldJudge'

const [BASE, CANDIDATE] = CHAT_PAIR
const SHORT = 'Three priorities are on file.'
const LONG =
  'Three priorities are on file, housing has been open longest, and two ' +
  'have no target date.'

const records: RunRecord[] = Array.from({ length: 22 }, (_, i) => i).flatMap(
  (i) => [
    {
      ...BASE,
      caseId: `cos-case-${i}`,
      runId: `run_base_${i}`,
      output: { kind: 'text', value: SHORT },
    },
    {
      ...CANDIDATE,
      caseId: `cos-case-${i}`,
      runId: `run_cand_${i}`,
      output: { kind: 'text', value: LONG },
    },
  ],
)

const infraPair: RunRecord[] = [
  { ...BASE, caseId: 'cos-timeout', runId: 'run_base_timeout' },
  {
    ...CANDIDATE,
    caseId: 'cos-timeout',
    runId: 'run_cand_timeout',
    status: 'infraError',
    output: null,
  },
]

const llm: JsonJudgeModel = {
  jsonCompletion: async (options) => {
    const user = options.messages[1]?.content ?? ''
    const xBlock = user.slice(
      user.indexOf('<run id="X"'),
      user.indexOf('<run id="Y"'),
    )
    const verdict = xBlock.includes(LONG) ? 'X' : 'Y'
    const dimension = {
      reasoning: 'the fuller answer covers more of the question',
      evidence: [{ loc: `${verdict}.final`, quote: LONG, note: 'coverage' }],
      verdict,
      magnitude: 'clear',
    }
    return {
      object: options.schema.parse({
        rubric_version: 'uj-rubric-0.2',
        shared_observations: 'both arms answered the same question',
        dimensions: Object.fromEntries(
          DEFAULT_JUDGE_CONFIG.dimensions.map((d) => [d, dimension]),
        ),
        overall: dimension,
        flags: [],
        absolute_floor: { X_acceptable: 'yes', Y_acceptable: 'yes', note: '' },
      }),
      tokens: 0,
      model: 'fake',
    }
  },
}

const main = async () => {
  const normalized = normalizeAgent(
    [...records, ...TOOL_ERROR_PAIR, ...infraPair],
    createRng(42),
  )
  const judgments = await judgeAll(llm, normalized.judgeable)
  const score = scoreAgent({ normalized, judgments })
  console.log(renderReport({ agents: [score] }))
}

void main()
