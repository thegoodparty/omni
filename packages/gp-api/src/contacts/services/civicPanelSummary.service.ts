import { BadRequestException, Injectable } from '@nestjs/common'
import {
  CONTACT_REST_DAYS,
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
import { ContactsService } from './contacts.service'

// Serve's civic panel as a whole: how many are on it, how many can be
// asked now.
@Injectable()
export class CivicPanelSummaryService {
  constructor(
    private readonly contactStatusService: ContactStatusService,
    private readonly contactsMadeResolutionService: ContactsMadeResolutionService,
    private readonly contactsService: ContactsService,
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
