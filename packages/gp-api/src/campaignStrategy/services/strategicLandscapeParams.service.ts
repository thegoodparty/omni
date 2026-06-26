import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { Campaign } from '../../generated/prisma'
import { z } from 'zod'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { getUserFullName } from '@/users/util/users.util'
import { RacesService } from '@/elections/services/races.service'
import { CampaignStoryService } from '@/campaignStory/services/campaignStory.service'
import { AgentJobContracts } from '@/generated/agent-job-contracts'
import { ElectionApiService } from './electionApi.service'

// Both CAP experiments share one input contract.
type StrategicLandscapeInput = AgentJobContracts['opposition_research']['Input']
type PrimaryContext =
  StrategicLandscapeInput['campaign_primary_strategy_context']
type Candidate =
  StrategicLandscapeInput['campaign_strategy_context']['candidates'][number]

// The PMF Engine rejects dispatch params over 6000 bytes (it serializes them
// the spaced way Postgres jsonb / Python json.dumps do). A filed primary roster
// of 40-60 candidates pushes the payload past that, failing every opposition /
// opportunities run for that campaign. Budget against compact JSON.stringify
// well under 6000 so the agent's wider, spaced count still fits.
const MAX_PARAMS_BYTES = 5000

const paramsBytes = (params: StrategicLandscapeInput): number =>
  Buffer.byteLength(JSON.stringify(params))

// Drop the two candidate fields the agent never reasons over: gp_candidate_id
// is a trace id, and website_url is a hint it can rediscover via web search.
// Shedding these first keeps the most roster within the byte budget.
const slimCandidate = (c: Candidate): Candidate => ({
  email: c.email,
  first_name: c.first_name,
  last_name: c.last_name,
  full_name: c.full_name,
  party: c.party,
  is_incumbent: c.is_incumbent,
})

// 0 = the user's own row (kept so the agent can still mark is_user and exclude
// the candidate from their own opponents), 1 = incumbents (the real opponents),
// 2 = the long tail dropped first when capping.
const candidateRank = (c: Candidate, userEmail: string): number => {
  if (userEmail) {
    const email = c.email?.toLowerCase().trim()
    if (email && email === userEmail.toLowerCase().trim()) return 0
  }
  return c.is_incumbent ? 1 : 2
}

// Keep the highest-ranked candidates whose serialized bytes fit the budget.
// Candidates are sorted by rank first, so the user's own row (rank 0) and
// incumbents (rank 1) are offered to the budget before the long tail and
// survive whenever the cap permits — the cap is the harder invariant, so a
// budget too small for even those rows drops them rather than busting it (that
// only arises when the fixed payload alone nears the cap; see the story-drop
// path). Within a rank, skip (don't stop on) an over-budget candidate so one
// long name can't starve the smaller ones behind it.
const capRoster = (
  candidates: Candidate[],
  userEmail: string,
  budgetBytes: number,
): Candidate[] => {
  const ranked = [...candidates].sort(
    (a, b) => candidateRank(a, userEmail) - candidateRank(b, userEmail),
  )
  const kept: Candidate[] = []
  let used = 2 // the enclosing '[]'
  for (const c of ranked) {
    const comma = kept.length > 0 ? 1 : 0 // none before the first element
    const size = Buffer.byteLength(JSON.stringify(c)) + comma
    if (used + size > budgetBytes) continue
    kept.push(c)
    used += size
  }
  return kept
}

// Empty both candidate arrays; the rest is the fixed payload the rosters share
// a byte budget against.
const withEmptyRosters = (
  input: StrategicLandscapeInput,
): StrategicLandscapeInput => ({
  ...input,
  campaign_strategy_context: {
    ...input.campaign_strategy_context,
    candidates: [],
  },
  campaign_primary_strategy_context: input.campaign_primary_strategy_context
    ? { ...input.campaign_primary_strategy_context, candidates: [] }
    : input.campaign_primary_strategy_context,
})

// Cap the primary roster first against the shared pool: for a race with a
// primary it is the real filed field (the documented overflow cause), while the
// general roster is the provisional, often-empty seed list. General takes
// whatever budget the primary leaves.
const withCappedRosters = (
  input: StrategicLandscapeInput,
  budgetBytes: number,
  userEmail: string,
): StrategicLandscapeInput => {
  const keptPrimary = input.campaign_primary_strategy_context
    ? capRoster(
        input.campaign_primary_strategy_context.candidates,
        userEmail,
        budgetBytes,
      )
    : []
  const keptGeneral = capRoster(
    input.campaign_strategy_context.candidates,
    userEmail,
    budgetBytes - Buffer.byteLength(JSON.stringify(keptPrimary)),
  )
  return {
    ...input,
    campaign_strategy_context: {
      ...input.campaign_strategy_context,
      candidates: keptGeneral,
    },
    campaign_primary_strategy_context: input.campaign_primary_strategy_context
      ? {
          ...input.campaign_primary_strategy_context,
          candidates: keptPrimary,
        }
      : input.campaign_primary_strategy_context,
  }
}

