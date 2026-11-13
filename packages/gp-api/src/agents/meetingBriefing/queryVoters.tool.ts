import { z } from 'zod'
import type { AgentTool } from '@/agents/tools/tool'
import { ConstituentSentimentService } from './constituentSentiment.service'

const input = z.object({
  state: z.string().regex(/^[A-Z]{2}$/),
  columns: z
    .array(z.string().regex(/^hs_[a-z0-9_]+$/))
    .min(1)
    .describe('Catalog columns to average, one per featured or queued item.'),
  district: z
    .object({
      type: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
      name: z.string().min(1),
    })
    .optional()
    .describe(
      'PARAMS.l2DistrictType and PARAMS.l2DistrictName, when PARAMS has them.',
    ),
})

export const queryVoters: AgentTool<typeof input> = {
  name: 'queryVoters',
  description:
    "Average GoodParty.org's modeled constituent sentiment scores (0-100, within-state percentile ranks) for active constituents in the official's district, or state-wide when the district does not resolve. Returns the mean of each column, the number of constituents modeled, the scope used and the SQL it ran. Aggregates only; columns must come from the briefing catalog.",
  input,
  execute: async (request, ctx) =>
    ctx.moduleRef
      .get(ConstituentSentimentService, { strict: false })
      .meanScores(request),
}
