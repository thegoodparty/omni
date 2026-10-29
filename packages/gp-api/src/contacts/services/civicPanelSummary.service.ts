import { createHash } from 'node:crypto'
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import {
  answersNeeded,
  CONTACT_REST_DAYS,
  PANEL_ACTIVE_WINDOW_DAYS,
  panelExpectedAnswers,
  panelGoalMembers,
  type CivicPanelComposition,
  type CivicPanelSummary,
} from '@goodparty_org/contracts'
import { subDays } from 'date-fns'
import {
  CivicPanelStatus,
  ContactStatusField,
  ManagedCivicPanelStatus,
  Organization,
} from '../../generated/prisma'
import { PrismaService } from '@/prisma/prisma.service'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { ContactsMadeResolutionService } from '@/contactInteraction/services/contactsMadeResolution.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import {
  CENSUS_COMPOSITION_SOURCE,
  type CensusCompositionSource,
} from '@/priorities/services/censusComposition'
import { answeredPersonIds } from '@/priorities/util/priorityRespondents.util'
import {
  panelSteering,
  precinctPlaces,
  type PanelMix,
  type PanelSteering,
} from '../utils/civicPanelSteering.util'
import { ContactsService } from './contacts.service'
import { CensusTractNameService } from './censusTractName.service'

// A panel's census read is kept this long per set of members, so the panel
// page and the Constituents section do not each re-read the warehouse.
const MIX_CACHE_MS = 15 * 60 * 1000

