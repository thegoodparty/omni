import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import {
  encodePrecinctPair,
  type IdOverrides,
  type RecommendedListChannel,
  type RecommendedListIntent,
  type RecommendedListVariant,
} from '@goodparty_org/contracts'
import { ContactsService } from '@/contacts/services/contacts.service'
import { CampaignIdeologyService } from '@/campaignIdeology/services/campaignIdeology.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { VoterRecommendedListsService } from '@/peopleDb/services/voterRecommendedLists.service'
import {
  filtersSchema,
  type FilterData,
} from '@/peopleDb/schemas/filters.schema'
import type { DbxDistrict } from '@/peopleDb/databricks/databricksVoterSql.util'
import type { VoterFilterBase } from '@/shared/schemas/voterFilterBase.schema'
import type { Organization } from '../../generated/prisma'
import { fillCopy, variantsForIntent } from '../recommendedLists.registry'
import { buildVariantFilter } from '../recommendedListsUniverse.util'
import { findEquivalentFilter } from '../recommendedListsDedupe.util'
import {
  DOOR_TARGET_VOTERS,
  DOOR_WIDENING_FACTOR,
  MAX_DOOR_WIDENING_PASSES,
  RECOMMENDED_LIST_SIZE_FLOOR,
} from '../recommendedLists.consts'

export type Recommendation = {
  variant: RecommendedListVariant
  filter: VoterFilterBase
  count: number
  // Absent when the district total could not be read. `estimatedCost` is
  // absent entirely: its per-channel unit price has no source yet, and a
  // guessed dollar figure on a candidate's screen is worse than no figure.
  districtShare?: number
  copy: { title: string; criteriaSummary: string }
  existingFilterId: number | null
}

type VariantDraft = {
  variant: RecommendedListVariant
  filter: VoterFilterBase
}

type SizedDraft = VariantDraft & { count: number }

type ResolvedScope = {
  filters: FilterData
  idOverrides?: IdOverrides
}

