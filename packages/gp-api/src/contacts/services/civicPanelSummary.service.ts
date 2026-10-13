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

// Serve's citizens' panel as a whole: how many are on it, how many can be
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
      return { members: 0, reachedRecently: 0, askableNow: 0 }
    }
    // The notContactedRecently list filter's own read, so askableNow is
    // exactly who a "Not contacted in the last 30 days" panel list holds.
    const contacted = new Set(
      await this.contactsMadeResolutionService.personIdsContactedSince(
        organization.slug,
        subDays(new Date(), CONTACT_REST_DAYS),
      ),
    )
    const reachedRecently = members.filter((id) => contacted.has(id)).length
    return {
      members: members.length,
      reachedRecently,
      askableNow: members.length - reachedRecently,
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
        respondentCount: composition.respondentBlockGroups.length,
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
        "The citizens' panel is not available for this organization",
      )
    }
    return this.contactStatusService.personIdsByFieldValue(
      organization.slug,
      ContactStatusField.civic_panel,
      [CivicPanelStatus.member],
    )
  }
}
