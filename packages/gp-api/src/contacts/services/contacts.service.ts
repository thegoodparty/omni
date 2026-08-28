import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  MAX_OVERLAP_SAVED_FILTER_SETS,
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
} from '@goodparty_org/contracts'
import {
  ContactStatusField,
  ContactStatusSource,
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
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { VoterDownloadService } from '@/peopleDb/services/voterDownload.service'
import { StatsService } from '@/peopleDb/services/stats.service'
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
  PeopleAggregatesResponse,
  StatsResponse,
  VOTER_DATA_UNAVAILABLE_ERROR_CODE,
} from '../contacts.types'
import { CountContactsDTO } from '../schemas/countContacts.schema'
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
// the Pro upgrade without restating the string.
export const PRO_FILTERING_REQUIRED_MESSAGE =
  'Filtering voter data is only available for pro campaigns'

// The CSV download is a Postgres COPY stream gp-api cannot post-process, so an
// `eo-` org's download drops this column from the projection instead
// (ENG-10696). Only downloadVoterFilePeople (the separate outreach/task-flow
// audience download) uses it alone; the CRM download excludes the wider
// SERVE_EXCLUDED_DOWNLOAD_COLUMNS set below (ENG-10830).
const PARTY_DOWNLOAD_COLUMN = 'Parties_Description'

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
  // (party), mirroring assertNoPartyFilterForElectedOffice on the read side.
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
  private stripPartyIfElectedOffice(
    organization: Organization,
    person: PersonOutput,
  ): PersonOutput {
    if (!this.hasElectedOfficeAccess(organization)) return person
    const stripped = { ...person }
    delete stripped.politicalParty
    return stripped
  }

  private stripPartyFromList(
    organization: Organization,
    response: PeopleListResponse,
  ): PeopleListResponse {
    if (!this.hasElectedOfficeAccess(organization)) return response
    return {
      ...response,
      people: response.people.map((person) =>
        this.stripPartyIfElectedOffice(organization, person),
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
    this.assertNoContactsMadeFilterForElectedOffice(organization, filterInput)
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
  private async resolveIdFilterWithContactsMade(
    organization: Organization,
    filterInput: ContactsFilterResolutionInput,
  ): Promise<{
    idResolution: IdFilterResolution
    contactsMadeIdOverrides?: IdOverrides
  }> {
    const idResolution = await this.activityConditionResolution.resolveIdFilter(
      organization.slug,
      {
        activityConditions: filterInput.activityConditions,
        supportStatus: filterInput.supportStatus,
      },
    )
    if (this.hasElectedOfficeAccess(organization)) {
      return { idResolution }
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
      throw new BadRequestException(
        'This feature is only available for pro campaigns',
      )
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
      throw new BadRequestException(
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
    return this.stripPartyFromList(organization, response)
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
  // Win-only, like political party and contacts-made: precinct is an
  // electoral subdivision of a race, and an elected official serves the whole
  // district regardless of which precinct someone votes in. Rejected before
  // the pro gate so a non-pro Serve org gets the "not available" reason
  // rather than the upsell one, matching updateContactStatus.
  async getPrecincts(
    organization: Organization,
  ): Promise<PeoplePrecinctsResponse> {
    if (this.hasElectedOfficeAccess(organization)) {
      throw new BadRequestException(
        'Precinct filtering is not available for this organization',
      )
    }
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
      throw new BadRequestException(PRO_FILTERING_REQUIRED_MESSAGE)
    }

    const { filters: baseFilters, idOverrides } = await this.resolveBaseFilters(
      organization,
      filterInput,
    )

    const { idResolution, contactsMadeIdOverrides } =
      await this.resolveIdFilterWithContactsMade(organization, filterInput)
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
      throw new BadRequestException(PRO_FILTERING_REQUIRED_MESSAGE)
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
        if (
          this.hasPartyFilterForElectedOffice(organization, savedBaseFilters)
        ) {
          this.logger.warn(
            {
              organizationSlug: organization.slug,
              voterFileFilterId: savedFilter.id,
            },
            'Saved-list overlap count dropped a saved list carrying a party predicate for an elected-office organization',
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
      throw new BadRequestException(PRO_FILTERING_REQUIRED_MESSAGE)
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
    return this.stripPartyFromList(organization, response)
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
      throw new BadRequestException(PRO_FILTERING_REQUIRED_MESSAGE)
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

  // Demographics + reachable-by-channel aggregates shared by a saved list's
  // detail and the universe detail (ENG-10778 made the latter a second
  // caller): one base count plus four channel-restricted counts. The five
  // calls settle independently (ENG-10806) — a saved list's demographics and
  // most reachability tiles shouldn't all flip to "Unavailable" because one
  // aggregate query failed. Only the base call is load-bearing: there's
  // nothing to show without it, so its rejection still fails the whole route.
  private async fetchListDetailAggregates(
    organization: Organization,
    baseFilters: FilterObject,
    idOverrides?: IdOverrides,
    contactsMadeIdOverrides?: IdOverrides,
  ): Promise<
    Pick<ListDetailContactsResponse, 'demographics' | 'reachability'>
  > {
    const [base, cellphone, landline, anyPhone, address] =
      await this.withOrgDistrictResolution(
        organization,
        async (districtParams) => {
          // All five run at once. They differ only by a has-phone/has-address
          // predicate, and they settle INDEPENDENTLY (ENG-10806) so one slow
          // channel cannot blank the others.
          //
          // This used to resolve `base` first and gate the four channels on it,
          // to stop a failing list-detail launching five concurrent scans while
          // people-db was tripping its statement timeout. Databricks serves
          // these now, where the cost is a fixed per-statement floor rather
          // than scan load, so serialising cost ~660ms at the median for
          // nothing. The load protection did not go away with the gate: the
          // Postgres comparison arm is capped inside ShadowReadService, so it
          // still runs at the old concurrency no matter how wide this fans out.
          const settled = await Promise.allSettled([
            this.fetchPeopleAggregates(
              districtParams,
              baseFilters,
              idOverrides,
              contactsMadeIdOverrides,
            ),
            this.fetchPeopleAggregates(
              districtParams,
              { ...baseFilters, hasCellPhone: true },
              idOverrides,
              contactsMadeIdOverrides,
            ),
            this.fetchPeopleAggregates(
              districtParams,
              { ...baseFilters, hasLandline: true },
              idOverrides,
              contactsMadeIdOverrides,
            ),
            // phoneBanking (ENG-10914): reachable by any phone, cell or
            // landline — the list builder freezes any phone, cell first, so
            // this count must agree with the built list rather than the
            // landline-only legacy raw-SQL export population.
            this.fetchPeopleAggregates(
              districtParams,
              { ...baseFilters, hasAnyPhone: true },
              idOverrides,
              contactsMadeIdOverrides,
            ),
            this.fetchPeopleAggregates(
              districtParams,
              { ...baseFilters, hasAddress: true },
              idOverrides,
              contactsMadeIdOverrides,
            ),
          ])
          return settled as [
            (typeof settled)[0],
            (typeof settled)[0],
            (typeof settled)[0],
            (typeof settled)[0],
            (typeof settled)[0],
          ]
        },
      )

    if (base.status === 'rejected') {
      throw base.reason
    }
    const cellphoneValue =
      cellphone.status === 'fulfilled' ? cellphone.value : null
    const landlineValue =
      landline.status === 'fulfilled' ? landline.value : null
    const anyPhoneValue =
      anyPhone.status === 'fulfilled' ? anyPhone.value : null
    const addressValue = address.status === 'fulfilled' ? address.value : null

    return {
      demographics: {
        people: base.value.count,
        avgAge: base.value.avgAge,
        avgIncome: base.value.avgIncome,
      },
      reachability: {
        sms: cellphoneValue?.count ?? null,
        // Robocall/telemarketing reach landlines, not cell phones (mirrors
        // TYPE_OVERRIDES in voterFilePeopleFilter.util.ts).
        robocall: landlineValue?.count ?? null,
        phoneBanking: anyPhoneValue?.count ?? null,
        doorKnocking: addressValue?.count ?? null,
        // Polls are delivered by text, so reachability mirrors sms 1:1.
        polls: cellphoneValue?.count ?? null,
      },
    }
  }

  private fetchPeopleAggregates(
    districtParams: { districtId: string },
    filters: FilterObject,
    idOverrides?: IdOverrides,
    contactsMadeIdOverrides?: IdOverrides,
  ): Promise<PeopleAggregatesResponse> {
    return this.voterQueryService.getAggregates(
      AggregatesDTO.create({
        ...districtParams,
        filters,
        idOverrides,
        contactsMadeIdOverrides,
      }),
    )
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
      throw new BadRequestException(
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
    const [optedOutAt, supportStatus, voterLikelihoodOrNull] =
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
      ])
    const base = {
      ...this.stripPartyIfElectedOffice(organization, person),
      supportStatus,
      optedOutAt: optedOutAt ? optedOutAt.toISOString() : null,
    }
    return voterLikelihoodOrNull === null
      ? base
      : { ...base, voterLikelihood: voterLikelihoodOrNull }
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
      throw new BadRequestException('Campaign is not pro')
    }

    const { filters, empty, idOverrides, contactsMadeIdOverrides } =
      await this.segmentToFilters(segment, organization)
    this.assertNoPartyFilterForElectedOffice(organization, filters)
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
          ? [PARTY_DOWNLOAD_COLUMN]
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