@Injectable()
export class RecommendedListsService {
  constructor(
    private readonly contacts: ContactsService,
    private readonly ideology: CampaignIdeologyService,
    private readonly voterFileFilters: VoterFileFilterService,
    private readonly reads: VoterRecommendedListsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RecommendedListsService.name)
  }

  async recommend(
    organization: Organization,
    campaignId: number,
    channel: RecommendedListChannel,
    intent: RecommendedListIntent | null,
  ): Promise<Recommendation[]> {
    // `custom` and social's `issue_update` map to no intent at all.
    if (!intent) return []

    // Win only. Without this an `eo-` organization would get a partial
    // answer rather than a refusal: affinity and ideology are Win-gated
    // inside the shared filter resolution, so those variants would 400 and
    // be dropped one by one as failures while the rest still rendered.
    if (organization.slug.startsWith('eo-')) return []

    const [districtId, ideologyBucket, savedFilters] = await Promise.all([
      this.contacts.resolveEligibleDistrictId(organization),
      // Never throws: a classification failure returns null, which hides
      // the ideology variants. That is the common case, not the edge one.
      this.ideology.bucketForCampaign(campaignId),
      // Loaded with `activityConditions` included, which the dedupe
      // comparison reads straight off the row. Rows without the relation
      // all look condition-free, so two lists differing only in their
      // conditions would compare equal and the candidate would be handed
      // someone else's audience.
      this.voterFileFilters.findByOrganizationSlug(organization.slug),
    ])

    const district = await this.reads.resolveDistrict(districtId)

    // A null filter is an ideology variant with no bucket to match
    // against; that null is how those variants hide.
    const drafts = variantsForIntent(intent)
      .map((variant) => ({
        variant,
        filter: buildVariantFilter(variant, channel, ideologyBucket),
      }))
      .filter((draft): draft is VariantDraft => draft.filter !== null)

    // One request is several warehouse aggregates and they decide its
    // latency, so every variant and the district total go out together.
    const [districtTotal, sized] = await Promise.all([
      this.districtTotal(district),
      Promise.all(
        drafts.map((draft) =>
          this.sizeDraft(organization, district, channel, draft),
        ),
      ),
    ])

    // variantsForIntent already returns registry display order and neither
    // the map nor the filter above disturbs it.
    return sized
      .filter((draft): draft is SizedDraft => draft !== null)
      .map(({ variant, filter, count }) => ({
        variant,
        filter,
        count,
        ...(districtTotal ? { districtShare: count / districtTotal } : {}),
        copy: fillCopy(
          variant,
          ideologyBucket ? { bucket: ideologyBucket } : {},
        ),
        existingFilterId: findEquivalentFilter(filter, savedFilters),
      }))
  }

  // The denominator is the mart's own count, not
  // `m_election_api__district.registered_voters`: every numerator here is a
  // mart count, and the two disagree by up to 2.2%.
  private async districtTotal(district: DbxDistrict): Promise<number | null> {
    try {
      const total = await this.reads.districtTotal(district)
      return total > 0 ? total : null
    } catch (error) {
      this.logger.warn(
        { err: error, districtId: district.districtId },
        'District total unavailable; omitting districtShare',
      )
      return null
    }
  }

  private async sizeDraft(
    organization: Organization,
    district: DbxDistrict,
    channel: RecommendedListChannel,
    draft: VariantDraft,
  ): Promise<SizedDraft | null> {
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
        return await this.sizeDoorDraft(district, draft, scope)
      }

      const count = await this.reads.countForFilter(
        district,
        scope.filters,
        scope.idOverrides,
      )
      return count >= RECOMMENDED_LIST_SIZE_FLOOR ? { ...draft, count } : null
    } catch (error) {
      // One variant's failure costs that card, not the response. The
      // aggregates are independent and the surviving ones are still worth
      // showing, so this does not rethrow.
      this.logger.warn(
        { err: error, variant: draft.variant, channel },
        'Recommended list variant could not be sized',
      )
      return null
    }
  }

  // Door knocking is the one channel whose narrowing can be relaxed, so it
  // is the one channel with a rescue path for an under-floor list. Three
  // outcomes have to stay distinguishable:
  //
  //   1. the precinct-restricted list clears the floor -- keep it, with the
  //      precincts attached;
  //   2. the ranking has nothing left to give -- drop the precinct
  //      restriction and size the district-wide list, which also picks up
  //      the voters with no precinct on file that the ranking excludes;
  //   3. even that is under the floor -- omit the variant.
  //
  // `reachedTarget` is what separates a ranking worth widening from one
  // that is spent: false covers both "the district ran out of precincts"
  // and "MAX_RANKED_PRECINCTS was consumed first", and in either case
  // asking for a bigger door target returns the same set forever.
  //
  // With the shipped constants the retry never runs, because a ranking that
  // stopped short of 10,000 voters is already exhausted and so cannot be
  // holding back the 250 the floor wants. It is written as a loop anyway:
  // both numbers are eval outputs declared tunable, and a floor raised
  // above the door target would need it.
  private async sizeDoorDraft(
    district: DbxDistrict,
    draft: VariantDraft,
    scope: ResolvedScope,
  ): Promise<SizedDraft | null> {
    let doorTarget = DOOR_TARGET_VOTERS

    for (let pass = 0; pass < MAX_DOOR_WIDENING_PASSES; pass++) {
      const ranked = await this.reads.rankPrecincts(
        district,
        scope.filters,
        doorTarget,
        scope.idOverrides,
      )
      if (ranked.totalVoters >= RECOMMENDED_LIST_SIZE_FLOOR) {
        return {
          variant: draft.variant,
          filter: {
            ...draft.filter,
            precincts: ranked.precincts.map(({ county, precinct }) =>
              encodePrecinctPair(county, precinct),
            ),
          },
          // The ranking counts the variant's own matching voters per
          // precinct, so its total already IS the count of the restricted
          // list. Issuing a second count for the same population would buy
          // a number that can only disagree with this one.
          count: ranked.totalVoters,
        }
      }
      if (!ranked.reachedTarget) break
      doorTarget *= DOOR_WIDENING_FACTOR
    }

    const districtWide = await this.reads.countForFilter(
      district,
      scope.filters,
      scope.idOverrides,
    )
    return districtWide >= RECOMMENDED_LIST_SIZE_FLOOR
      ? { ...draft, count: districtWide }
      : null
  }
}
