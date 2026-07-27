import { HttpService } from '@nestjs/axios'
import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { ListDetailContactsResponse } from '@goodparty_org/contracts'
import { Organization } from '../../generated/prisma'
import { isAxiosError } from 'axios'
import { FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import { PinoLogger } from 'nestjs-pino'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { lastValueFrom } from 'rxjs'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import { SUPPORT_STATUS_UNKNOWN } from 'src/contactInteraction/contactInteraction.types'
import {
  ActivityConditionResolutionService,
  type IdFilterResolution,
} from 'src/contactInteraction/services/activityConditionResolution.service'
import { ContactInteractionTextService } from 'src/contactInteraction/services/contactInteractionText.service'
import { SupportStatusService } from 'src/contactInteraction/services/supportStatus.service'
import { ElectionsService } from 'src/elections/services/elections.service'
import { OrganizationsService } from 'src/organizations/services/organizations.service'
import { VoterFileDownloadAccessService } from '@/shared/services/voterFileDownloadAccess.service'
import { VoterFileFilterService } from 'src/voters/services/voterFileFilter.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { VoterDownloadService } from '@/peopleDb/services/voterDownload.service'
import { StatsService } from '@/peopleDb/services/stats.service'
import {
  AggregatesDTO,
  DownloadPeopleDTO,
  GetPersonQueryDTO,
  ListPeopleDTO,
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
import type { SupportStatusRollup } from '@goodparty_org/contracts'
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
  convertVoterFileFilterToFilters,
  type FilterObject,
} from '../utils/voterFileFilter.utils'
import {
  FILTER_DIMENSIONS,
  type FilterDimension,
} from '../filterDimensions.catalog'
import { buildPreviewContacts } from '../utils/previewContacts.utils'

const { PEOPLE_API_URL, PEOPLE_API_S2S_SECRET } = process.env

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

// Mirrors people-api's EXCLUDABLE_VOTER_COLUMNS entry for the party column
// (people.select.ts). The CSV download is a Postgres COPY stream gp-api
// cannot post-process, so an `eo-` org's download asks people-api to drop
// this column from the projection instead (ENG-10696).
const PARTY_DOWNLOAD_COLUMN = 'Parties_Description'

if (!PEOPLE_API_URL) {
  throw new Error('Please set PEOPLE_API_URL in your .env')
}
if (!PEOPLE_API_S2S_SECRET) {
  throw new Error('Please set PEOPLE_API_S2S_SECRET in your .env')
}

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
  private cachedToken: string | null = null

  constructor(
    private readonly httpService: HttpService,
    private readonly voterFileFilterService: VoterFileFilterService,
    private readonly elections: ElectionsService,
    private readonly campaigns: CampaignsService,
    private readonly organizations: OrganizationsService,
    private readonly voterFileDownloadAccess: VoterFileDownloadAccessService,
    private readonly supportStatusService: SupportStatusService,
    private readonly contactInteractionTextService: ContactInteractionTextService,
    private readonly activityConditionResolution: ActivityConditionResolutionService,
    private readonly voterQueryService: VoterQueryService,
    private readonly voterDownloadService: VoterDownloadService,
    private readonly peopleStatsService: StatsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ContactsService.name)
  }

  // Read per-call, not cached at module load, so the cutover to the
  // in-process people-db services (peopleDb/) can be toggled without a
  // redeploy — see USE_LOCAL_PEOPLE_DB in .env.example.
  private useLocalPeopleDb(): boolean {
    return process.env.USE_LOCAL_PEOPLE_DB === 'true'
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

  // Rejects a party filter/segment before the people-api call rather than
  // stripping party rows after the fact — list, count, and download all
  // resolve their request into a FilterObject before calling out, so this one
  // check covers all three (ENG-10696).
  private assertNoPartyFilterForElectedOffice(
    organization: Organization,
    filters: FilterObject,
  ): void {
    if (
      this.hasElectedOfficeAccess(organization) &&
      'politicalParty' in filters
    ) {
      throw new BadRequestException(
        'Political party filtering is not available for this organization',
      )
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

    const fetchPeople = async (
      districtParams: { districtId: string },
      filters: FilterObject,
      groupByHousehold: boolean,
      peopleSearch: string | undefined,
    ): Promise<PeopleListResponse> => {
      const body = {
        ...districtParams,
        resultsPerPage,
        page,
        filters,
        search: peopleSearch,
        groupByHousehold,
      }

      if (this.useLocalPeopleDb()) {
        return this.voterQueryService.findPeople(ListPeopleDTO.create(body))
      }

      try {
        const response = await lastValueFrom(
          this.httpService.post(`${PEOPLE_API_URL}/v1/people`, body, {
            headers: { Authorization: `Bearer ${this.getValidS2SToken()}` },
          }),
        )
        // People API response is untyped — external API returns unknown response shape
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        return response.data as PeopleListResponse
      } catch (error) {
        this.logger.error({ error }, `Failed to fetch from people API`)
        throw new BadGatewayException(`Failed to fetch from people API`)
      }
    }

    const { filters, empty } = await this.segmentToFilters(
      segment,
      organization,
    )
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
          : fetchPeople(params, filters, groupByHousehold, effectiveSearch),
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
  async countContacts(
    filterInput: CountContactsDTO,
    organization: Organization,
  ): Promise<number> {
    if (!(await this.isProAccess(organization))) {
      throw new BadRequestException(PRO_FILTERING_REQUIRED_MESSAGE)
    }

    const baseFilters = convertVoterFileFilterToFilters(filterInput)
    this.assertNoPartyFilterForElectedOffice(organization, baseFilters)

    const idResolution = await this.activityConditionResolution.resolveIdFilter(
      organization.slug,
      {
        activityConditions: filterInput.activityConditions,
        supportStatus: filterInput.supportStatus,
      },
    )
    if (idResolution.kind === 'empty') {
      return this.withOrgDistrictResolution(organization, async () => 0)
    }
    const filters = this.mergeIdFilter(baseFilters, idResolution)
    // The builder counts the filter set plus any active free-text search so the
    // number matches the list it would save (ENG-10517/10518).
    const search = filterInput.search || undefined

    const fetchCount = async (districtParams: {
      districtId: string
    }): Promise<number> => {
      const body = {
        ...districtParams,
        resultsPerPage: 1,
        page: 1,
        filters,
        search,
        groupByHousehold: false,
      }

      if (this.useLocalPeopleDb()) {
        const response = await this.voterQueryService.findPeople(
          ListPeopleDTO.create(body),
        )
        return response.pagination.totalResults
      }

      try {
        const response = await lastValueFrom(
          this.httpService.post(`${PEOPLE_API_URL}/v1/people`, body, {
            headers: { Authorization: `Bearer ${this.getValidS2SToken()}` },
          }),
        )
        // People API response is untyped — external API returns unknown shape
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        return (response.data as PeopleListResponse).pagination.totalResults
      } catch (error) {
        this.logger.error({ error }, 'Failed to count from people API')
        throw new BadGatewayException('Failed to count from people API')
      }
    }

    return this.withOrgDistrictResolution(organization, fetchCount)
  }

  // Ad-hoc filter set, paged full-row export. The Peerly phone-list capture
  // path (ENG-10728) resolves its request through the same
  // activityConditions/supportStatus/search engine as list/count instead of
  // the legacy voter-DB export, so an activity-built list's send can no
  // longer include people the filter excludes. Channel-specific overrides
  // (e.g. forcing hasCellPhone for SMS) are the caller's concern, not this
  // shared resolution's — pass them already merged into filterInput. The
  // input can be the request DTO, a persisted VoterFileFilter row, or a
  // merge of the two (nullable row columns, relation-shaped conditions).
  async findContactsForFilter(
    filterInput: ContactsFilterResolutionInput,
    pagination: { resultsPerPage: number; page: number },
    organization: Organization,
  ): Promise<PeopleListResponse> {
    if (!(await this.isProAccess(organization))) {
      throw new BadRequestException(PRO_FILTERING_REQUIRED_MESSAGE)
    }

    const baseFilters = convertVoterFileFilterToFilters(filterInput)
    this.assertNoPartyFilterForElectedOffice(organization, baseFilters)

    const idResolution = await this.activityConditionResolution.resolveIdFilter(
      organization.slug,
      {
        activityConditions: filterInput.activityConditions,
        supportStatus: filterInput.supportStatus,
      },
    )
    if (idResolution.kind === 'empty') {
      return this.emptyPeopleListResponse(
        pagination.resultsPerPage,
        pagination.page,
      )
    }
    const filters = this.mergeIdFilter(baseFilters, idResolution)
    const search = filterInput.search || undefined

    const fetchPeoplePage = async (districtParams: {
      districtId: string
    }): Promise<PeopleListResponse> => {
      const body = {
        ...districtParams,
        resultsPerPage: pagination.resultsPerPage,
        page: pagination.page,
        filters,
        search,
        groupByHousehold: false,
      }

      if (this.useLocalPeopleDb()) {
        return this.voterQueryService.findPeople(ListPeopleDTO.create(body))
      }

      try {
        const response = await lastValueFrom(
          this.httpService.post(`${PEOPLE_API_URL}/v1/people`, body, {
            headers: { Authorization: `Bearer ${this.getValidS2SToken()}` },
          }),
        )
        // People API response is untyped — external API returns unknown shape
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        return response.data as PeopleListResponse
      } catch (error) {
        this.logger.error({ error }, 'Failed to fetch from people API')
        throw new BadGatewayException('Failed to fetch from people API')
      }
    }

    const response = await this.withOrgDistrictResolution(
      organization,
      fetchPeoplePage,
    )
    return this.stripPartyFromList(organization, response)
  }

  // Demographics + reachable-by-channel counts + outreach history for a
  // saved list's detail page (ENG-10706). Unlike countContacts (an unsaved,
  // in-progress filter set), segment here is always a persisted
  // VoterFileFilter id, so a cross-org/unknown id 404s instead of silently
  // falling back to "no filter" the way the segmentToFilters seam does for
  // the list/count/download paths.
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

    const baseFilters = convertVoterFileFilterToFilters(filter)
    this.assertNoPartyFilterForElectedOffice(organization, baseFilters)

    const idResolution = await this.activityConditionResolution.resolveIdFilter(
      organization.slug,
      {
        activityConditions: filter.activityConditions,
        supportStatus: filter.supportStatus,
      },
    )

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
          fenced: false,
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
    )
    return { ...aggregates, outreachHistory }
  }

  // Demographics + reachable-by-channel aggregates shared by a saved list's
  // detail and the universe detail (ENG-10778 made the latter a second
  // caller): one base count plus three channel-restricted counts.
  private async fetchListDetailAggregates(
    organization: Organization,
    baseFilters: FilterObject,
  ): Promise<
    Pick<ListDetailContactsResponse, 'demographics' | 'reachability'>
  > {
    const [base, cellphone, landline, address] =
      await this.withOrgDistrictResolution(organization, (districtParams) =>
        Promise.all([
          this.fetchPeopleAggregates(districtParams, baseFilters),
          this.fetchPeopleAggregates(districtParams, {
            ...baseFilters,
            hasCellPhone: true,
          }),
          // phoneBanking mirrors the built-in channel map
          // (segmentsToFiltersMap.const.ts): it dials landlines, not cell
          // phones — the legacy raw-SQL export's phoneBanking population is
          // landline-only.
          this.fetchPeopleAggregates(districtParams, {
            ...baseFilters,
            hasLandline: true,
          }),
          this.fetchPeopleAggregates(districtParams, {
            ...baseFilters,
            hasAddress: true,
          }),
        ]),
      )

    return {
      demographics: {
        people: base.count,
        avgAge: base.avgAge,
        avgIncome: base.avgIncome,
        // ENG-10775: only the base (unfiltered-by-channel) aggregates call
        // backs the People/avg-age/avg-income tiles the webapp renders as
        // "10,000+" — the cellphone/landline/address calls below feed
        // reachability counts, whose own fenced-ness isn't surfaced yet.
        fenced: base.fenced ?? false,
      },
      reachability: {
        sms: cellphone.count,
        robocall: cellphone.count,
        phoneBanking: landline.count,
        doorKnocking: address.count,
        // Polls are delivered by text, so reachability mirrors sms 1:1.
        polls: cellphone.count,
      },
    }
  }

  private async fetchPeopleAggregates(
    districtParams: { districtId: string },
    filters: FilterObject,
  ): Promise<PeopleAggregatesResponse> {
    const body = { ...districtParams, filters }

    if (this.useLocalPeopleDb()) {
      return this.voterQueryService.getAggregates(AggregatesDTO.create(body))
    }

    try {
      const response = await lastValueFrom(
        this.httpService.post(`${PEOPLE_API_URL}/v1/people/aggregates`, body, {
          headers: { Authorization: `Bearer ${this.getValidS2SToken()}` },
        }),
      )
      // People API response is untyped — external API returns unknown shape
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return response.data as PeopleAggregatesResponse
    } catch (error) {
      this.logger.error({ error }, 'Failed to fetch aggregates from people API')
      throw new BadGatewayException(
        'Failed to fetch aggregates from people API',
      )
    }
  }

  async sampleContacts(dto: SampleContacts, organization: Organization) {
    const fetchSample = async (districtParams: { districtId: string }) => {
      const body = {
        ...districtParams,
        size: String(dto.size ?? 500),
        hasCellPhone: 'true',
        excludeIds: (dto.excludeIds ?? []) as string[],
      }

      if (this.useLocalPeopleDb()) {
        return this.voterQueryService.samplePeople(SamplePeopleDTO.create(body))
      }

      try {
        const token = this.getValidS2SToken()
        const response = await lastValueFrom(
          this.httpService.post<PersonOutput[]>(
            `${PEOPLE_API_URL}/v1/people/sample`,
            body,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          ),
        )
        return response.data
      } catch (error) {
        this.logger.error(
          { error },
          'Failed to sample contacts from people API',
        )
        throw new BadGatewayException(
          'Failed to sample contacts from people API',
        )
      }
    }

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

    const fetchPerson = async (districtParams: {
      districtId: string
    }): Promise<PersonOutput> => {
      if (this.useLocalPeopleDb()) {
        return this.voterQueryService.findPerson(
          id,
          GetPersonQueryDTO.create(districtParams),
        )
      }

      try {
        const response = await lastValueFrom(
          this.httpService.get<PersonOutput>(
            `${PEOPLE_API_URL}/v1/people/${id}`,
            {
              headers: {
                Authorization: `Bearer ${this.getValidS2SToken()}`,
              },
              params: districtParams,
            },
          ),
        )

        return response.data
      } catch (error) {
        if (error instanceof HttpException) {
          throw error
        }
        this.logger.error(
          { data: JSON.stringify(error) },
          'Failed to fetch person from people API',
        )

        if (isAxiosError(error) && error.response?.status === 404) {
          throw new NotFoundException('Person not found')
        }

        throw new BadGatewayException('Failed to fetch person from people API')
      }
    }

    const person = await this.withOrgDistrictResolution(
      organization,
      fetchPerson,
    )
    const [statuses, optedOutAt] = await Promise.all([
      this.supportStatusService.statusForPeople(organization.slug, [person.id]),
      this.contactInteractionTextService.latestOptOutAt(
        organization.slug,
        person.id,
      ),
    ])
    return {
      ...this.stripPartyIfElectedOffice(organization, person),
      supportStatus: statuses.get(person.id) ?? SUPPORT_STATUS_UNKNOWN,
      optedOutAt: optedOutAt ? optedOutAt.toISOString() : null,
    }
  }

  async downloadContacts(
    { segment }: DownloadContactsDTO,
    res: FastifyReply,
    organization: Organization,
  ) {
    if (!(await this.isProAccess(organization))) {
      throw new BadRequestException('Campaign is not pro')
    }

    const { filters, empty } = await this.segmentToFilters(
      segment,
      organization,
    )
    this.assertNoPartyFilterForElectedOffice(organization, filters)
    const groupByHousehold = this.segmentGroupsByHousehold(segment)
    const excludeColumns = this.hasElectedOfficeAccess(organization)
      ? [PARTY_DOWNLOAD_COLUMN]
      : undefined
    return this.withOrgDistrictResolution(organization, (params) =>
      empty
        ? this.emptyDownload(res)
        : this.streamPeopleDownload(
            params,
            filters,
            groupByHousehold,
            excludeColumns,
            res,
          ),
    )
  }

  private async streamPeopleDownload(
    districtParams: { districtId: string },
    filters: FilterObject,
    groupByHousehold: boolean,
    excludeColumns: string[] | undefined,
    res: FastifyReply,
  ): Promise<void> {
    if (this.useLocalPeopleDb()) {
      return this.voterDownloadService.streamPeopleCsv(
        DownloadPeopleDTO.create({
          ...districtParams,
          filters,
          groupByHousehold,
          excludeColumns,
        }),
        res,
      )
    }

    let response: { data: Readable }
    try {
      response = await lastValueFrom(
        this.httpService.post<Readable>(
          `${PEOPLE_API_URL}/v1/people/download`,
          { ...districtParams, filters, groupByHousehold, excludeColumns },
          {
            headers: {
              Authorization: `Bearer ${this.getValidS2SToken()}`,
            },
            responseType: 'stream',
          },
        ),
      )
    } catch (error) {
      this.logger.error(
        { error },
        'Failed to download contacts from people API',
      )

      throw new BadGatewayException(
        'Failed to download contacts from people API',
      )
    }

    // Upstream is live. Only now do we commit our own response headers,
    // because once these are flushed the connection becomes a binary
    // download that any error response would corrupt (browser would save
    // the JSON error blob as `contacts.csv`). All earlier failures
    // (`isProAccess`, district resolution, axios POST) still produce a
    // structured 4xx/5xx because nothing has been written to the wire yet.
    this.setDownloadResponseHeaders(res)

    return new Promise<void>((resolve) => {
      let settled = false
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        fn()
      }
      const destroyUpstream = () => {
        if (!response.data.destroyed) {
          response.data.destroy()
        }
      }

      response.data.pipe(res.raw)
      response.data.on('end', () => settle(resolve))
      // Once `flushHeaders()` above committed our HTTP headers to the wire,
      // a mid-transfer upstream error must NOT propagate as a rejection.
      // Nest's global exception filter would call
      // `httpAdapter.reply(res.raw, jsonBody, 500)` on a response whose
      // headers are already sent, producing either an
      // `ERR_HTTP_HEADERS_SENT` warning or a corrupt CSV+JSON blob saved as
      // `contacts.csv`. Instead: log, tear down both ends, and resolve so
      // the controller's await falls through cleanly. The browser sees a
      // truncated download and the operator sees the cause in the logs.
      response.data.on('error', (err: Error) =>
        settle(() => {
          this.logger.error(
            { err },
            'Upstream stream error after download headers committed',
          )
          destroyUpstream()
          if (!res.raw.destroyed) {
            res.raw.destroy(err)
          }
          resolve()
        }),
      )
      // Browser canceled / network closed mid-download: tear down the
      // upstream people-api stream so the gp-api → people-api socket and
      // the underlying pg COPY connection are released promptly instead of
      // waiting for an idle-timeout.
      res.raw.on('close', () =>
        settle(() => {
          destroyUpstream()
          resolve()
        }),
      )
    })
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
        const body = {
          ...districtParams,
          resultsPerPage: 1,
          page: 1,
          filters,
          groupByHousehold,
        }

        if (this.useLocalPeopleDb()) {
          const response = await this.voterQueryService.findPeople(
            ListPeopleDTO.create(body),
          )
          return response.pagination.totalResults
        }

        try {
          const response = await lastValueFrom(
            this.httpService.post(`${PEOPLE_API_URL}/v1/people`, body, {
              headers: { Authorization: `Bearer ${this.getValidS2SToken()}` },
            }),
          )
          // People API response is untyped — external API returns unknown shape
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          return (response.data as PeopleListResponse).pagination.totalResults
        } catch (error) {
          this.logger.error({ error }, 'Failed to count from people API')
          throw new BadGatewayException('Failed to count from people API')
        }
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
    if (this.useLocalPeopleDb()) {
      return this.peopleStatsService.getStats(StatsDTO.create({ districtId }))
    }

    const token = this.getValidS2SToken()

    try {
      const response = await lastValueFrom(
        this.httpService.get<StatsResponse>(
          `${PEOPLE_API_URL}/v1/people/stats`,
          {
            headers: { Authorization: `Bearer ${token}` },
            params: { districtId },
          },
        ),
      )

      return response.data
    } catch (error) {
      this.logger.error(
        { error },
        'Failed to fetch district stats from people API',
      )
      throw new BadGatewayException(
        'Failed to fetch district stats from people API',
      )
    }
  }

  private getValidS2SToken(): string {
    if (this.cachedToken && this.isTokenValid(this.cachedToken)) {
      return this.cachedToken
    }

    return this.generateAndCacheS2SToken()
  }

  private isTokenValid(token: string): boolean {
    try {
      // jwt.decode returns string | JwtPayload | null — runtime shape depends on token contents
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const decoded = jwt.decode(token) as { exp?: number }
      if (!decoded || !decoded.exp) {
        return false
      }

      const now = Math.floor(Date.now() / 1000)
      const bufferTime = 60

      return decoded.exp > now + bufferTime
    } catch {
      return false
    }
  }

  private generateAndCacheS2SToken(): string {
    const now = Math.floor(Date.now() / 1000)

    const payload = {
      iss: 'gp-api',
      // Bind the token to people-api so the verifier can require this audience.
      aud: 'people-api',
      iat: now,
      exp: now + 300,
    }

    this.cachedToken = jwt.sign(payload, PEOPLE_API_S2S_SECRET!)

    return this.cachedToken
  }

  // Built-in segments never carry activity conditions or a support-status
  // filter, so they skip the resolution engine entirely — no extra query, and
  // the FilterObject they return is byte-identical to before this feature.
  private async segmentToFilters(
    segment: string | undefined,
    organization: Organization,
  ): Promise<{ filters: FilterObject; empty: boolean }> {
    const resolvedSegment = segment || ALL_CONTACTS_SEGMENT
    const builtInFilters = this.resolveBuiltInSegment(resolvedSegment)
    if (builtInFilters) return { filters: builtInFilters, empty: false }

    const customSegment =
      await this.voterFileFilterService.findByIdAndOrganizationSlug(
        parseInt(resolvedSegment),
        organization.slug,
      )
    if (!customSegment) return { filters: {}, empty: false }

    const baseFilters = convertVoterFileFilterToFilters(customSegment)
    const idResolution = await this.activityConditionResolution.resolveIdFilter(
      organization.slug,
      {
        activityConditions: customSegment.activityConditions,
        supportStatus: customSegment.supportStatus,
      },
    )
    if (idResolution.kind === 'empty') {
      return { filters: baseFilters, empty: true }
    }
    return {
      filters: this.mergeIdFilter(baseFilters, idResolution),
      empty: false,
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

  // A saved list created from a search result set stores its search term.
  // Built-in segments and the default view never carry one (ENG-10518).
  private async segmentToSearch(
    segment: string | undefined,
    organization: Organization,
  ): Promise<string | undefined> {
    const resolvedSegment = segment || ALL_CONTACTS_SEGMENT
    if (this.resolveBuiltInSegment(resolvedSegment)) return undefined

    const customSegment =
      await this.voterFileFilterService.findByIdAndOrganizationSlug(
        parseInt(resolvedSegment),
        organization.slug,
      )

    return customSegment?.search ?? undefined
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
