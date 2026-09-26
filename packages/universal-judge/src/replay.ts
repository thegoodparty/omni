/**
 * Judge outputs that already exist, instead of producing new ones.
 *
 * Producing outputs is the expensive half; judging them is cents. Once a pair of
 * runs exists, re-judging it should be free, and it is the only honest way to
 * iterate on a rubric: change the criteria, re-judge the same outputs, and any
 * difference is the rubric rather than the weather.
 *
 * It is also how the judging half gets exercised without dispatching anything —
 * a replay file is a complete, self-contained comparison.
 */

import type Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { judgePair, loadRubric } from './pairwise.js'
import type { AgentResult, CaseVerdict, RunOutcome } from './types.js'

const ReplaySchema = z.object({
  agent: z.string(),
  pairs: z
    .array(
      z.object({
        caseId: z.string(),
        input: z.unknown().default({}),
        baseline: z.unknown(),
        candidate: z.unknown(),
        baselineCostUsd: z.number().optional(),
        candidateCostUsd: z.number().optional(),
        baselineDurationSeconds: z.number().optional(),
        candidateDurationSeconds: z.number().optional(),
      }),
    )
    .min(1),
})

export type ReplayFile = z.infer<typeof ReplaySchema>

export const loadReplay = (path: string): ReplayFile =>
  ReplaySchema.parse(JSON.parse(readFileSync(path, 'utf8')))

export const runReplay = async (args: {
  replay: ReplayFile
  client: Anthropic
  judgeModel?: string
  log?: (message: string) => void
}): Promise<AgentResult> => {
  const log = args.log ?? (() => {})
  const rubric = loadRubric(args.replay.agent)
  const verdicts: CaseVerdict[] = []
  const runs: RunOutcome[] = []

  for (const pair of args.replay.pairs) {
    runs.push(
      {
        caseId: pair.caseId,
        variant: 'baseline',
        status: 'ok',
        output: pair.baseline,
        costUsd: pair.baselineCostUsd,
        durationSeconds: pair.baselineDurationSeconds,
      },
      {
        caseId: pair.caseId,
        variant: 'candidate',
        status: 'ok',
        output: pair.candidate,
        costUsd: pair.candidateCostUsd,
        durationSeconds: pair.candidateDurationSeconds,
      },
    )

    verdicts.push(
      await judgePair({
        caseId: pair.caseId,
        input: pair.input,
        baselineOutput: pair.baseline,
        candidateOutput: pair.candidate,
        agent: args.replay.agent,
        client: args.client,
        model: args.judgeModel,
        rubric,
      }),
    )
    log(`${pair.caseId}: judged`)
  }

  return {
    agent: args.replay.agent,
    verdicts,
    runs,
    notes: ['Replayed from stored outputs — no agent runs were dispatched.'],
  }
}