// Shrink an over-budget payload in graceful steps (slim candidate fields, cap
// rosters by byte budget, then drop the story as a last resort); a payload
// already under the cap (the common case) is returned untouched. candidate_count
// is left at the true race size even when the roster is capped.
const fitToBudget = (
  params: StrategicLandscapeInput,
  userEmail: string,
): StrategicLandscapeInput => {
  if (paramsBytes(params) <= MAX_PARAMS_BYTES) return params

  const general = params.campaign_strategy_context
  const primary = params.campaign_primary_strategy_context
  const slimmed: StrategicLandscapeInput = {
    ...params,
    campaign_strategy_context: {
      ...general,
      candidates: general.candidates.map(slimCandidate),
    },
    campaign_primary_strategy_context: primary
      ? { ...primary, candidates: primary.candidates.map(slimCandidate) }
      : primary,
  }
  if (paramsBytes(slimmed) <= MAX_PARAMS_BYTES) return slimmed

  // Cap the rosters against the headroom left once everything else (story
  // included) is accounted for, keeping the story alongside as many candidates
  // as fit.
  const budget = MAX_PARAMS_BYTES - paramsBytes(withEmptyRosters(slimmed))
  const capped = withCappedRosters(slimmed, budget, userEmail)
  if (paramsBytes(capped) <= MAX_PARAMS_BYTES) return capped

  // Last resort: a campaign_story large enough to blow the budget on its own
  // (its fields cap at 10k chars each) would otherwise starve the rosters to
  // nothing. Drop it and re-cap against the freed budget so the roster — the
  // agent's primary reasoning surface — is preserved.
  const storyless: StrategicLandscapeInput = {
    ...slimmed,
    campaign_story: undefined,
  }
  const storylessBudget =
    MAX_PARAMS_BYTES - paramsBytes(withEmptyRosters(storyless))
  // Pathological: even the fixed, roster-empty, story-less payload exceeds the
  // cap (would only happen if the external race fields were themselves huge).
  // Nothing left to trim — return the smallest payload as best-effort.
  if (storylessBudget <= 2) return withEmptyRosters(storyless)
  return withCappedRosters(storyless, storylessBudget, userEmail)
}

const PartySchema = z
  .object({ party: z.string().optional(), otherParty: z.string().optional() })
  .partial()

// Send the raw party label + otherParty separately; the experiment treats
// 'Other' as a pointer to other_party. Don't collapse them here.
const resolveParty = (
  details: Campaign['details'],
): { party: string | null; otherParty: string | null } => {
  const parsed = PartySchema.safeParse(details)
  if (!parsed.success) return { party: null, otherParty: null }
  return {
    party: parsed.data.party ?? null,
    otherParty: parsed.data.otherParty ?? null,
  }
}

@Injectable()
export class StrategicLandscapeParamsService {
  constructor(
    private readonly electionApi: ElectionApiService,
    private readonly races: RacesService,
    private readonly campaignStory: CampaignStoryService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(StrategicLandscapeParamsService.name)
  }

  async build(
    campaign: CampaignWith<'user'>,
    brHashId: string,
  ): Promise<StrategicLandscapeInput> {
    const [context, primary, campaignStory] = await Promise.all([
      this.electionApi.getStrategyContext(brHashId),
      this.buildPrimaryContext(brHashId),
      this.loadStory(campaign.id),
    ])
    const { user } = campaign
    const { party, otherParty } = resolveParty(campaign.details)
    return fitToBudget(
      {
        race_id: brHashId,
        user_email: user?.email ?? '',
        user_first_name: user?.firstName ?? null,
        user_last_name: user?.lastName ?? null,
        user_full_name: user ? getUserFullName(user) : '',
        user_party_affiliation: party,
        other_party: otherParty,
        campaign_strategy_context: context,
        campaign_primary_strategy_context: primary,
        campaign_story: campaignStory,
      },
      user?.email ?? '',
    )
  }

  // The story is optional enrichment, so a transient read failure must not
  // abort the (expensive) strategy build — log it and degrade to undefined.
  private async loadStory(
    campaignId: number,
  ): Promise<StrategicLandscapeInput['campaign_story']> {
    try {
      return await this.campaignStory.getForCampaign(campaignId)
    } catch (error) {
      this.logger.warn(
        { error, campaignId },
        'Failed to load campaign story for strategy params; proceeding without it',
      )
      return undefined
    }
  }

  private async buildPrimaryContext(brHashId: string): Promise<PrimaryContext> {
    const primaryRaceId = await this.races.getPrimaryRaceId(brHashId)
    if (!primaryRaceId) return null
    const ctx = await this.electionApi.getStrategyContext(primaryRaceId)
    return { candidate_count: ctx.candidate_count, candidates: ctx.candidates }
  }
}
