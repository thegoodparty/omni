import { BadRequestException, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import {
  encodePrecinctPair,
  type IdOverrides,
  type RecommendedListChannel,
  type RecommendedListIntent,
  type RecommendedListVariant,
} from '@goodparty_org/contracts'
import { ContactsService } from '@/contacts/services/contacts.service'
import { CampaignIdeologyService } from '@/campaignIdeology/services/campaignIdeology.service'
import { ElectionApiService } from '@/campaignStrategy/services/electionApi.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { VoterRecommendedListsService } from '@/peopleDb/services/voterRecommendedLists.service'
import {
  filtersSchema,
  type FilterData,
} from '@/peopleDb/schemas/filters.schema'
import type { DbxDistrict } from '@/peopleDb/databricks/databricksVoterSql.util'
import { calcRobocallAmountInCents } from '@/shared/util/robocallPricing.util'
import { calcTextAmountInCents } from '@/shared/util/textPricing.util'
import type { VoterFilterBase } from '@/shared/schemas/voterFilterBase.schema'
import type { Campaign, Organization } from '../../generated/prisma'
import {
  fillCopy,
  variantsForIntent,
  RECOMMENDED_LISTS_REGISTRY,
} from '../recommendedLists.registry'
import { buildVariantFilter } from '../recommendedListsUniverse.util'
import { findEquivalentFilter } from '../recommendedListsDedupe.util'
import { VOTE_GOAL_FLOOR_SHARE } from '../recommendedLists.consts'

export type Recommendation = {
  variant: RecommendedListVariant
  filter: VoterFilterBase
  count: number
  // Both absent rather than null when they don't apply: the share when the
  // race's vote goal could not be resolved, the cost on the two channels
  // that have no per-contact price at all.
  voteGoalShare?: number
  estimatedCostCents?: number
  copy: { title: string; criteriaSummary: string }
  existingFilterId: number | null
}

type VariantDraft = {
  variant: RecommendedListVariant
  filter: VoterFilterBase
}

type SizedDraft = VariantDraft & { count: number }

// A variant that could not be sized at all, kept apart from the `null` a
// variant that was sized and did not qualify returns. Collapsing the two is
// how a warehouse outage comes to read as "nothing qualifies".
type SizeFailure = { error: Error }

type SizeOutcome = SizedDraft | SizeFailure | null

const isSized = (outcome: SizeOutcome): outcome is SizedDraft =>
  outcome !== null && !('error' in outcome)

type ResolvedScope = {
  filters: FilterData
  idOverrides?: IdOverrides
}

// Campaign.details is Prisma JSON, so its shadow type can't be trusted at
// runtime. `.catch(null)` matters as much as the shape: without it one
// off-shape value elsewhere in details fails the whole parse and a perfectly
// good raceId reads as absent, which is the bug that bit
// campaignStrategy.service.ts twice.
const CampaignRaceSchema = z.object({
  raceId: z.string().nullable().optional().catch(null),
})

// No floor at all, so any non-empty list qualifies.
const NO_FLOOR = 0

// What a variant's contactable count has to clear, and the three things that
// exempt it from clearing anything. A flat sequence of exemptions rather
// than one nested condition because they sit on three unrelated axes --
// channel, variant family, and whether the race even has a resolved vote
// goal -- and which one applied is exactly what a reader is here to work out.
const sizeFloor = (
  channel: RecommendedListChannel,
  variant: RecommendedListVariant,
  votesNeededToWin: number | null,
): number => {
  // Three precincts by construction (DOOR_PRECINCT_COUNT), so a door list
  // is sized by precinct size and not by the race. Judging it against a
  // whole race's vote goal would suppress nearly every one.
  if (channel === 'doorKnocking') return NO_FLOOR
  // Always offered beside a larger recommendation for the same intent, so a
  // small supporter list is additive rather than the candidate's only
  // option.
  if (RECOMMENDED_LISTS_REGISTRY[variant].supporterBased) return NO_FLOOR
  // Nothing to take a share of. The recommendation still ships; it is
  // `voteGoalShare` that goes missing.
  if (votesNeededToWin === null) return NO_FLOOR
  return votesNeededToWin * VOTE_GOAL_FLOOR_SHARE
}

// A count of zero is dropped whatever the floor says, the two exempt
// families included -- a card offering nobody is worse than no card. It is
// not covered by the `resolved.empty` short-circuit below either: that only
// catches a support status that resolved to no people at all, while a
// campaign with real supporters can still count zero once the channel's
// contactability filter is applied.
const qualifies = (
  count: number,
  channel: RecommendedListChannel,
  variant: RecommendedListVariant,
  votesNeededToWin: number | null,
): boolean =>
  count > 0 && count >= sizeFloor(channel, variant, votesNeededToWin)

// Per-contact only, and only on the two paid channels.
//
// Robocall's is the calls portion alone: the $2 caller-ID number fee is real
// but is charged once per run rather than per contact, and no pre-purchase
// screen puts it in an estimate either (RobocallReviewStep prices
// reachCount x pricePerContact), so folding it in here would make this card
// the one surface that disagrees with checkout.
//
// Phone banking and door knocking are volunteer-run and map to null, not to
// a zero-cost function, so the field is omitted rather than rendering "$0"
// -- which reads as "free" where the truth is "not applicable".
const COST_IN_CENTS: Record<
  RecommendedListChannel,
  ((count: number) => number) | null
> = {
  sms: calcTextAmountInCents,
  robocall: calcRobocallAmountInCents,
  phoneBanking: null,
  doorKnocking: null,
}

@Injectable()
export class RecommendedListsService {
  constructor(
    private readonly contacts: ContactsService,
    private readonly ideology: CampaignIdeologyService,
    private readonly voterFileFilters: VoterFileFilterService,
    private readonly reads: VoterRecommendedListsService,
    private readonly electionApi: ElectionApiService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RecommendedListsService.name)
  }

  async recommend(
    organization: Organization,
    campaign: Campaign,
    channel: RecommendedListChannel,
    intent: RecommendedListIntent | null,
  ): Promise<Recommendation[]> {
    // `custom` and social's `issue_update` map to no intent at all.
    if (!intent) return []

    // Win only, and a refusal rather than an empty answer: the endpoint
    // gate is the primary one, and a backstop that returned [] would hand
    // an elected-office organization an empty state instead of a 4xx if
    // that gate were ever missed or reordered. Without any gate here the
    // answer would be worse still — partial — because only the affinity
    // and ideology families are Win-gated inside the shared filter
    // resolution, so the rest of the intent's variants would render.
    if (organization.slug.startsWith('eo-')) {
      throw new BadRequestException(
        'Recommended lists are not available for this organization',
      )
    }

    const variants = variantsForIntent(intent)
    // `introduce` has no ideology variant, so classifying its campaign is an
    // LLM call whose only possible consumer is absent. Gated on the registry
    // rather than on the intent name so a variant added to any intent picks
    // the call back up on its own.
    const needsIdeology = variants.some(
      (variant) => RECOMMENDED_LISTS_REGISTRY[variant].requiresIdeologyBucket,
    )

    const [districtId, ideologyBucket, savedFilters, votesNeededToWin] =
      await Promise.all([
        this.contacts.resolveEligibleDistrictId(organization),
        // Never throws: a classification failure returns null, which hides
        // the ideology variants. That is the common case, not the edge one.
        needsIdeology ? this.ideology.bucketForCampaign(campaign.id) : null,
        // Loaded with `activityConditions` included, which the dedupe
        // comparison reads straight off the row. Rows without the relation
        // all look condition-free, so two lists differing only in their
        // conditions would compare equal and the candidate would be handed
        // someone else's audience.
        this.voterFileFilters.findByOrganizationSlug(organization.slug),
        // Once per request, and inside this fan-out rather than ahead of it:
        // it gates the size floor so it has to land before the counts, but
        // it is an election-api round-trip and nothing else here waits on
        // it.
        this.votesNeededToWin(campaign),
      ])

    const district = await this.reads.resolveDistrict(districtId)

    // A null filter is an ideology variant with no bucket to match
    // against; that null is how those variants hide.
    const drafts = variants
      .map((variant) => ({
        variant,
        filter: buildVariantFilter(variant, channel, ideologyBucket),
      }))
      .filter((draft): draft is VariantDraft => draft.filter !== null)

    // One request is several warehouse aggregates and they decide its
    // latency, so every variant goes out together.
    const sized = await Promise.all(
      drafts.map((draft) =>
        this.sizeDraft(
          organization,
          district,
          channel,
          draft,
          votesNeededToWin,
        ),
      ),
    )

    // Nothing surviving is an outage, not an empty result set. Returning []
    // here would tell a candidate they have no recommendations while the
    // warehouse is down, with a warn line as the only trace. The first
    // failure already carries the peopleDb layer's own status — 502 for an
    // unavailable warehouse, 504 for a timeout — so it is rethrown rather
    // than re-coded into a third status for the same condition.
    //
    // The condition is "no draft succeeded", not "every draft failed". Those
    // differ whenever a variant returned null from `resolved.empty` — a
    // Postgres answer that an outage does not touch — and three of the five
    // intents have such a variant, so requiring equality left `event`,
    // `earlyVote` and `electionDay` returning [] mid-outage for any campaign
    // with no logged support answers, which is most of them. A genuinely
    // all-too-small result still returns [], because it has no failure.
    const firstFailure = sized.find(
      (outcome): outcome is SizeFailure =>
        outcome !== null && !isSized(outcome),
    )
    if (firstFailure && !sized.some(isSized)) throw firstFailure.error

    const costInCents = COST_IN_CENTS[channel]

    // variantsForIntent already returns registry display order and neither
    // the map nor the filter above disturbs it.
    return sized.filter(isSized).map(({ variant, filter, count }) => ({
      variant,
      filter,
      count,
      ...(votesNeededToWin ? { voteGoalShare: count / votesNeededToWin } : {}),
      ...(costInCents ? { estimatedCostCents: costInCents(count) } : {}),
      copy: fillCopy(variant, ideologyBucket ? { bucket: ideologyBucket } : {}),
      existingFilterId: findEquivalentFilter(filter, savedFilters),
    }))
  }

  // The race's vote goal, and null for every way it can fail to resolve — no
  // raceId on the campaign, no Race row in election-api, an election-api
  // outage, or a non-positive number. Null is a supported outcome, not an
  // error: it drops `voteGoalShare` from the response and exempts the
  // variants from the size floor, so a race we can't price still gets
  // recommendations.
  //
  // `win_number_effective` ASSUMES A SINGLE SEAT, so an at-large or
  // multi-seat race overstates it and the floor is correspondingly more
  // permissive there. Known and accepted — see
  // docs/features/recommended-lists.md.
  private async votesNeededToWin(campaign: Campaign): Promise<number | null> {
    const parsed = CampaignRaceSchema.safeParse(campaign.details)
    const raceId = parsed.success ? (parsed.data.raceId ?? '').trim() : ''
    if (raceId.length === 0) return null

    try {
      const { winNumberEffective } =
        await this.electionApi.getRaceContext(raceId)
      return winNumberEffective && winNumberEffective > 0
        ? winNumberEffective
        : null
    } catch (error) {
      this.logger.warn(
        { err: error, campaignId: campaign.id, raceId },
        'Vote goal unavailable; omitting voteGoalShare and its size floor',
      )
      return null
    }
  }

  private async sizeDraft(
    organization: Organization,
    district: DbxDistrict,
    channel: RecommendedListChannel,
    draft: VariantDraft,
    votesNeededToWin: number | null,
  ): Promise<SizeOutcome> {
    try {
      // The same resolution a saved list gets before it is queried.
      // `convertVoterFileFilterToFilters` alone drops support status, so a
      // count without this would size six of the thirteen universes as if
      // they had no support-status predicate at all.
      const resolved = await this.contacts.resolveSavedFilterForQuery(
        organization,
        draft.filter,
      )
      // The support-status variants resolve to nobody until a campaign has
      // logged some outreach.
      if (resolved.empty) return null

      const scope: ResolvedScope = {
        filters: filtersSchema.parse(resolved.filters),
        idOverrides: resolved.idOverrides,
      }

      if (channel === 'doorKnocking') {
        // The ranking's own total already IS the count of the restricted
        // list, so a second count for the same population would only buy a
        // number that can disagree with this one.
        const ranked = await this.reads.rankPrecincts(
          district,
          scope.filters,
          scope.idOverrides,
        )
        if (
          !qualifies(
            ranked.totalVoters,
            channel,
            draft.variant,
            votesNeededToWin,
          )
        ) {
          return null
        }
        return {
          variant: draft.variant,
          filter: {
            ...draft.filter,
            precincts: ranked.precincts.map(({ county, precinct }) =>
              encodePrecinctPair(county, precinct),
            ),
          },
          count: ranked.totalVoters,
        }
      }

      const count = await this.reads.countForFilter(
        district,
        scope.filters,
        scope.idOverrides,
      )
      return qualifies(count, channel, draft.variant, votesNeededToWin)
        ? { ...draft, count }
        : null
    } catch (error) {
      // One variant's failure costs that card, not the response — the
      // aggregates are independent and the survivors are still worth
      // showing. It returns the failure rather than a bare null so the
      // caller can still tell "could not size" from "did not qualify" and
      // refuse when every draft failed.
      this.logger.warn(
        { err: error, variant: draft.variant, channel },
        'Recommended list variant could not be sized',
      )
      return {
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
  }
}
