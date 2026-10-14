import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import {
  CONTACT_REST_DAYS,
  MIN_RESPONDENTS_FOR_REPRESENTATION,
  type CivicPanelRepresentation,
  type CivicPanelSummary,
} from '@goodparty_org/contracts'
import { subDays } from 'date-fns'
import {
  CivicPanelStatus,
  ContactStatusField,
  Organization,
} from '../../generated/prisma'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { ContactsMadeResolutionService } from '@/contactInteraction/services/contactsMadeResolution.service'
import {
  CENSUS_COMPOSITION_SOURCE,
  type CensusCompositionSource,
} from '@/priorities/services/censusComposition'
import { computeRepresentation } from '@/priorities/util/representation.util'
import { ContactsService } from './contacts.service'

// Serve's civic panel as a whole: how many are on it, how many can be
// asked now, and whether it looks like the district.
@Injectable()
export class CivicPanelSummaryService {
  constructor(
    private readonly contactStatusService: ContactStatusService,
    private readonly contactsMadeResolutionService: ContactsMadeResolutionService,
    private readonly contactsService: ContactsService,
    @Inject(CENSUS_COMPOSITION_SOURCE)
    private readonly census: CensusCompositionSource,
  ) {}

  async summaryFor(organization: Organization): Promise<CivicPanelSummary> {
    const members = await this.memberIds(organization)
    if (members.length === 0) {
      return {
        members: 0,
        reachedRecently: 0,
        askableNow: 0,
        lastOutreachAt: null,
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
    }
  }

  // Same comparison, threshold and census source as a priority's results,
  // with panel members in place of respondents.
  async representationFor(
    organization: Organization,
  ): Promise<CivicPanelRepresentation> {
    const members = await this.memberIds(organization)
    if (members.length < MIN_RESPONDENTS_FOR_REPRESENTATION) {
      return { representation: null }
    }
    // Past the map's cap the comparison is drawn from the members returned,
    // and respondentCount says how many that was.
    const { points } = await this.contactsService.pointsForPeople(
      members,
      organization,
    )
    if (points.length < MIN_RESPONDENTS_FOR_REPRESENTATION) {
      return { representation: null }
    }
    const composition = await this.census.compose({
      districtKey: organization.slug,
      respondents: points.map(({ id, lat, lng }) => ({
        personId: id,
        lat,
        lng,
      })),
    })
    if (!composition) return { representation: null }
    return {
      representation: {
        source: composition.source,
        respondentCount: points.length,
        groups: computeRepresentation(
          composition.district,
          composition.respondentBlockGroups,
        ),
      },
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
}
