import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  MAX_OVERLAP_SAVED_FILTER_SETS,
  FollowUpStatusSchema,
  type FollowUpStatusResponse,
  SupportStatusRollupSchema,
  VoterLikelihoodSchema,
  type ContactStatuses,
  type IdOverrides,
  type ListDetailContactsResponse,
  type PeopleOverlapCountResponse,
  type SupportStatusRollup,
  type UpdateContactStatusInput,
  type VoterLikelihood,
  type PeoplePrecinctsResponse,
  type DoorKnockingEvaluateResponse,
  type GeoJsonPolygon,
  MAX_RESULTS_PER_PAGE,
} from '@goodparty_org/contracts'
import {
  ContactStatusField,
  ContactStatusSource,
  FollowUpStatus,
  Organization,
} from '../../generated/prisma'
import { FastifyReply } from 'fastify'
import { PinoLogger } from 'nestjs-pino'
import { randomUUID } from 'node:crypto'
import type { ZodType } from 'zod'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import { SUPPORT_STATUS_UNKNOWN } from 'src/contactInteraction/contactInteraction.types'
import {
  ActivityConditionResolutionService,
  intersectIdFilterResolutions,
  type IdFilterResolution,
  MAX_RESOLVED_ID_SET_SIZE,
} from 'src/contactInteraction/services/activityConditionResolution.service'
import { ContactInteractionTextService } from 'src/contactInteraction/services/contactInteractionText.service'
import {
  ContactsMadeResolutionService,
  type ContactsMadeBucket,
} from 'src/contactInteraction/services/contactsMadeResolution.service'
import { ContactStatusService } from 'src/contactInteraction/services/contactStatus.service'
import { SupportStatusService } from 'src/contactInteraction/services/supportStatus.service'
import { ElectionsService } from 'src/elections/services/elections.service'
import { OrganizationsService } from 'src/organizations/services/organizations.service'
import { VoterFileDownloadAccessService } from '@/shared/services/voterFileDownloadAccess.service'
import { VoterFileFilterService } from 'src/voters/services/voterFileFilter.service'
import { VoterFileFilterGeoService } from '@/voters/services/voterFileFilterGeo.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { VoterDownloadService } from '@/peopleDb/services/voterDownload.service'
import { VoterDoorKnockingService } from '@/peopleDb/services/voterDoorKnocking.service'
import { StatsService } from '@/peopleDb/services/stats.service'
import { DoorKnockingEvaluateDTO } from '@/peopleDb/schemas/doorKnocking.schema'
import { pointInPolygon, polygonBbox } from '@/shared/util/geo.util'
import type { Bbox } from '@goodparty_org/contracts'
import {
  EXCLUDABLE_VOTER_COLUMNS,
  type ExcludableVoterColumn,
} from '@/peopleDb/voter.select'
import {
  AggregatesDTO,
  DownloadPeopleDTO,
  GetPersonQueryDTO,
  ListPeopleDTO,
  OverlapCountDTO,
  SamplePeopleDTO,
  StatsDTO,
} from '@/peopleDb/schemas/people.schema'
import {
  StatsResponse,
  VOTER_DATA_UNAVAILABLE_ERROR_CODE,
} from '../contacts.types'
import { CountContactsDTO } from '../schemas/countContacts.schema'
import { PolygonPreviewContactsDTO } from '../schemas/polygonPreviewContacts.schema'
import { FilterPointsContactsDTO } from '../schemas/filterPointsContacts.schema'
import type { VoterFilterBase } from '@/shared/schemas/voterFilterBase.schema'
import type { VoterFileFilter } from '../../generated/prisma'
import type { ActivityCondition } from '@/shared/schemas/activityCondition.schema'
import { ListDetailContactsDTO } from '../schemas/listDetailContacts.schema'
import {
  DownloadContactsDTO,
  ListContactsDTO,
} from '../schemas/listContacts.schema'
import { PeopleListResponse, PersonOutput } from '../schemas/person.schema'
import type { SampleContacts } from '../schemas/sampleContacts.schema'
import defaultSegmentToFiltersMap from '../segmentsToFiltersMap.const'
import {
  CONTACTS_MADE_BUCKET_FIELDS,
  convertVoterFileFilterToFilters,
  type FilterObject,
} from '../utils/voterFileFilter.utils'
import {
  FILTER_DIMENSIONS,
  type FilterDimension,
} from '../filterDimensions.catalog'
import { buildPreviewContacts } from '../utils/previewContacts.utils'

// The default, unfiltered view. It (and the district stats) are visible to any
// Win campaign, pro or not. A non-pro candidate sees the real
// district aggregates but a synthetic (fake) people preview — never real voter
// PII (see previewContacts.utils) — before being upsold. Search, custom/named
// segments, and download stay pro-only.
const ALL_CONTACTS_SEGMENT = 'all'

// The pro gate message shared by every filter-resolution path. Exported so
// the assistant's count_contacts tool can recognize the rejection and suggest
// the Pro upgrade without restating the string. Every pro gate throws
// ForbiddenException (403), not BadRequestException: the request is well
// formed and the org simply isn't entitled. That started as an alerting fix —
// the route error-count rules counted 400 and excluded 403, so one free-tier
// user hitting the gate paged the on-call — and the rules now exclude 400 too,
// so the reason to keep it is the plain one: 403 is what "not entitled" means.
// assertProAccess's refusal, which is NOT the filtering one above: the two
// gates word themselves for different features and a caller recognising the
// wrong string silently falls through to its generic branch. Named rather
// than inlined so anything matching on it cannot drift from what throws it.
export const PRO_FEATURE_REQUIRED_MESSAGE =
  'This feature is only available for pro campaigns'

export const PRO_FILTERING_REQUIRED_MESSAGE =
  'Filtering voter data is only available for pro campaigns'

// The bbox query's own ceiling (the contract caps it here), taken whole
// rather than reused from door knocking's 20,000: that number is sized from
// a 150-stop walk route, and a constituent list is not a walk route.
const POLYGON_PREVIEW_MAX_PEOPLE = 50_000

// Everywhere. The district is the boundary for a points read, and the SQL
// scopes to it already — the bbox in that query exists to prefilter for a
// drawn shape, and with no shape to prefilter for, a predicate that excludes
// nothing is the correct one.
const DISTRICT_WIDE_BBOX: Bbox = {
  minLat: -90,
  maxLat: 90,
  minLng: -180,
  maxLng: 180,
}

// Matched to MAX_RESULTS_PER_PAGE on purpose: the saved-list map draws its
// dots through GET /v1/contacts under exactly this ceiling, so a list looks
// the same on the draw step as it does the moment after it is saved. A
// different number here would move dots on screen at save time for no
// reason the holder could see.
const MAP_POINTS_MAX = MAX_RESULTS_PER_PAGE

// The CSV download is a Postgres COPY stream gp-api cannot post-process, so an
// `eo-` org's download drops these columns from the projection instead
// (ENG-10696). Only downloadVoterFilePeople (the separate outreach/task-flow
// audience download) uses this narrow pair; the CRM download excludes the
// wider SERVE_EXCLUDED_DOWNLOAD_COLUMNS set below (ENG-10830). Ethnicity
// joins party here rather than only in the wider set because this endpoint
// is the other way a Serve list leaves as a file, and #1933's rule is about
// the list that reaches someone's hands, not about which route built it.
const SERVE_EXCLUDED_VOTER_FILE_COLUMNS: ExcludableVoterColumn[] = [
  'Parties_Description',
  'EthnicGroups_EthnicGroup1Desc',
]

// The recommended-list dimensions a Serve org may not filter on. Keep in
// step with the `modes: 'win'` marks in filterDimensions.catalog.ts — the
// catalog hides them from the assistant, this rejects them at the routes.
const WIN_ONLY_RECOMMENDED_FILTER_KEYS = [
  'independentAffinity',
  'ideology',
] as const

const RECOMMENDED_FILTER_LABELS: Record<
  (typeof WIN_ONLY_RECOMMENDED_FILTER_KEYS)[number],
  string
> = {
  independentAffinity: 'Independent affinity',
  ideology: 'Ideology',
}

// people-api's Voter_Status vocabulary and the editable voter-likelihood
// vocabulary (ENG-10833) are one-to-one.
const VOTER_LIKELIHOOD_SEED_MAP: Record<
  NonNullable<PersonOutput['voterStatus']>,
  VoterLikelihood
> = {
  Super: 'super',
  Likely: 'likely',
  Unreliable: 'unreliable',
  Unlikely: 'unlikely',
}

const seedVoterLikelihood = (
  voterStatus: PersonOutput['voterStatus'],
): VoterLikelihood =>
  voterStatus ? VOTER_LIKELIHOOD_SEED_MAP[voterStatus] : 'unknown'

// Override-aware Voter Likelihood filtering (ENG-10838). The people-api
// Voter_Status FILTER vocabulary (PEOPLE_FILTER_VALUE_ENUMS.voterStatus) is a
// superset of VOTER_LIKELIHOOD_SEED_MAP's PersonOutput-typed keys — it also
// includes the literal 'Unknown' filter value, which a person's own
// `voterStatus` field never carries (absent voterStatus is null, not the
// string 'Unknown'). Kept as its own map rather than widening
// VOTER_LIKELIHOOD_SEED_MAP's type, since that one is scoped to the narrower
// per-person display path.
const SEED_VOTER_STATUS_TO_LIKELIHOOD: Record<string, VoterLikelihood> = {
  Super: 'super',
  Likely: 'likely',
  Unreliable: 'unreliable',
  Unlikely: 'unlikely',
  Unknown: 'unknown',
}

// The inverse: an override-vocabulary value expands to every seed value that
// displays as that bucket absent an override. One-to-one since Unreliable
// gained its own member.
const VOTER_LIKELIHOOD_TO_SEED_VALUES: Record<VoterLikelihood, string[]> = {
  super: ['Super'],
  likely: ['Likely'],
  unreliable: ['Unreliable'],
  unlikely: ['Unlikely'],
  unknown: ['Unknown'],
}

// `filters.voterStatus`'s op shape is always `{eq: string} | {in: string[]}`
// for this field (convertVoterFileFilterToFilters never emits notIn/gte/is
// for it) — pull the selected seed values out regardless of which shape
// produced them (the audience* booleans or a raw voterStatus array from the
// assistant's crud_saved_filters tool).
const extractVoterStatusSeedValues = (filters: FilterObject): string[] => {
  const op = filters.voterStatus
  if (!op || typeof op === 'boolean') return []
  if ('eq' in op && typeof op.eq === 'string') return [op.eq]
  if ('in' in op && Array.isArray(op.in)) return op.in.map(String)
  return []
}

// ENG-10839: reads the selected contacts-made buckets straight off the raw
// VoterFileFilter/count-DTO booleans — they never reach the converted
// FilterObject (convertVoterFileFilterToFilters's fieldsHandledSeparately
// strips them for dedicated resolution instead of the generic key->filter
// loop), so this reads the same pre-conversion shape resolveBaseFilters and
// segmentToFilters receive.
const extractContactsMadeSelection = (
  filterInput: Partial<VoterFileFilter>,
): Set<ContactsMadeBucket> =>
  new Set(
    CONTACTS_MADE_BUCKET_FIELDS.filter(({ field }) => filterInput[field]).map(
      ({ bucket }) => bucket,
    ),
  )