// Serve's civic panel as a whole: how many are on it, how many can be
// asked now, where it stands toward its goal, and who is on it
// beside the district.
@Injectable()
export class CivicPanelSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contactStatusService: ContactStatusService,
    private readonly contactsMadeResolutionService: ContactsMadeResolutionService,
    private readonly contactsService: ContactsService,
    @Inject(CENSUS_COMPOSITION_SOURCE)
    private readonly census: CensusCompositionSource,
    private readonly voterQuery: VoterQueryService,
    private readonly tractNames: CensusTractNameService,
  ) {}

  private readonly mixes = new Map<
    string,
    { key: string; mix: PanelMix; expiresAt: number }
  >()

  async summaryFor(organization: Organization): Promise<CivicPanelSummary> {
    const members = await this.memberIds(organization)
    const memberIds = new Set(members)
    const [needed, managedGoal] = await Promise.all([
      this.districtAnswersNeeded(organization),
      this.managedGoal(organization),
    ])
    // A managed civic panel turns ready at its own stored goal, so every
    // reader of this summary shows that one while it runs.
    const goal = managedGoal ?? panelGoalMembers(needed)
    const steering = await this.steeringFor(
      organization,
      memberIds,
      members.length >= goal,
    )
    const composition = await this.withTractNames(
      organization,
      await this.compositionFor(organization, memberIds, steering),
    )
    const standing = {
      progress: {
        members: members.length,
        goal,
        answersNeeded: needed,
        expectedAnswers: panelExpectedAnswers(members.length),
        groupsCovered: steering.coverage?.groupsCovered ?? 0,
        groupsTotal: steering.coverage?.groupsTotal ?? 0,
      },
      balance: steering.balance,
      composition,
    }
    if (members.length === 0) {
      return {
        members: 0,
        reachedRecently: 0,
        askableNow: 0,
        lastOutreachAt: null,
        ...standing,
      }
    }
    // The notContactedRecently list filter's rule, so askableNow is exactly
    // who a "Not contacted in the last 30 days" panel list holds.
    const [reachedRecently, [lastOutreach]] = await Promise.all([
      this.contactsMadeResolutionService.countContactedSinceAmong(
        organization.slug,
        subDays(new Date(), CONTACT_REST_DAYS),
        members,
      ),
      // The built-in list's history, cut to its newest row, so the list
      // row's "Last outreach" matches the sheet without its aggregates.
      this.contactsService.civicPanelOutreachHistory(
        organization.slug,
        members,
        1,
      ),
    ])
    return {
      members: members.length,
      reachedRecently,
      askableNow: members.length - reachedRecently,
      lastOutreachAt: lastOutreach
        ? (lastOutreach.date ?? lastOutreach.createdAt)
        : null,
      ...standing,
    }
  }

  private async memberIds(organization: Organization): Promise<string[]> {
    if (!organization.slug.startsWith('eo-')) {
      throw new BadRequestException(
        'The civic panel is not available for this organization',
      )
    }
    return this.contactStatusService.personIdsByFieldValue(
      organization.slug,
      ContactStatusField.civic_panel,
      [CivicPanelStatus.member],
    )
  }

  private async managedGoal(
    organization: Organization,
  ): Promise<number | null> {
    const managed = await this.prisma.managedCivicPanel.findUnique({
      where: { organizationSlug: organization.slug },
      select: { status: true, goalMembers: true },
    })
    return managed && managed.status !== ManagedCivicPanelStatus.stopped
      ? managed.goalMembers
      : null
  }

  // The answers a good read of the district needs, enough for every major
  // group to answer three times. A district that cannot be read is sized for
  // the smallest major group any district can have.
  private async districtAnswersNeeded(
    organization: Organization,
  ): Promise<number> {
    try {
      const district =
        await this.contactsService.resolveEligibleDistrict(organization)
      return (
        (await this.census.districtAnswersNeeded(district)) ?? answersNeeded()
      )
    } catch {
      return answersNeeded()
    }
  }

  // Which groups the panel covers, and the one status the official sees. A
  // panel with nobody on it has no census to read. Past its goal
  // (`pastGoal`) the panel is judged on its active members.
  private async steeringFor(
    organization: Organization,
    memberIds: Set<string>,
    pastGoal: boolean,
  ): Promise<PanelSteering> {
    const members = memberIds.size
    const mix =
      members === 0
        ? null
        : await this.mixOf(organization, [...memberIds], 'members')
    return panelSteering({
      members,
      mix,
      activeMix:
        pastGoal && mix
          ? await this.activeMixOf(organization, memberIds, mix)
          : null,
    })
  }

  // The panel page's seats and petals: by tract from the census, or by
  // precinct when the district has no tract data. Null when neither can be
  // read.
  private async compositionFor(
    organization: Organization,
    memberIds: Set<string>,
    steering: PanelSteering,
  ): Promise<CivicPanelComposition | null> {
    const fromCensus = steering.composition
    if (fromCensus && fromCensus.places.length > 0) return fromCensus
    if (memberIds.size === 0) return null
    try {
      const district =
        await this.contactsService.resolveEligibleDistrict(organization)
      const [precincts, members] = await Promise.all([
        this.voterQuery.findPrecincts(district.districtId, district.dataset),
        this.voterQuery.findPrecinctMembers(
          district.districtId,
          district.dataset,
          [...memberIds],
        ),
      ])
      const places = precinctPlaces(
        precincts.options.map(({ county, precinct, voters }) => ({
          county,
          precinct,
          people: voters,
        })),
        members,
      )
      if (places.length === 0) return fromCensus
      return {
        placeKind: 'precinct',
        places,
        groups: fromCensus?.groups ?? [],
      }
    } catch {
      return fromCensus
    }
  }

  // Each tract's human name where it has one. Tracts with none are named
  // after the response, once ever per tract (CensusTractNameService), so
  // only a district's first read pays for Geoapify.
  private async withTractNames(
    organization: Organization,
    composition: CivicPanelComposition | null,
  ): Promise<CivicPanelComposition | null> {
    if (composition?.placeKind !== 'tract') return composition
    const tracts = composition.places.map((place) => place.key)
    try {
      const labels = await this.tractNames.labelsFor(tracts)
      if (tracts.some((tract) => !labels.has(tract))) {
        void this.contactsService
          .resolveEligibleDistrict(organization)
          .then((district) => this.tractNames.fillMissing(district, tracts))
          .catch(() => undefined)
      }
      return {
        ...composition,
        places: composition.places.map((place) => {
          const label = labels.get(place.key)
          return label ? { ...place, label } : place
        }),
      }
    } catch {
      return composition
    }
  }

  // The members who answered a priority's text, call or door in the last
  // PANEL_ACTIVE_WINDOW_DAYS, counted the way the members are. Nobody active
  // is the census with no one on it.
  private async activeMixOf(
    organization: Organization,
    memberIds: Set<string>,
    memberMix: PanelMix,
  ): Promise<PanelMix | null> {
    const answered = await answeredPersonIds(
      this.prisma,
      organization.slug,
      null,
      subDays(new Date(), PANEL_ACTIVE_WINDOW_DAYS),
    )
    const active = answered.filter((personId) => memberIds.has(personId))
    if (active.length === 0) return { cells: [], census: memberMix.census }
    return this.mixOf(organization, active, 'active')
  }

  private async mixOf(
    organization: Organization,
    personIds: string[],
    scope: 'members' | 'active',
  ): Promise<PanelMix | null> {
    const key = createHash('sha256')
      .update([...personIds].sort().join(','))
      .digest('hex')
    const now = Date.now()
    const cacheKey = `${organization.slug}:${scope}`
    const cached = this.mixes.get(cacheKey)
    if (cached && cached.key === key && cached.expiresAt > now) {
      return cached.mix
    }
    try {
      const district =
        await this.contactsService.resolveEligibleDistrict(organization)
      const mix = await this.census.weightingInputs({ ...district, personIds })
      if (mix) {
        this.mixes.set(cacheKey, {
          key,
          mix,
          expiresAt: now + MIX_CACHE_MS,
        })
      }
      return mix
    } catch {
      return null
    }
  }
}