// Serve (`eo-`) CRM downloads must omit these columns entirely — a blank
// column still reveals the field exists (ENG-10830). Party (completing
// ENG-10696), turnout propensity, and vote history. `EXCLUDABLE_VOTER_COLUMNS`
// already enumerates exactly that set and is type-pinned to real
// `DOWNLOAD_COLUMNS` entries, so this reads it rather than restating it. A
// hand-maintained copy silently omitted every column added to the download
// after ENG-10830 (DATA-2281).
const SERVE_EXCLUDED_DOWNLOAD_COLUMNS: ExcludableVoterColumn[] = [
  ...EXCLUDABLE_VOTER_COLUMNS,
]

// What the shared filter resolution actually consumes: the request DTO, a
// persisted VoterFileFilter row (nullable columns, relation-shaped activity
// conditions), or a spread-merge of the two.
export type ContactsFilterResolutionInput = Partial<
  Omit<VoterFileFilter, 'search'>
> & {
  activityConditions?: ActivityCondition[]
  supportStatus?: SupportStatusRollup[]
  search?: string | null
}

@Injectable()
export class ContactsService {
  constructor(
    private readonly voterFileFilterService: VoterFileFilterService,
    private readonly voterFileFilterGeoService: VoterFileFilterGeoService,
    private readonly elections: ElectionsService,
    private readonly campaigns: CampaignsService,
    private readonly organizations: OrganizationsService,
    private readonly voterFileDownloadAccess: VoterFileDownloadAccessService,
    private readonly supportStatusService: SupportStatusService,
    private readonly contactStatusService: ContactStatusService,
    private readonly contactInteractionTextService: ContactInteractionTextService,
    private readonly activityConditionResolution: ActivityConditionResolutionService,
    private readonly voterQueryService: VoterQueryService,
    private readonly voterDownloadService: VoterDownloadService,
    private readonly voterDoorKnockingService: VoterDoorKnockingService,
    private readonly peopleStatsService: StatsService,
    private readonly contactsMadeResolutionService: ContactsMadeResolutionService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ContactsService.name)
  }

  private hasElectedOfficeAccess(organization: Organization): boolean {
    return organization.slug.startsWith('eo-')
  }

  // The filter vocabulary the AI assistant may describe and validate against,
  // mode-filtered: an `eo-` (Serve) org never sees Win-only dimensions
  // (party, ethnicity), mirroring assertNoPartyFilterForElectedOffice and
  // assertNoEthnicityFilterForElectedOffice on the read side.
  getFilterDimensions(organization: Organization): FilterDimension[] {
    const excludedMode = this.hasElectedOfficeAccess(organization)
      ? 'win'
      : 'serve'
    return FILTER_DIMENSIONS.filter(
      (dimension) => dimension.modes !== excludedMode,
    )
  }

  // Single choke point for the server-enforced Serve party-visibility rule
  // (ENG-10696): findContacts (list + typeahead) and findPerson (detail) both
  // route every people-api row through this before it reaches the response.
  //
  // `ethnicityGroup` rides the same choke point rather than earning its own.
  // Serve may not subset constituents by ethnicity (#1933), and a per-person
  // value on the contact record is the individual-level half of that rule —
  // #1933's partial revert narrowed the rule to Serve but did not soften it
  // there. Two fields, one pass, so a third can never be added to one reader
  // and forgotten in the other.
  private stripWinOnlyFieldsIfElectedOffice(
    organization: Organization,
    person: PersonOutput,
  ): PersonOutput {
    if (!this.hasElectedOfficeAccess(organization)) return person
    const stripped = { ...person }
    delete stripped.politicalParty
    // Nulled where party is deleted, because the two are shaped differently
    // in the contract: `politicalParty` is optional, so absence is
    // expressible, while `ethnicityGroup` is a required nullable key and
    // null IS its absent value. Same result on the wire — no value reaches
    // an `eo-` org — and the Serve readers drop the row rather than printing
    // the null (PersonOverlay, demographicFacts).
    stripped.ethnicityGroup = null
    return stripped
  }

  private stripWinOnlyFieldsFromList(
    organization: Organization,
    response: PeopleListResponse,
  ): PeopleListResponse {
    if (!this.hasElectedOfficeAccess(organization)) return response
    return {
      ...response,
      people: response.people.map((person) =>
        this.stripWinOnlyFieldsIfElectedOffice(organization, person),
      ),
    }
  }

  // Single predicate backing both the throwing assert below and
  // resolveSavedFilterSets' per-set drop (ENG-10840) — one place decides
  // what counts as a party leak for an elected-office organization.
  private hasPartyFilterForElectedOffice(
    organization: Organization,
    filters: FilterObject,
  ): boolean {
    return (
      this.hasElectedOfficeAccess(organization) && 'politicalParty' in filters
    )
  }

  // Rejects a party filter/segment before the people-api call rather than
  // stripping party rows after the fact — list, count, and download all
  // resolve their request into a FilterObject before calling out, so this one
  // check covers all three (ENG-10696).
  private assertNoPartyFilterForElectedOffice(
    organization: Organization,
    filters: FilterObject,
  ): void {
    if (this.hasPartyFilterForElectedOffice(organization, filters)) {
      throw new BadRequestException(
        'Political party filtering is not available for this organization',
      )
    }
  }

  // Win-only, and the exact shape of the party gate above because the key
  // reaches the converted FilterObject the same way. Nobody subsets
  // constituents by ethnicity: the rule went in for both products (#1933)
  // and was narrowed to Serve when Win's half was reverted, so this is now
  // what enforces it rather than the field's absence from the wire. Refused
  // rather than dropped, for the reason the party gate refuses — silently
  // ignoring a dimension returns a WIDER audience than the caller asked for.
  private assertNoEthnicityFilterForElectedOffice(
    organization: Organization,
    filters: FilterObject,
  ): void {
    if (this.hasElectedOfficeAccess(organization) && 'ethnicity' in filters) {
      throw new BadRequestException(
        'Ethnicity filtering is not available for this organization',
      )
    }
  }

  // The recommended-list dimensions are a Win product surface: affinity and
  // ideology both describe how someone votes in a contested election, which
  // has no meaning for an office holder who serves everyone in the district.
  // Gated the same way party is — both keys reach the converted
  // FilterObject, so the key check mirrors the party one exactly. This is a
  // permanent PRODUCT rule, independent of which webapp surfaces render the
  // groups at all. hasAnyPhone is deliberately NOT here —
  // plain contactability, and Serve runs phone banking and robocall too.
  private assertNoRecommendedListFilterForElectedOffice(
    organization: Organization,
    filters: FilterObject,
  ): void {
    if (!this.hasElectedOfficeAccess(organization)) return
    const blocked = WIN_ONLY_RECOMMENDED_FILTER_KEYS.find(
      (key) => key in filters,
    )
    if (blocked) {
      throw new BadRequestException(
        `${RECOMMENDED_FILTER_LABELS[blocked]} filtering is not available for this organization`,
      )
    }
  }

  // Win-only (ENG-10839), same shape as the party gate above but checked on
  // the raw pre-conversion input: contactsMade* booleans never reach the
  // converted FilterObject (see extractContactsMadeSelection's doc comment),
  // so 'politicalParty' in filters' pattern doesn't apply here.
  private hasContactsMadeSelection(
    filterInput: Partial<VoterFileFilter>,
  ): boolean {
    return CONTACTS_MADE_BUCKET_FIELDS.some(({ field }) => filterInput[field])
  }

  private assertNoContactsMadeFilterForElectedOffice(
    organization: Organization,
    filterInput: Partial<VoterFileFilter>,
  ): void {
    if (
      this.hasElectedOfficeAccess(organization) &&
      this.hasContactsMadeSelection(filterInput)
    ) {
      throw new BadRequestException(
        'Contacts-made filtering is not available for this organization',
      )
    }
  }

  // The exact inverse, and refused rather than ignored for the reason the
  // party gate refuses: silently dropping an unsupported dimension returns a
  // WIDER audience than the caller asked for, and a phone list built from it
  // would call people nobody selected.
  private assertNoFollowUpFilterForCampaign(
    organization: Organization,
    filterInput: Partial<VoterFileFilter>,
  ): void {
    if (
      !this.hasElectedOfficeAccess(organization) &&
      filterInput.followUpRequested
    ) {
      throw new BadRequestException(
        'Follow-up filtering is not available for this organization',
      )
    }
  }

  // Override-aware Voter Likelihood filtering (ENG-10838): a person manually
  // set to a bucket must match that bucket's filter even when their seed
  // disagrees, and vice versa. Runs off whatever `filters.voterStatus`
  // convertVoterFileFilterToFilters already produced, so both the wizard's
  // audience* booleans AND the assistant's raw voterStatus array (which
  // bypasses the booleans entirely — see filterDimensions.catalog.ts) get
  // override-awareness through this one place. A no-op when the request
  // carries no voterStatus filter at all — there's nothing to override.
  // Serve orgs never have voter_likelihood override rows (the write path
  // 400s for eo- orgs, ContactStatusService), so this is a guaranteed no-op
  // there too; skip the two round trips rather than pay them for nothing.
  private async resolveVoterLikelihoodFilter(
    organization: Organization,
    filters: FilterObject,
  ): Promise<{ filters: FilterObject; idOverrides?: IdOverrides }> {
    if (this.hasElectedOfficeAccess(organization)) {
      return { filters }
    }

    const seedValues = extractVoterStatusSeedValues(filters)
    if (seedValues.length === 0) {
      return { filters }
    }

    const selected = new Set(
      seedValues
        .map((value) => SEED_VOTER_STATUS_TO_LIKELIHOOD[value])
        .filter((value): value is VoterLikelihood => value !== undefined),
    )
    if (selected.size === 0) {
      return { filters }
    }

    // Map the selection back to its seed value(s) so the seed side of the
    // filter agrees with what a no-override person's own record displays.
    // One-to-one since Unreliable gained its own member.
    const selectedSeedValues = [...selected].flatMap(
      (value) => VOTER_LIKELIHOOD_TO_SEED_VALUES[value],
    )
    const updatedFilters: FilterObject = {
      ...filters,
      voterStatus:
        selectedSeedValues.length === 1
          ? { eq: selectedSeedValues[0] }
          : { in: selectedSeedValues },
    }

    const excludedValues = VoterLikelihoodSchema.options.filter(
      (value) => !selected.has(value),
    )
    const [include, exclude] = await Promise.all([
      this.contactStatusService.personIdsByFieldValue(
        organization.slug,
        ContactStatusField.voter_likelihood,
        [...selected],
      ),
      excludedValues.length
        ? this.contactStatusService.personIdsByFieldValue(
            organization.slug,
            ContactStatusField.voter_likelihood,
            excludedValues,
          )
        : Promise.resolve([]),
    ])

    if (include.length === 0 && exclude.length === 0) {
      return { filters: updatedFilters }
    }
    return {
      filters: updatedFilters,
      idOverrides: {
        ...(include.length ? { include } : {}),
        ...(exclude.length ? { exclude } : {}),
      },
    }
  }

  // Shared by every consumer that converts a filter input straight into a
  // FilterObject (count, overlap-count, findContactsForFilter, list-detail):
  // convert -> party gate -> Voter Likelihood override resolution, in the
  // order the call sites already ran the first two steps.
  private async resolveBaseFilters(
    organization: Organization,
    filterInput: Partial<VoterFileFilter>,
  ): Promise<{ filters: FilterObject; idOverrides?: IdOverrides }> {
    const baseFilters = convertVoterFileFilterToFilters(filterInput)
    this.assertNoPartyFilterForElectedOffice(organization, baseFilters)
    this.assertNoEthnicityFilterForElectedOffice(organization, baseFilters)
    this.assertNoRecommendedListFilterForElectedOffice(
      organization,
      baseFilters,
    )
    this.assertNoContactsMadeFilterForElectedOffice(organization, filterInput)
    this.assertNoFollowUpFilterForCampaign(organization, filterInput)
    return this.resolveVoterLikelihoodFilter(organization, baseFilters)
  }

  // Composes activity-condition/support-status resolution with the
  // contacts-made filter (ENG-10839). Both can produce a plain id in/notIn
  // constraint destined for people-api's single `id` key, so they're
  // intersected here (intersectIdFilterResolutions) before any caller merges
  // the result in; the mixed "0 + a non-zero bucket" case can't collapse to
  // a single in/notIn operator, so it travels as an independent
  // contactsMadeIdOverrides clause instead (people-api AND-s it with the
  // activity/support resolution's own `id` clause at the SQL level, rather
  // than sharing the `id` key). Win-only: every caller already asserts an
  // eo- org's filterInput carries no contactsMade selection
  // (assertNoContactsMadeFilterForElectedOffice), so hasElectedOfficeAccess
  // here is a defense-in-depth no-op, not the primary gate.
  // A saved boundary, as an id set to intersect with everything else.
  //
  // Keyed on `geoPoly`, never on the member rows: a shape that enclosed
  // nobody stores zero rows, and reading that as "no constraint" would serve
  // the whole unrefined list — the one failure here that looks like success.
  // An unsaved draft carries a shape but no `id` and so has nothing frozen
  // to read; it resolves to empty for the same reason.
  private async resolveGeoIdFilter(
    filterInput: ContactsFilterResolutionInput,
  ): Promise<IdFilterResolution> {
    if (!filterInput.geoPoly) return { kind: 'none' }
    if (typeof filterInput.id !== 'number') return { kind: 'empty' }
    const personIds = await this.voterFileFilterGeoService.personIdsFor(
      filterInput.id,
    )
    return personIds.length === 0
      ? { kind: 'empty' }
      : { kind: 'filter', idFilter: { in: personIds } }
  }

  // The frozen members of a saved list's drawn boundary, for a caller
  // counting that list's criteria inline (the edit wizard). Scoped through
  // resolveCustomSegment, which 404s an id this organization does not own,
  // so a client-supplied id cannot reach another org's membership.
  private async resolveBoundaryFromSegment(
    organization: Organization,
    filterInput: CountContactsDTO,
  ): Promise<IdFilterResolution> {
    if (filterInput.boundaryFromSegmentId === undefined) {
      return { kind: 'none' }
    }
    const segment = await this.resolveCustomSegment(
      String(filterInput.boundaryFromSegmentId),
      organization,
    )
    return this.resolveGeoIdFilter(segment)
  }

  private async resolveIdFilterWithContactsMade(
    organization: Organization,
    filterInput: ContactsFilterResolutionInput,
  ): Promise<{
    idResolution: IdFilterResolution
    contactsMadeIdOverrides?: IdOverrides
  }> {
    const activityResolution =
      await this.activityConditionResolution.resolveIdFilter(
        organization.slug,
        {
          activityConditions: filterInput.activityConditions,
          supportStatus: filterInput.supportStatus,
        },
      )
    // Folded in BEFORE the elected-office return below, because a drawn
    // boundary is a Serve feature and that return is the Serve path. Applied
    // after it, the boundary would hold on the CSV and the counts and
    // nowhere a holder actually looks.
    const idResolution = intersectIdFilterResolutions(
      activityResolution,
      await this.resolveGeoIdFilter(filterInput),
    )
    if (this.hasElectedOfficeAccess(organization)) {
      // Serve's own dimension takes the Win block's place rather than sitting
      // beside it: an org is one surface or the other, and neither product
      // can select the other's audience.
      return {
        idResolution: await this.resolveFollowUpRequested(
          organization,
          filterInput,
          idResolution,
        ),
      }
    }

    const selected = extractContactsMadeSelection(filterInput)
    if (selected.size === 0) {
      return { idResolution }
    }

    const contactsMadeResolution =
      await this.contactsMadeResolutionService.resolveContactsMade(
        organization.slug,
        selected,
      )

    if (contactsMadeResolution.kind === 'override') {
      // The activity/support resolution already resolved to nobody — that
      // still wins outright, since the override clause only AND-s in.
      return idResolution.kind === 'empty'
        ? { idResolution }
        : {
            idResolution,
            contactsMadeIdOverrides: contactsMadeResolution.idOverrides,
          }
    }

    return {
      idResolution: intersectIdFilterResolutions(
        idResolution,
        contactsMadeResolution,
      ),
    }
  }

  // Serve's "who still owes a follow-up" dimension. It reads the STANDING
  // flag (contact_current_status.follow_up), not the follow-up column on the
  // interaction rows, so a request already met by a later call, a later
  // knock, or the contact card's toggle drops out of the audience. That is
  // the whole reason the field exists: AND-ed with an activity condition for
  // one closed outreach, it answers "who from that campaign still needs
  // calling back", and it shrinks as the official works it down — which the
  // campaign's own byFollowUp.yes count, a frozen historical fact, cannot.
  //
  // Only ever a positive membership set, so unlike contactsMade there is no
  // notIn or override shape to compose: nobody carries an implicit flag, and
  // a person with no row is simply not in it.
  private async resolveFollowUpRequested(
    organization: Organization,
    filterInput: ContactsFilterResolutionInput,
    idResolution: IdFilterResolution,
  ): Promise<IdFilterResolution> {
    if (!filterInput.followUpRequested) {
      return idResolution
    }
    if (idResolution.kind === 'empty') {
      return idResolution
    }

    const personIds = await this.contactStatusService.personIdsByFieldValue(
      organization.slug,
      ContactStatusField.follow_up,
      [FollowUpStatus.requested],
    )
    // Nobody flagged is an empty audience, not an absent filter — falling
    // through to "no constraint" would hand back the whole district.
    if (personIds.length === 0) {
      return { kind: 'empty' }
    }

    return intersectIdFilterResolutions(idResolution, {
      kind: 'filter',
      idFilter: { in: personIds },
    })
  }

  // Everything a saved list needs before it can be queried: the FilterObject
  // plus the id-set clauses that travel beside it. Public because door
  // knocking evaluates a turf against the turf's own VoterFileFilter and has
  // to run the identical resolution — `convertVoterFileFilterToFilters` alone
  // silently drops activity conditions, support status, contacts-made, and
  // voter-likelihood overrides, so a list previewed in Contacts and the same
  // list knocked would target different people.
  // Takes the resolution input shape, not a bare `Partial<VoterFileFilter>`:
  // activityConditions is a relation, so a caller that loads the row without
  // including it type-checks fine and silently resolves as if the list had no
  // conditions at all.
  async resolveSavedFilterForQuery(
    organization: Organization,
    filter: ContactsFilterResolutionInput,
  ): Promise<{
    filters: FilterObject
    empty: boolean
    idOverrides?: IdOverrides
    contactsMadeIdOverrides?: IdOverrides
  }> {
    const { filters: baseFilters, idOverrides } = await this.resolveBaseFilters(
      organization,
      filter,
    )
    const { idResolution, contactsMadeIdOverrides } =
      await this.resolveIdFilterWithContactsMade(organization, filter)
    if (idResolution.kind === 'empty') {
      return { filters: baseFilters, empty: true, idOverrides }
    }
    return {
      filters: this.mergeIdFilter(baseFilters, idResolution),
      empty: false,
      idOverrides,
      contactsMadeIdOverrides,
    }
  }

  private async isProAccess(organization: Organization): Promise<boolean> {
    if (this.hasElectedOfficeAccess(organization)) return true
    const campaign = await this.campaigns.findFirst({
      where: { organizationSlug: organization.slug },
      select: { isPro: true },
    })
    return campaign?.isPro ?? false
  }

  // Pro-access depends only on the organization, so callers fanning out over
  // many phones for one org (e.g. the poll-analysis consumer) can resolve it
  // once and pass it into findContacts/findPersonByPhone instead of paying a
  // campaign lookup per phone.
  async resolveProAccess(organization: Organization): Promise<boolean> {
    return this.isProAccess(organization)
  }

  // Shared pro gate for record-level contact features (e.g. notes) that hang
  // off an individual person but, unlike findPerson, never call people-api.
  async assertProAccess(organization: Organization): Promise<void> {
    if (!(await this.isProAccess(organization))) {
      throw new ForbiddenException(PRO_FEATURE_REQUIRED_MESSAGE)
    }
  }

  private async resolveDistrictInfoFromOrg(
    org: Organization,
  ): Promise<{ districtId: string | null }> {
    if (org.overrideDistrictId) {
      return { districtId: org.overrideDistrictId }
    }

    if (org.positionId) {
      const position = await this.elections.getPositionById(org.positionId, {
        includeDistrict: true,
      })
      return { districtId: position?.district?.id ?? null }
    }

    return { districtId: null }
  }

  // Door knocking resolves the same district (and passes the same
  // eligibility gate) as every other voter-data read — public so
  // DoorKnockingModule reuses this instead of duplicating the gate.
  async resolveEligibleDistrictId(org: Organization): Promise<string> {
    return this.withOrgDistrictResolution(
      org,
      async ({ districtId }) => districtId,
    )
  }

  private async withOrgDistrictResolution<Result>(
    org: Organization,
    fn: (params: { districtId: string }) => Promise<Result>,
  ): Promise<Result> {
    const { districtId } = await this.resolveDistrictInfoFromOrg(org)

    if (!districtId) {
      throw new BadRequestException({
        message:
          'Organization does not have sufficient data to resolve district',
        errorCode: VOTER_DATA_UNAVAILABLE_ERROR_CODE,
      })
    }

    await this.assertVoterDataEligibility(org)

    return fn({ districtId })
  }

  // Serve / elected-office orgs keep their existing access untouched. For Win
  // campaign orgs, mirror the voter-file download gate so a federal/state
  // office without L2 district data (or the canDownloadFederal override) gets
  // a clean ineligible 4xx instead of querying People-API with an unusable
  // district.
  private async assertVoterDataEligibility(org: Organization): Promise<void> {
    if (this.hasElectedOfficeAccess(org)) return

    const campaign = await this.campaigns.findFirst({
      where: { organizationSlug: org.slug },
    })
    if (!campaign) return

    const { district, ballotLevel } =
      await this.organizations.getDistrictAndBallotLevelForOrgSlug(org.slug)

    if (
      !this.voterFileDownloadAccess.canDownload(campaign, district, ballotLevel)
    ) {
      throw new BadRequestException({
        message: 'Campaign is not eligible for voter data',
        errorCode: VOTER_DATA_UNAVAILABLE_ERROR_CODE,
      })
    }
  }

  async findContacts(
    { resultsPerPage, page, search, segment }: ListContactsDTO,
    organization: Organization,
    // Optional pre-resolved pro-access. Batch callers (e.g. the poll-analysis
    // consumer fanning out over many phones for one org) resolve it once via
    // resolveProAccess() and pass it in; falls back to resolving here.
    proAccess?: boolean,
  ) {
    const wantsProOnlyView =
      !!search || (segment !== undefined && segment !== ALL_CONTACTS_SEGMENT)
    const isPro = proAccess ?? (await this.isProAccess(organization))
    if (wantsProOnlyView && !isPro) {
      throw new ForbiddenException(
        'Search and segments are only available for pro campaigns',
      )
    }

    // A non-pro requester (a Win candidate on the base-list upsell) must never
    // receive real voter PII — see previewContacts.utils. The rows are
    // fabricated, but the pagination total stays real (the district count is an
    // aggregate, not PII, and the unblurred "Total Voters" stat card reads it)
    // so the number a non-pro user sees doesn't regress. District resolution
    // runs first so an ineligible org still gets the VOTER_DATA_UNAVAILABLE
    // state a pro org would, rather than a preview implying data exists.
    if (!isPro) {
      return this.withOrgDistrictResolution(
        organization,
        async ({ districtId }) =>
          buildPreviewContacts({
            resultsPerPage,
            page,
            totalResults: (await this.fetchStatsByDistrictId(districtId))
              .totalConstituents,
          }),
      )
    }

    const fetchPeople = (
      districtParams: { districtId: string },
      filters: FilterObject,
      idOverrides: IdOverrides | undefined,
      contactsMadeIdOverrides: IdOverrides | undefined,
      groupByHousehold: boolean,
      peopleSearch: string | undefined,
    ): Promise<PeopleListResponse> =>
      this.voterQueryService.findPeople(
        ListPeopleDTO.create({
          ...districtParams,
          resultsPerPage,
          page,
          filters,
          idOverrides,
          contactsMadeIdOverrides,
          search: peopleSearch,
          groupByHousehold,
        }),
      )

    const { filters, empty, idOverrides, contactsMadeIdOverrides } =
      await this.segmentToFilters(segment, organization)
    this.assertNoPartyFilterForElectedOffice(organization, filters)
    this.assertNoEthnicityFilterForElectedOffice(organization, filters)
    this.assertNoRecommendedListFilterForElectedOffice(organization, filters)
    const groupByHousehold = this.segmentGroupsByHousehold(segment)
    // A list saved from a search result set persists its search term. When the
    // request itself carries no live search, re-apply the saved list's stored
    // search so selecting it reproduces the searched-down view (ENG-10518). A
    // live search the user typed always wins over the stored one.
    const effectiveSearch =
      search || (await this.segmentToSearch(segment, organization))
    const response = await this.withOrgDistrictResolution(
      organization,
      (params) =>
        empty
          ? Promise.resolve(this.emptyPeopleListResponse(resultsPerPage, page))
          : fetchPeople(
              params,
              filters,
              idOverrides,
              contactsMadeIdOverrides,
              groupByHousehold,
              effectiveSearch,
            ),
    )
    return this.stripWinOnlyFieldsFromList(organization, response)
  }

  // The activity-condition/support-status resolution engine can compose to
  // an empty person-id set (a real, expected outcome — e.g. a condition that
  // matches nobody yet). people-api's `id` filter requires min(1), so this
  // short-circuits to a zero-result page rather than sending `id: { in: [] }`.
  private emptyPeopleListResponse(
    resultsPerPage: number,
    page: number,
  ): PeopleListResponse {
    return {
      pagination: {
        totalResults: 0,
        currentPage: page,
        pageSize: resultsPerPage,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: page > 1,
      },
      people: [],
    }
  }

  // Live matching-voter count for the in-progress (unsaved) filter set the
  // segment builder is showing (ENG-10517). Runs the same filter translation a
  // saved segment would and reads only the people-api total — resultsPerPage: 1
  // so no real rows are loaded. Pro-gated like search/named segments: a non-pro
  // requester only ever sees the base-list preview, never an arbitrary count.
  // Available to Win and Serve alike. Precinct is an administrative
  // subdivision of the same district an official already serves, not a
  // campaign-only construct: a councilmember organizing a constituent
  // mailing by precinct is doing ordinary district work, and every other
  // list-building surface offers it.
  async getPrecincts(
    organization: Organization,
  ): Promise<PeoplePrecinctsResponse> {
    await this.assertProAccess(organization)

    return this.withOrgDistrictResolution(organization, ({ districtId }) =>
      this.voterQueryService.findPrecincts(districtId),
    )
  }

  async countContacts(
    filterInput: CountContactsDTO,
    organization: Organization,
  ): Promise<{ count: number }> {
    if (!(await this.isProAccess(organization))) {
      throw new ForbiddenException(PRO_FILTERING_REQUIRED_MESSAGE)
    }

    const { filters: baseFilters, idOverrides } = await this.resolveBaseFilters(
      organization,
      filterInput,
    )

    const { idResolution: filterResolution, contactsMadeIdOverrides } =
      await this.resolveIdFilterWithContactsMade(organization, filterInput)
    // The edited list's own boundary, intersected with the criteria the
    // holder is editing. The boundary is not part of the inline payload and
    // is not being edited here — the wizard's update never sends geoPoly, so
    // a partial PUT leaves it alone — which is exactly why the count has to
    // go and find it. Counting without it promised a list 16x the size of
    // the one the save would produce.
    const idResolution = intersectIdFilterResolutions(
      filterResolution,
      await this.resolveBoundaryFromSegment(organization, filterInput),
    )
    if (idResolution.kind === 'empty') {
      return this.withOrgDistrictResolution(organization, async () => ({
        count: 0,
      }))
    }
    const filters = this.mergeIdFilter(baseFilters, idResolution)
    // The builder counts the filter set plus any active free-text search so the
    // number matches the list it would save (ENG-10517/10518).
    const search = filterInput.search || undefined

    const fetchCount = async (districtParams: {
      districtId: string
    }): Promise<{ count: number }> => {
      const response = await this.voterQueryService.findPeople(
        ListPeopleDTO.create({
          ...districtParams,
          resultsPerPage: 1,
          page: 1,
          filters,
          idOverrides,
          contactsMadeIdOverrides,
          search,
          groupByHousehold: false,
        }),
      )
      return { count: response.pagination.totalResults }
    }

    return this.withOrgDistrictResolution(organization, fetchCount)
  }

  // How many people a SAVED list holds right now, by id.
  //
  // Takes a segment rather than a filter, which is the point: it resolves
  // through segmentToFilters, exactly as every other read of a saved list
  // does, so the frozen geo members of a drawn boundary and the list's own
  // stored search are both applied without the caller having to know they
  // exist. countContacts would also honour a boundary if handed the whole
  // row — resolveGeoIdFilter reads `id` and `geoPoly` off whatever it is
  // given — but the caller here holds an id, and casting a Prisma row into
  // a DTO-shaped parameter to reach that path is a silent break waiting for
  // either shape to move.
  //
  // The Chief of Staff's `crud_saved_filters` is the caller: an assistant
  // quoting a number the list does not hold is the same defect as a map
  // drawing people the count would miss.
  async countSegment(
    segment: string,
    organization: Organization,
  ): Promise<{ count: number }> {
    if (!(await this.isProAccess(organization))) {
      throw new ForbiddenException(PRO_FILTERING_REQUIRED_MESSAGE)
    }

    const { filters, empty, idOverrides, contactsMadeIdOverrides } =
      await this.segmentToFilters(segment, organization)
    if (empty) {
      return { count: 0 }
    }

    // A saved list's own stored search narrows it on every other read
    // (ENG-10518), so a count that ignored it would overstate the list the
    // holder actually sees.
    const search = await this.segmentToSearch(segment, organization)

    return this.withOrgDistrictResolution(
      organization,
      async (districtParams) => {
        const response = await this.voterQueryService.findPeople(
          ListPeopleDTO.create({
            ...districtParams,
            resultsPerPage: 1,
            page: 1,
            filters,
            idOverrides,
            contactsMadeIdOverrides,
            search: search || undefined,
            groupByHousehold: false,
          }),
        )
        return { count: response.pagination.totalResults }
      },
    )
  }

  // The draw step's answer to "how many of these are inside the shape?",
  // asked while a boundary is still being dragged. Mirrors countContacts —
  // same unsaved-draft grammar, same Pro gate, same district gate — and
  // then narrows by geography the only way people_db allows: a bbox
  // prefilter, because there is no geometry column to run ST_Contains
  // against, followed by an in-process ray-cast that decides membership.
  async polygonPreview(
    { geoPoly, filters: filterInput }: PolygonPreviewContactsDTO,
    organization: Organization,
  ): Promise<{ count: number; audienceEmpty: boolean }> {
    if (!(await this.isProAccess(organization))) {
      throw new ForbiddenException(PRO_FILTERING_REQUIRED_MESSAGE)
    }

    const resolved = await this.resolveSavedFilterForQuery(
      organization,
      filterInput,
    )

    // Two zeros that are indistinguishable on the wire and are not the same
    // problem. "This shape encloses none of your audience" is a boundary to
    // move; "your filters match nobody at all" is a zero no boundary can
    // fix, and the criteria causing it are exactly the ones the map cannot
    // shade. Flagged rather than thrown: a shape mid-drag is allowed to
    // enclose nobody.
    // Returned before the district gate, because this answer does not need a
    // district: the local filters already matched nobody, so there is nothing
    // to go and count. Inside the gate it was not "flagged rather than
    // thrown" at all — an org whose office has no linked district got
    // VOTER_DATA_UNAVAILABLE instead of the flag. Emptiness and district
    // availability are unrelated, so one cannot stand in for the other.
    if (resolved.empty) {
      return { count: 0, audienceEmpty: true }
    }

    return this.withOrgDistrictResolution(
      organization,
      async ({ districtId }) => {
        const { people } = await this.evaluateWithinBbox(
          districtId,
          polygonBbox(geoPoly),
          resolved,
        )
        const inside = people.filter((person) =>
          pointInPolygon(person.lng, person.lat, geoPoly),
        )
        return { count: inside.length, audienceEmpty: false }
      },
    )
  }

  // The dots the draw step draws on: everyone the in-progress filters match,
  // across the whole district, as bare coordinates.
  //
  // This exists because the step used to draw `ALL_SEGMENTS` — the district's
  // entire contactable universe — under a pill counting only the filtered
  // audience. Drawing a shape around visible dots then returned a number
  // smaller than the dots enclosed, because most of them were never in the
  // list being built. The map now shows the list, so the shape and the count
  // are answering about one population.
  //
  // Names and addresses are deliberately absent. The step has no person
  // overlay behind its dots, so the only thing it needs is where they are,
  // and a district-wide read of a draft filter is the widest query in the
  // CRM — the narrowest response it can serve is the right one.
  async filterPoints(
    { filters: filterInput }: FilterPointsContactsDTO,
    organization: Organization,
  ): Promise<{
    points: { id: string; lat: number; lng: number }[]
    truncated: boolean
  }> {
    if (!(await this.isProAccess(organization))) {
      throw new ForbiddenException(PRO_FILTERING_REQUIRED_MESSAGE)
    }

    const resolved = await this.resolveSavedFilterForQuery(
      organization,
      filterInput,
    )

    // Filters that match nobody: an empty map, not an error, and not a
    // district round trip. Mirrors polygonPreview's own short circuit,
    // including its placement before the district gate — emptiness does not
    // need a district to be true.
    if (resolved.empty) {
      return { points: [], truncated: false }
    }

    return this.withOrgDistrictResolution(
      organization,
      async ({ districtId }) => {
        const { people, truncated } =
          await this.voterDoorKnockingService.evaluatePoints(
            DoorKnockingEvaluateDTO.create({
              districtId,
              bbox: DISTRICT_WIDE_BBOX,
              filters: resolved.filters,
              idOverrides: resolved.idOverrides,
              contactsMadeIdOverrides: resolved.contactsMadeIdOverrides,
              maxPeople: MAP_POINTS_MAX,
            }),
            // Same reason polygonPreview drops it: the rooftop gate is door
            // knocking's routing rule, and a dot the holder is about to draw
            // a shape around must be one the count will find.
            { requireRooftopAccuracy: false },
          )
        return {
          points: people.map(({ id, lat, lng }) => ({ id, lat, lng })),
          truncated,
        }
      },
    )
  }

  // Everyone a drawn boundary encloses, for freezing onto the list.
  //
  // Evaluated with NO demographic filters on purpose. The stored set is the
  // geographic half of a list and nothing else: the criteria re-resolve on
  // every read and intersect with it, so editing a list's filters can never
  // invalidate a boundary nobody moved. Resolving it pre-filtered would tie
  // the two together and make every criteria edit owe a fresh Databricks
  // scan.
  async resolveGeoMemberIds(
    organization: Organization,
    geoPoly: GeoJsonPolygon,
  ): Promise<string[]> {
    // The only Databricks fan-out on this service that was reachable without
    // one. `filterAccessCheck`, the guard upstream on the voter-file route,
    // only throws for a non-Pro `campaign-` slug, and `isProAccess` answers
    // false for any slug that is neither `campaign-` nor `eo-` — so such an
    // org passed the upstream check and reached a full bbox scan here.
    if (!(await this.isProAccess(organization))) {
      throw new ForbiddenException(PRO_FILTERING_REQUIRED_MESSAGE)
    }
    return this.withOrgDistrictResolution(
      organization,
      async ({ districtId }) => {
        const { people } = await this.evaluateWithinBbox(
          districtId,
          polygonBbox(geoPoly),
          { filters: {} },
        )
        return people
          .filter((person) => pointInPolygon(person.lng, person.lat, geoPoly))
          .map((person) => person.id)
      },
    )
  }

  private async evaluateWithinBbox(
    districtId: string,
    bbox: Bbox,
    resolved: {
      filters: FilterObject
      idOverrides?: IdOverrides
      contactsMadeIdOverrides?: IdOverrides
    },
  ): Promise<DoorKnockingEvaluateResponse> {
    try {
      return await this.voterDoorKnockingService.evaluate(
        DoorKnockingEvaluateDTO.create({
          districtId,
          bbox,
          filters: resolved.filters,
          idOverrides: resolved.idOverrides,
          contactsMadeIdOverrides: resolved.contactsMadeIdOverrides,
          maxPeople: POLYGON_PREVIEW_MAX_PEOPLE,
        }),
        // The contacts map draws every geocoded row, with no accuracy gate.
        // Counting rooftop-only would answer about a different population
        // than the one the holder just drew a shape around — every
        // interpolated dot on their screen would be uncountable, which is
        // how a shape over hundreds of visible dots came back as zero.
        { requireRooftopAccuracy: false },
      )
    } catch (err) {
      // evaluate rejects rather than truncates past maxPeople, and the only
      // BadRequest it raises is that cap. Its wording is about turfs and
      // stops, which is not what the holder drew here — and a constituent
      // district reaches the cap on shapes they would call ordinary, so the
      // refusal has to name something they can actually do.
      if (err instanceof BadRequestException) {
        throw new BadRequestException(
          'This area holds too many people to count. Draw a smaller ' +
            'boundary or narrow the list.',
        )
      }
      throw err
    }
  }

  // Saved-list overlap count (ENG-10840): how many of the in-progress
  // selection also belong to at least one of the org's saved lists — the
  // wizard's "N (P%) voters already exist in lists you've saved" strip.
  // Takes the identical in-progress payload as countContacts and runs the
  // identical filter translation, so the "current selection" side of the
  // overlap matches the live count exactly. Pro-gated the same way.
  async overlapCount(
    filterInput: CountContactsDTO,
    organization: Organization,
  ): Promise<{ count: number }> {
    if (!(await this.isProAccess(organization))) {
      throw new ForbiddenException(PRO_FILTERING_REQUIRED_MESSAGE)
    }

    const { filters: baseFilters, idOverrides } = await this.resolveBaseFilters(
      organization,
      filterInput,
    )

    const { idResolution, contactsMadeIdOverrides } =
      await this.resolveIdFilterWithContactsMade(organization, filterInput)
    // The current selection resolves to nobody — nothing to overlap with, so
    // this mirrors countContacts' own empty-resolution short circuit rather
    // than paying a people-api round trip for a guaranteed zero.
    if (idResolution.kind === 'empty') {
      return { count: 0 }
    }
    const filters = this.mergeIdFilter(baseFilters, idResolution)
    const search = filterInput.search || undefined

    const savedFilterSets = await this.resolveSavedFilterSets(organization)
    // No saved list resolves to any member — the union of zero sets is
    // empty, so this skips the people-api call entirely (also covers "the
    // org has no saved lists at all").
    if (savedFilterSets.length === 0) {
      return { count: 0 }
    }

    const fetchOverlapCount = (districtParams: {
      districtId: string
    }): Promise<PeopleOverlapCountResponse> =>
      this.voterQueryService.getOverlapCount(
        OverlapCountDTO.create({
          ...districtParams,
          filters,
          idOverrides,
          contactsMadeIdOverrides,
          search,
          savedFilterSets,
        }),
      )

    return this.withOrgDistrictResolution(organization, fetchOverlapCount)
  }

  // The saved-list universe for the overlap union: each saved filter's own
  // activity-condition/support-status parts resolve to a person-id set
  // exactly as the live count does, so activity-based saved lists
  // participate correctly. Capped at the org's most-recently-saved
  // MAX_OVERLAP_SAVED_FILTER_SETS lists (small N per org — do NOT justify that
  // premise with the lists index: its per-row N+1 was a real defect that 504'd
  // prod and is now capped client-side); truncation is logged, never a silent
  // cap. A
  // saved list whose resolution is empty (matches nobody, e.g. a
  // now-orphaned activity condition) contributes nothing to the OR, so it's
  // dropped rather than sent as a meaningless filter set.
  //
  // Deliberately NOT Voter-Likelihood-override-aware (ENG-10838): each set
  // here goes straight through convertVoterFileFilterToFilters with no call
  // into resolveVoterLikelihoodFilter, so a saved list's own voterStatus
  // membership in this union still reflects seed voterStatus only. Doing
  // this per-saved-set correctly needs a per-set idOverrides on the wire
  // (people-api's buildOverlapCountSql currently builds every saved set via
  // plain buildVoterFiltersSql with no override composition) — a real
  // extension, not a one-line addition, so it's out of scope for this ticket.
  // The "current selection" side of the overlap (overlapCount above) IS
  // override-aware.
  private async resolveSavedFilterSets(
    organization: Organization,
  ): Promise<FilterObject[]> {
    const savedFilters =
      await this.voterFileFilterService.findRecentByOrganizationSlug(
        organization.slug,
        MAX_OVERLAP_SAVED_FILTER_SETS + 1,
      )
    const truncated = savedFilters.length > MAX_OVERLAP_SAVED_FILTER_SETS
    const capped = truncated
      ? savedFilters.slice(0, MAX_OVERLAP_SAVED_FILTER_SETS)
      : savedFilters

    if (truncated) {
      // findRecentByOrganizationSlug's `take` caps what came back, so
      // savedFilters.length alone can't distinguish "exactly at the fetch
      // limit" from "many more beyond it" — fetch the org's real total for
      // an honest log line (only paid on the rare truncating org, not the
      // hot path).
      const total = await this.voterFileFilterService.countByOrganizationSlug(
        organization.slug,
      )
      this.logger.warn(
        {
          organizationSlug: organization.slug,
          total,
          cap: MAX_OVERLAP_SAVED_FILTER_SETS,
        },
        'Saved-list overlap count truncated to the most recently saved lists',
      )
    }

    const resolved = await Promise.all(
      capped.map(async (savedFilter) => {
        const savedBaseFilters = convertVoterFileFilterToFilters(savedFilter)
        // Party never reaches Serve (ENG-10696) — the write path doesn't
        // assert this on every saved-filter create/update, so a legacy or
        // otherwise-tainted row can still carry `politicalParty`. Every
        // other caller of convertVoterFileFilterToFilters 400s the whole
        // request on this; the union here can't do that (one bad saved
        // list would break the strip for every other list), so it drops
        // just this set instead.
        //
        // `ethnicity` is dropped on the same terms and for the same reason:
        // Serve may not subset by it (#1933), the write path does not assert
        // it either, and a pre-rule row still carries the six columns. The
        // predicate is named in the log rather than folded into one message,
        // because "which rule dropped this list" is the whole question
        // someone reads this line to answer.
        const droppedPredicate = this.hasPartyFilterForElectedOffice(
          organization,
          savedBaseFilters,
        )
          ? 'party'
          : this.hasElectedOfficeAccess(organization) &&
              'ethnicity' in savedBaseFilters
            ? 'ethnicity'
            : null
        if (droppedPredicate) {
          this.logger.warn(
            {
              organizationSlug: organization.slug,
              voterFileFilterId: savedFilter.id,
            },
            `Saved-list overlap count dropped a saved list carrying a ${droppedPredicate} predicate for an elected-office organization`,
          )
          return null
        }
        // resolveIdFilter 400s past MAX_RESOLVED_ID_SET_SIZE — correct for
        // the single-filter endpoints, but here it (or a transient DB
        // failure) would abort the whole union, so the failing set is
        // dropped like the party case above.
        let savedIdResolution: IdFilterResolution
        try {
          savedIdResolution =
            await this.activityConditionResolution.resolveIdFilter(
              organization.slug,
              {
                activityConditions: savedFilter.activityConditions,
                supportStatus: savedFilter.supportStatus,
              },
            )
          // followUpRequested is in fieldsHandledSeparately, so
          // convertVoterFileFilterToFilters above skipped it — without this
          // the set would contribute everyone its activity conditions match
          // rather than the flagged subset, and the strip would over-report.
          // Unlike the voter-likelihood overrides this loop deliberately
          // leaves unresolved, dropping this one does not refine the
          // audience, it erases the whole constraint: a five-person
          // follow-up list would count as everyone its campaign reached.
          savedIdResolution = await this.resolveFollowUpRequested(
            organization,
            savedFilter,
            savedIdResolution,
          )
          // And the shape drawn on it. Without this a boundaried list joins
          // the union at its PRE-boundary size — every person its criteria
          // match anywhere in the district, not the ones inside the shape —
          // and the strip tells the holder a new list is already covered by
          // an audience that list does not hold. Measured on a real Serve
          // org: 5,356 contributed where the list holds 339.
          //
          // It overstates in the one direction that matters, too: the strip
          // exists to say "you may not need this list", so counting too
          // many argues against building something the holder does need.
          savedIdResolution = intersectIdFilterResolutions(
            savedIdResolution,
            await this.resolveGeoIdFilter(savedFilter),
          )
        } catch (error) {
          this.logger.warn(
            {
              organizationSlug: organization.slug,
              voterFileFilterId: savedFilter.id,
              error,
            },
            'Saved-list overlap count dropped a saved list that failed id-filter resolution',
          )
          return null
        }
        return savedIdResolution.kind === 'empty'
          ? null
          : this.mergeIdFilter(savedBaseFilters, savedIdResolution)
      }),
    )
    return resolved.filter(
      (filterObject): filterObject is FilterObject => filterObject !== null,
    )
  }

  // Ad-hoc filter set, paged full-row export. The Peerly phone-list capture
  // path (ENG-10728) resolves its request through the same
  // activityConditions/supportStatus/search engine as list/count instead of
  // the retired legacy export, so an activity-built list's send can no
  // longer include people the filter excludes. Channel-specific overrides
  // (e.g. forcing hasCellPhone for SMS) are the caller's concern, not this
  // shared resolution's — pass them already merged into filterInput. The
  // input can be the request DTO, a persisted VoterFileFilter row, or a
  // merge of the two (nullable row columns, relation-shaped conditions).
  async findContactsForFilter(
    filterInput: ContactsFilterResolutionInput,
    pagination: { resultsPerPage: number; page: number; skipCount?: boolean },
    organization: Organization,
    excludePersonIds?: Set<string>,
  ): Promise<PeopleListResponse> {
    if (!(await this.isProAccess(organization))) {
      throw new ForbiddenException(PRO_FILTERING_REQUIRED_MESSAGE)
    }

    const { filters: baseFilters, idOverrides } = await this.resolveBaseFilters(
      organization,
      filterInput,
    )

    const { idResolution: rawIdResolution, contactsMadeIdOverrides } =
      await this.resolveIdFilterWithContactsMade(organization, filterInput)
    const idResolution = this.excludePersonIdsFromResolution(
      rawIdResolution,
      excludePersonIds,
    )
    if (idResolution.kind === 'empty') {
      return this.emptyPeopleListResponse(
        pagination.resultsPerPage,
        pagination.page,
      )
    }
    const filters = this.mergeIdFilter(baseFilters, idResolution)
    const search = filterInput.search || undefined

    const fetchPeoplePage = (districtParams: {
      districtId: string
    }): Promise<PeopleListResponse> =>
      this.voterQueryService.findPeople(
        ListPeopleDTO.create({
          ...districtParams,
          resultsPerPage: pagination.resultsPerPage,
          page: pagination.page,
          filters,
          idOverrides,
          contactsMadeIdOverrides,
          search,
          groupByHousehold: false,
          skipCount: pagination.skipCount ?? false,
        }),
      )

    const response = await this.withOrgDistrictResolution(
      organization,
      fetchPeoplePage,
    )
    return this.stripWinOnlyFieldsFromList(organization, response)
  }

  // Demographics + reachable-by-channel counts + outreach history for a
  // saved list's detail page (ENG-10706). Unlike countContacts (an unsaved,
  // in-progress filter set), segment here is always a persisted
  // VoterFileFilter id, so a cross-org/unknown id 404s — the same way
  // resolveCustomSegment now does for the list/download paths.
  async getListDetail(
    { segment }: ListDetailContactsDTO,
    organization: Organization,
  ): Promise<ListDetailContactsResponse> {
    if (!(await this.isProAccess(organization))) {
      throw new ForbiddenException(PRO_FILTERING_REQUIRED_MESSAGE)
    }

    // No segment = the universe row's detail (ENG-10778): the whole
    // unfiltered district. No VoterFileFilter backs it, so there's no id to
    // key outreach history on — the webapp hides that section for this mode.
    if (segment === undefined) {
      const aggregates = await this.fetchListDetailAggregates(organization, {})
      return { ...aggregates, outreachHistory: [] }
    }

    const filter =
      await this.voterFileFilterService.findByIdAndOrganizationSlug(
        segment,
        organization.slug,
      )
    if (!filter) {
      throw new NotFoundException('List not found')
    }

    const { filters: baseFilters, idOverrides } = await this.resolveBaseFilters(
      organization,
      filter,
    )

    const { idResolution, contactsMadeIdOverrides } =
      await this.resolveIdFilterWithContactsMade(organization, filter)

    const outreachHistory =
      await this.voterFileFilterService.findOutreachesByVoterFileFilterId(
        filter.id,
      )

    if (idResolution.kind === 'empty') {
      return {
        demographics: {
          people: 0,
          avgAge: null,
          avgIncome: null,
        },
        reachability: {
          sms: 0,
          robocall: 0,
          phoneBanking: 0,
          doorKnocking: 0,
          polls: 0,
        },
        outreachHistory,
      }
    }

    const filters = this.mergeIdFilter(baseFilters, idResolution)
    const aggregates = await this.fetchListDetailAggregates(
      organization,
      filters,
      idOverrides,
      contactsMadeIdOverrides,
    )
    return { ...aggregates, outreachHistory }
  }

  // The same payload as getListDetail for a filter that has not been saved
  // — a recommended list's detail sheet. Same pro gate and the same filter
  // translation countContacts gives an unsaved filter, so the figures agree
  // with what saving it would show. No row, so no outreach history.
  async getFilterDetail(
    filterInput: CountContactsDTO,
    organization: Organization,
  ): Promise<ListDetailContactsResponse> {
    if (!(await this.isProAccess(organization))) {
      throw new ForbiddenException(PRO_FILTERING_REQUIRED_MESSAGE)
    }

    const { filters: baseFilters, idOverrides } = await this.resolveBaseFilters(
      organization,
      filterInput,
    )
    const { idResolution, contactsMadeIdOverrides } =
      await this.resolveIdFilterWithContactsMade(organization, filterInput)

    if (idResolution.kind === 'empty') {
      return {
        demographics: { people: 0, avgAge: null, avgIncome: null },
        reachability: {
          sms: 0,
          robocall: 0,
          phoneBanking: 0,
          doorKnocking: 0,
          polls: 0,
        },
        outreachHistory: [],
      }
    }

    const aggregates = await this.fetchListDetailAggregates(
      organization,
      this.mergeIdFilter(baseFilters, idResolution),
      idOverrides,
      contactsMadeIdOverrides,
    )
    return { ...aggregates, outreachHistory: [] }
  }

  // Demographics + reachable-by-channel aggregates shared by a saved list's
  // detail and the universe detail (ENG-10778 made the latter a second
  // caller). One call, and on Databricks one statement: the channel counts
  // are conditional aggregates over the same scan as the demographics, so
  // this endpoint no longer fans out five statements per request.
  private async fetchListDetailAggregates(
    organization: Organization,
    baseFilters: FilterObject,
    idOverrides?: IdOverrides,
    contactsMadeIdOverrides?: IdOverrides,
  ): Promise<
    Pick<ListDetailContactsResponse, 'demographics' | 'reachability'>
  > {
    const aggregates = await this.withOrgDistrictResolution(
      organization,
      (districtParams) =>
        this.voterQueryService.getListDetailAggregates(
          AggregatesDTO.create({
            ...districtParams,
            filters: baseFilters,
            idOverrides,
            contactsMadeIdOverrides,
          }),
        ),
    )

    return {
      demographics: {
        people: aggregates.count,
        avgAge: aggregates.avgAge,
        avgIncome: aggregates.avgIncome,
      },
      reachability: {
        sms: aggregates.sms,
        // Robocall/telemarketing reach landlines, not cell phones (mirrors
        // TYPE_OVERRIDES in voterFilePeopleFilter.util.ts).
        robocall: aggregates.robocall,
        // phoneBanking (ENG-10914): reachable by any phone, cell or landline
        // — the list builder freezes any phone, cell first, so this count
        // must agree with the built list rather than the landline-only
        // legacy raw-SQL export population.
        phoneBanking: aggregates.phoneBanking,
        doorKnocking: aggregates.doorKnocking,
        // Polls are delivered by text, so reachability mirrors sms 1:1.
        polls: aggregates.sms,
      },
    }
  }

  async sampleContacts(dto: SampleContacts, organization: Organization) {
    const fetchSample = (districtParams: { districtId: string }) =>
      this.voterQueryService.samplePeople(
        SamplePeopleDTO.create({
          ...districtParams,
          size: String(dto.size ?? 500),
          hasCellPhone: 'true',
          excludeIds: (dto.excludeIds ?? []) as string[],
        }),
      )

    return this.withOrgDistrictResolution(organization, fetchSample)
  }

  // Lookup a single person in the org's district by phone number.
  // The People API's list endpoint already accepts phone-shaped strings in
  // its `search` field and matches against the indexed
  // `VoterTelephones_CellPhoneFormatted` column. Returns the first match
  // (a phone may be shared by multiple voters in a household) or null.
  async findPersonByPhone(
    phone: string,
    organization: Organization,
    proAccess?: boolean,
  ): Promise<PersonOutput | null> {
    const result = await this.findContacts(
      { search: phone, segment: 'all', resultsPerPage: 1, page: 1 },
      organization,
      proAccess,
    )
    return result.people[0] ?? null
  }

  async findPerson(
    id: string,
    organization: Organization,
  ): Promise<PersonOutput> {
    // Opening a person record is a pro action (the list shows non-pro a
    // synthetic preview and the modal fires on row-click). Gate it like
    // search/segments so a direct call can't read real person detail without
    // pro.
    if (!(await this.isProAccess(organization))) {
      throw new ForbiddenException(
        'Viewing contact details is only available for pro campaigns',
      )
    }

    const fetchPerson = (districtParams: {
      districtId: string
    }): Promise<PersonOutput> =>
      this.voterQueryService.findPerson(
        id,
        GetPersonQueryDTO.create(districtParams),
      )

    const person = await this.withOrgDistrictResolution(
      organization,
      fetchPerson,
    )
    // voterLikelihood is Win-only (ENG-10833) — Serve responses stay exactly
    // as they were (field omitted), so skip the lookup entirely for `eo-`
    // orgs rather than compute-and-drop it.
    const [optedOutAt, supportStatus, voterLikelihoodOrNull, followUpOrNull] =
      await Promise.all([
        this.contactInteractionTextService.latestOptOutAt(
          organization.slug,
          person.id,
        ),
        this.effectiveStatus(
          organization.slug,
          person.id,
          ContactStatusField.support_status,
          SupportStatusRollupSchema,
          () => this.derivedSupportStatus(organization.slug, person.id),
        ),
        this.hasElectedOfficeAccess(organization)
          ? Promise.resolve(null)
          : this.effectiveStatus(
              organization.slug,
              person.id,
              ContactStatusField.voter_likelihood,
              VoterLikelihoodSchema,
              () => seedVoterLikelihood(person.voterStatus),
            ),
        // The mirror of the line above: Serve-only, so a Win response stays
        // exactly as it was rather than carrying a flag that surface cannot
        // set.
        this.hasElectedOfficeAccess(organization)
          ? this.effectiveFollowUp(organization.slug, person.id)
          : Promise.resolve(null),
      ])
    const base = {
      ...this.stripWinOnlyFieldsIfElectedOffice(organization, person),
      supportStatus,
      optedOutAt: optedOutAt ? optedOutAt.toISOString() : null,
    }
    const withLikelihood =
      voterLikelihoodOrNull === null
        ? base
        : { ...base, voterLikelihood: voterLikelihoodOrNull }
    return followUpOrNull === null
      ? withLikelihood
      : { ...withLikelihood, followUp: followUpOrNull }
  }

  // Both editable statuses (ENG-10833) are Win-only. Rejects `eo-` orgs
  // before the pro gate so a non-pro Serve org 400s with the "not available
  // for this organization" reason rather than the pro-upsell one.
  async updateContactStatus(
    personId: string,
    dto: UpdateContactStatusInput,
    organization: Organization,
    actorUserId: number,
  ): Promise<ContactStatuses> {
    if (this.hasElectedOfficeAccess(organization)) {
      throw new BadRequestException(
        'Contact status is not available for this organization',
      )
    }
    await this.assertProAccess(organization)

    // Also validates personId resolves within the org's district (findPerson
    // 404s otherwise, mirroring the manual-interaction write path). This
    // read is unlocked and only advisory: ContactStatusService.changeStatus
    // derives the authoritative fromValue from a row-locked read inside its
    // own transaction, so a race between two PATCHes for the same (org,
    // personId, field) can't record a stale fromValue — this snapshot is
    // used only as the fallback when no override row exists yet.
    const current = await this.findPerson(personId, organization)
    const field =
      dto.field === 'voter_likelihood'
        ? ContactStatusField.voter_likelihood
        : ContactStatusField.support_status
    const fallbackFromValue =
      dto.field === 'voter_likelihood'
        ? current.voterLikelihood
        : current.supportStatus

    await this.contactStatusService.changeStatus({
      organizationSlug: organization.slug,
      personId,
      field,
      toValue: dto.value,
      source: ContactStatusSource.manual,
      actorUserId,
      fallbackFromValue: fallbackFromValue ?? null,
    })

    // Read back from the persisted record rather than trusting the request
    // body, so a retry racing a concurrent change reports real DB state.
    const [voterLikelihood, supportStatus] = await Promise.all([
      this.effectiveStatus(
        organization.slug,
        personId,
        ContactStatusField.voter_likelihood,
        VoterLikelihoodSchema,
        () => seedVoterLikelihood(current.voterStatus),
      ),
      this.effectiveStatus(
        organization.slug,
        personId,
        ContactStatusField.support_status,
        SupportStatusRollupSchema,
        () => this.derivedSupportStatus(organization.slug, personId),
      ),
    ])

    return { voterLikelihood, supportStatus }
  }

  // Serve's standing follow-up flag, the mirror image of the gate above: this
  // one rejects a WIN org, because the follow-up question only exists on the
  // Serve surface and a candidate has no use for the flag it maintains. No
  // Pro gate either — an ElectedOffice row is the entitlement, so a Serve org
  // is license-equivalent to Pro and the upsell has nothing to sell.
  //
  // Interaction-sourced writes (a Serve call or knock answering the question)
  // reach the same field through ContactStatusService.changeStatus from their
  // own services; this is the by-hand toggle on the contact card, and the two
  // are deliberately the same field so the latest of either wins.
  async updateFollowUp(
    personId: string,
    value: FollowUpStatus,
    organization: Organization,
    actorUserId: number,
  ): Promise<FollowUpStatusResponse> {
    if (!this.hasElectedOfficeAccess(organization)) {
      throw new BadRequestException(
        'Follow-up is not available for this organization',
      )
    }

    // Resolves personId within the org's district (404s otherwise), the same
    // guard the status PATCH leans on.
    await this.findPerson(personId, organization)

    await this.contactStatusService.changeStatus({
      organizationSlug: organization.slug,
      personId,
      field: ContactStatusField.follow_up,
      toValue: value,
      source: ContactStatusSource.manual,
      actorUserId,
      // Nobody is born flagged, so clearing an unflagged person is a no-op
      // rather than a logged transition that never happened — same seed the
      // two interaction writers use.
      fallbackFromValue: FollowUpStatus.cleared,
    })

    return {
      followUp: await this.effectiveFollowUp(organization.slug, personId),
    }
  }

  // No derived seed to fall back to: unlike voter likelihood (people-api's
  // Voter_Status) and support status (the interaction rollup), nothing derives
  // a follow-up request. Absence of an override IS the answer — nothing is
  // owed — which is why `cleared` is the fallback rather than a lookup.
  private effectiveFollowUp(
    organizationSlug: string,
    personId: string,
  ): Promise<FollowUpStatus> {
    return this.effectiveStatus(
      organizationSlug,
      personId,
      ContactStatusField.follow_up,
      FollowUpStatusSchema,
      () => FollowUpStatus.cleared,
    )
  }

  private async derivedSupportStatus(
    organizationSlug: string,
    personId: string,
  ): Promise<SupportStatusRollup> {
    const statuses = await this.supportStatusService.statusForPeople(
      organizationSlug,
      [personId],
    )
    return statuses.get(personId) ?? SUPPORT_STATUS_UNKNOWN
  }

  // Single override-lookup + fallback merge, reused by findPerson (both
  // fields) and updateContactStatus (the fromValue snapshot and the
  // post-write read-back). `schema` re-validates the persisted string against
  // the field's vocabulary — real narrowing instead of a bare cast, since a
  // Prisma `String` column carries no static type. `fallback` computes the
  // seed/derived value used when no override row exists for this (org,
  // person, field).
  private async effectiveStatus<Value extends string>(
    organizationSlug: string,
    personId: string,
    field: ContactStatusField,
    schema: ZodType<Value>,
    fallback: () => Value | Promise<Value>,
  ): Promise<Value> {
    const overrides = await this.contactStatusService.currentStatusForPeople(
      organizationSlug,
      field,
      [personId],
    )
    const override = overrides.get(personId)
    const parsed =
      override === undefined ? undefined : schema.safeParse(override)
    if (parsed !== undefined && !parsed.success) {
      this.logger.warn(
        { organizationSlug, personId, field, override },
        'contact-status override failed validation; using fallback',
      )
    }
    return parsed?.success ? parsed.data : fallback()
  }

  async downloadContacts(
    { segment }: DownloadContactsDTO,
    res: FastifyReply,
    organization: Organization,
  ) {
    if (!(await this.isProAccess(organization))) {
      throw new ForbiddenException('Campaign is not pro')
    }

    const { filters, empty, idOverrides, contactsMadeIdOverrides } =
      await this.segmentToFilters(segment, organization)
    this.assertNoPartyFilterForElectedOffice(organization, filters)
    this.assertNoEthnicityFilterForElectedOffice(organization, filters)
    this.assertNoRecommendedListFilterForElectedOffice(organization, filters)
    const groupByHousehold = this.segmentGroupsByHousehold(segment)
    const excludeColumns = this.hasElectedOfficeAccess(organization)
      ? SERVE_EXCLUDED_DOWNLOAD_COLUMNS
      : undefined
    return this.withOrgDistrictResolution(organization, (params) =>
      empty
        ? this.emptyDownload(res)
        : this.streamPeopleDownload(
            params,
            filters,
            idOverrides,
            contactsMadeIdOverrides,
            groupByHousehold,
            excludeColumns,
            res,
          ),
    )
  }

  // The saved-list download for a filter that has not been saved — the voter
  // data page's recommended-list sheet. Same pro gate and the same resolution
  // a saved list gets, always as individual voters: the household grouping
  // belongs to the built-in door-knocking segment alone.
  async downloadFilter(
    filter: VoterFilterBase,
    res: FastifyReply,
    organization: Organization,
  ) {
    if (!(await this.isProAccess(organization))) {
      throw new ForbiddenException('Campaign is not pro')
    }

    const { filters, empty, idOverrides, contactsMadeIdOverrides } =
      await this.resolveSavedFilterForQuery(organization, filter)
    this.assertNoPartyFilterForElectedOffice(organization, filters)
    this.assertNoEthnicityFilterForElectedOffice(organization, filters)
    this.assertNoRecommendedListFilterForElectedOffice(organization, filters)
    const excludeColumns = this.hasElectedOfficeAccess(organization)
      ? SERVE_EXCLUDED_DOWNLOAD_COLUMNS
      : undefined
    return this.withOrgDistrictResolution(organization, (params) =>
      empty
        ? this.emptyDownload(res)
        : this.streamPeopleDownload(
            params,
            filters,
            idOverrides,
            contactsMadeIdOverrides,
            false,
            excludeColumns,
            res,
          ),
    )
  }

  private streamPeopleDownload(
    districtParams: { districtId: string },
    filters: FilterObject,
    idOverrides: IdOverrides | undefined,
    contactsMadeIdOverrides: IdOverrides | undefined,
    groupByHousehold: boolean,
    excludeColumns: ExcludableVoterColumn[] | undefined,
    res: FastifyReply,
  ): Promise<void> {
    const gpDownloadCookie =
      `gp_download=${randomUUID()}; Path=/; Max-Age=30; ` +
      `SameSite=Lax; Secure`
    return this.voterDownloadService.streamPeopleCsv(
      DownloadPeopleDTO.create({
        ...districtParams,
        filters,
        idOverrides,
        contactsMadeIdOverrides,
        groupByHousehold,
        excludeColumns,
      }),
      res,
      {
        filename: 'contacts.csv',
        extraHeaders: { 'Set-Cookie': gpDownloadCookie },
      },
    )
  }

  // The legacy voter-file endpoint (GET /voters/voter-file — task-flow record
  // counts and the outreach audience CSV) resolved through the same people-api
  // pipeline as the CRM (ENG-5032). Deliberately NOT pro-gated: that endpoint
  // has never required pro — CanDownloadVoterFileGuard on its controller owns
  // access, and free campaigns read task-flow counts through it. Voter-file
  // inputs are demographic booleans only, so the activity-condition
  // resolution engine is skipped.
  async countVoterFilePeople(
    filterInput: Partial<VoterFileFilter>,
    groupByHousehold: boolean,
    organization: Organization,
  ): Promise<number> {
    const filters = convertVoterFileFilterToFilters(filterInput)
    this.assertNoPartyFilterForElectedOffice(organization, filters)
    this.assertNoEthnicityFilterForElectedOffice(organization, filters)
    this.assertNoRecommendedListFilterForElectedOffice(organization, filters)

    return this.withOrgDistrictResolution(
      organization,
      async (districtParams): Promise<number> => {
        const response = await this.voterQueryService.findPeople(
          ListPeopleDTO.create({
            ...districtParams,
            resultsPerPage: 1,
            page: 1,
            filters,
            groupByHousehold,
          }),
        )
        return response.pagination.totalResults
      },
    )
  }

  async downloadVoterFilePeople(
    filterInput: Partial<VoterFileFilter>,
    groupByHousehold: boolean,
    organization: Organization,
    res: FastifyReply,
  ): Promise<void> {
    const filters = convertVoterFileFilterToFilters(filterInput)
    this.assertNoPartyFilterForElectedOffice(organization, filters)
    this.assertNoEthnicityFilterForElectedOffice(organization, filters)
    this.assertNoRecommendedListFilterForElectedOffice(organization, filters)

    return this.withOrgDistrictResolution(organization, (params) =>
      this.streamPeopleDownload(
        params,
        filters,
        // Legacy voter-file download (task-flow / outreach audience CSV):
        // demographic booleans only, no Voter Likelihood/contacts-made
        // override resolution — out of scope for ENG-10838/10839 (see the
        // doc comment on countVoterFilePeople above).
        undefined,
        undefined,
        groupByHousehold,
        this.hasElectedOfficeAccess(organization)
          ? SERVE_EXCLUDED_VOTER_FILE_COLUMNS
          : undefined,
        res,
      ),
    )
  }

  // Shared with the empty-set short circuit below so the two paths can't
  // drift on the download headers/cookie contract.
  private setDownloadResponseHeaders(res: FastifyReply): void {
    res.raw.setHeader('Content-Type', 'text/csv')
    res.raw.setHeader(
      'Content-Disposition',
      'attachment; filename="contacts.csv"',
    )
    // Cookie handshake the Download.tsx client polls for. The browser
    // commits cookies from a download response, so its appearance is the
    // signal that "the server has actually started streaming" and lets the
    // client clear its preparing-state spinner ahead of the 15s fallback.
    // `Secure` is fine for localhost too: Chrome/Firefox/Safari all treat
    // localhost as a secure context for cookie purposes.
    res.raw.setHeader(
      'Set-Cookie',
      `gp_download=${randomUUID()}; Path=/; Max-Age=30; SameSite=Lax; Secure`,
    )
    if (!res.raw.headersSent) {
      res.raw.flushHeaders()
    }
  }

  // Same rationale as emptyPeopleListResponse: an empty resolved id set means
  // zero matching people, without a people-api call that would otherwise 400
  // on `id: { in: [] }`. Ships the same headers/cookie contract as a real
  // download, just with no rows.
  private async emptyDownload(res: FastifyReply): Promise<void> {
    this.setDownloadResponseHeaders(res)
    res.raw.end()
  }

  async getDistrictStats(organization: Organization) {
    return this.withOrgDistrictResolution(organization, ({ districtId }) =>
      this.fetchStatsByDistrictId(districtId),
    )
  }

  async resolveDistrictIdFromPosition(
    ballotReadyPositionId: string,
  ): Promise<string | undefined> {
    const position = await this.elections.getPositionByBallotReadyId(
      ballotReadyPositionId,
      { includeDistrict: true },
    )
    return position?.district?.id ?? undefined
  }

  async fetchStatsByDistrictId(districtId: string): Promise<StatsResponse> {
    const stats = await this.peopleStatsService.findStats(
      StatsDTO.create({ districtId }),
    )

    // A district with no stats row is the same user-facing state as an org
    // that can't resolve a district at all: we have no constituent data for
    // this office. Callers branch on the error code, so both must carry it —
    // a bare 404 here read as "unknown route" and fell through every gate.
    if (!stats) {
      throw new BadRequestException({
        message: `District stats not available for districtId=${districtId}`,
        errorCode: VOTER_DATA_UNAVAILABLE_ERROR_CODE,
      })
    }

    return stats
  }

  // Built-in segments never carry activity conditions or a support-status
  // filter, so they skip the resolution engine entirely — no extra query, and
  // the FilterObject they return is byte-identical to before this feature.
  private async segmentToFilters(
    segment: string | undefined,
    organization: Organization,
  ): Promise<{
    filters: FilterObject
    empty: boolean
    idOverrides?: IdOverrides
    contactsMadeIdOverrides?: IdOverrides
  }> {
    const resolvedSegment = segment || ALL_CONTACTS_SEGMENT
    // Built-in segments (segmentsToFiltersMap.const.ts) carry no voterStatus
    // filter, so there's nothing to resolve — skip the round trip.
    const builtInFilters = this.resolveBuiltInSegment(resolvedSegment)
    if (builtInFilters) return { filters: builtInFilters, empty: false }

    const customSegment = await this.resolveCustomSegment(
      resolvedSegment,
      organization,
    )
    this.assertNoContactsMadeFilterForElectedOffice(organization, customSegment)
    this.assertNoFollowUpFilterForCampaign(organization, customSegment)

    const { filters: baseFilters, idOverrides } =
      await this.resolveVoterLikelihoodFilter(
        organization,
        convertVoterFileFilterToFilters(customSegment),
      )
    const { idResolution, contactsMadeIdOverrides } =
      await this.resolveIdFilterWithContactsMade(organization, customSegment)
    if (idResolution.kind === 'empty') {
      return { filters: baseFilters, empty: true, idOverrides }
    }
    return {
      filters: this.mergeIdFilter(baseFilters, idResolution),
      empty: false,
      idOverrides,
      contactsMadeIdOverrides,
    }
  }

  private mergeIdFilter(
    filters: FilterObject,
    resolution: IdFilterResolution,
  ): FilterObject {
    return resolution.kind === 'filter'
      ? { ...filters, id: resolution.idFilter }
      : filters
  }

  // Composes a person-id exclusion set (the opt-out scrub, ENG-10800) with
  // whatever activity-condition/support-status resolution already produced.
  // people-api's `id` filter accepts exactly one operator, so the exclusion
  // can't just be bolted on as a sibling `notIn` — it has to fold into
  // whichever operator is already there. A `notIn` resolution already means
  // "everyone except these", so the exclusion set unions in. An `in`
  // resolution is a specific membership list, so exclusion removes ids
  // directly from it; if that empties the list, this collapses to `empty`
  // rather than sending people-api an illegal zero-length `in`.
  private excludePersonIdsFromResolution(
    resolution: IdFilterResolution,
    excludePersonIds: Set<string> | undefined,
  ): IdFilterResolution {
    if (!excludePersonIds || excludePersonIds.size === 0) return resolution
    if (resolution.kind === 'empty') return resolution
    if (resolution.kind === 'none') {
      return { kind: 'filter', idFilter: { notIn: [...excludePersonIds] } }
    }
    if ('notIn' in resolution.idFilter) {
      const merged = new Set([
        ...resolution.idFilter.notIn,
        ...excludePersonIds,
      ])
      // Both inputs are independently capped at MAX_RESOLVED_ID_SET_SIZE
      // (activityConditionResolution's own notIn, and resolveOptOutScrub's
      // opt-out set) — their union isn't. An org with a large
      // support-status-unknown complement AND a large opt-out history can
      // combine past the people-api transport cap, which would 400 the
      // send. Drop the opt-out exclusion rather than fail the request; the
      // scrub is best-effort, not a hard requirement.
      if (merged.size > MAX_RESOLVED_ID_SET_SIZE) {
        this.logger.warn(
          { size: merged.size, cap: MAX_RESOLVED_ID_SET_SIZE },
          'Opt-out scrub combined with an existing notIn resolution ' +
            'exceeds the people-api id-filter cap — dropping the opt-out ' +
            'exclusion for this request rather than failing it',
        )
        return resolution
      }
      return {
        kind: 'filter',
        idFilter: { notIn: [...merged] },
      }
    }
    const remaining = resolution.idFilter.in.filter(
      (id) => !excludePersonIds.has(id),
    )
    return remaining.length === 0
      ? { kind: 'empty' }
      : { kind: 'filter', idFilter: { in: remaining } }
  }

  // A saved list created from a search result set stores its search term.
  // Built-in segments and the default view never carry one (ENG-10518).
  private async segmentToSearch(
    segment: string | undefined,
    organization: Organization,
  ): Promise<string | undefined> {
    const resolvedSegment = segment || ALL_CONTACTS_SEGMENT
    if (this.resolveBuiltInSegment(resolvedSegment)) return undefined

    const customSegment = await this.resolveCustomSegment(
      resolvedSegment,
      organization,
    )

    return customSegment.search ?? undefined
  }

  // A segment that is neither a built-in name nor a saved list this org owns is
  // a bad reference, not "no filter". Resolving it to an empty FilterObject
  // meant a typo'd, deleted or cross-org id served — and let the CSV export
  // stream — the org's entire district, with a 200. getListDetail has always
  // thrown here; the list/download paths now agree with it.
  //
  // Number() rather than parseInt(): parseInt('12abc') is 12, so a malformed
  // segment used to resolve whichever list carried that numeric prefix.
  private async resolveCustomSegment(
    resolvedSegment: string,
    organization: Organization,
  ): Promise<VoterFileFilter> {
    const segmentId = Number(resolvedSegment)
    const customSegment = Number.isInteger(segmentId)
      ? await this.voterFileFilterService.findByIdAndOrganizationSlug(
          segmentId,
          organization.slug,
        )
      : null

    if (!customSegment) {
      throw new NotFoundException('List not found')
    }
    return customSegment
  }

  // Only the built-in door-knocking channel de-dupes by household; custom and
  // named segments (and every other channel) list one row per voter.
  private segmentGroupsByHousehold(segment: string | undefined): boolean {
    const builtIn =
      defaultSegmentToFiltersMap[
        // Dynamic key lookup into const object — TS can't narrow string to keys
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (segment ||
          ALL_CONTACTS_SEGMENT) as keyof typeof defaultSegmentToFiltersMap
      ]
    return (
      !!builtIn && 'groupByHousehold' in builtIn && builtIn.groupByHousehold
    )
  }

  private resolveBuiltInSegment(segment: string): FilterObject | undefined {
    const segmentToFiltersMap =
      defaultSegmentToFiltersMap[
        // Dynamic key lookup into const object — TypeScript cannot narrow string to known keys
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        segment as keyof typeof defaultSegmentToFiltersMap
      ]

    if (!segmentToFiltersMap) return undefined

    const filters: Record<string, boolean> = {}
    for (const filterName of segmentToFiltersMap.filters) {
      filters[filterName] = true
    }
    return filters
  }
}
