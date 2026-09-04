import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/contacts'
import { AssociationSpecAssociationCategoryEnum } from '@hubspot/api-client/lib/codegen/crm/associations/v4/models/AssociationSpec'
import { OrganizationRole } from '../generated/prisma'
import { HubspotService } from './hubspot.service'
import { AssociationLabelsService } from './associationLabels.service'
import { CRMTeamMemberContactProperties, HubSpot } from './crm.types'
import { extractExistingContactId } from './util/hubspotErrors.util'

const ROLE_TO_TEAM_ROLE: Record<OrganizationRole, HubSpot.TeamRole> = {
  owner: HubSpot.TeamRole.OWNER,
  campaignAdmin: HubSpot.TeamRole.CAMPAIGN_MANAGER,
  volunteer: HubSpot.TeamRole.VOLUNTEER,
}

// Owner-role members synced through this (team) path carry the Candidate
// label, same as the campaign-sync path (ENG-11031) — a team member who is
// also the owner is still the candidate on this company.
const ROLE_TO_ASSOCIATION_LABEL: Record<
  OrganizationRole,
  HubSpot.AssociationLabelName
> = {
  owner: HubSpot.AssociationLabelName.CANDIDATE,
  campaignAdmin: HubSpot.AssociationLabelName.CAMPAIGN_MANAGER,
  volunteer: HubSpot.AssociationLabelName.VOLUNTEER,
}

const COMPANY_OBJECT_TYPE = '0-2'
const CONTACT_OBJECT_TYPE = '0-1'

@Injectable()
export class CrmTeamMembersService {
  constructor(
    private readonly hubspot: HubspotService,
    private readonly associationLabels: AssociationLabelsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(this.constructor.name)
  }

  /**
   * Upserts a HubSpot contact for a team member by email, sets team_role,
   * and associates it with the campaign's company under the role's label
   * (ENG-11030). Fire-and-forget by design (ENG-10826): callers must wrap
   * this in try/catch — a HubSpot failure must never fail an
   * invite/accept/role-change request. The team_role property must already
   * exist in the HubSpot portal (21589597); HubSpot silently drops writes
   * to an undefined property. Pass `fromRole` on a role change so the old
   * role's label is archived before the new one is written.
   */
  async syncTeamMember(params: {
    email: string
    name: string | null
    role: OrganizationRole
    crmCompanyId: string | null
    fromRole?: OrganizationRole
  }): Promise<void> {
    if (!this.hubspot.isConfigured) {
      this.logger.debug(
        { email: params.email },
        'HubSpot not configured — skipping team member contact sync',
      )
      return
    }

    const { email, name, role, crmCompanyId, fromRole } = params
    // Team members carry a single display name (Clerk-provided or a merged
    // User.name), not separate first/last fields — split on the first space
    // the same way HubSpot's own contact-name convention expects.
    const [firstname, ...rest] = (name ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    const lastname = rest.join(' ') || undefined
    const properties: CRMTeamMemberContactProperties = {
      email,
      ...(firstname ? { firstname } : {}),
      ...(lastname ? { lastname } : {}),
      team_role: ROLE_TO_TEAM_ROLE[role],
    }

    const crmContactId = await this.upsertContact(email, properties)
    if (crmContactId && crmCompanyId) {
      if (fromRole && fromRole !== role) {
        await this.archiveRoleLabel(crmCompanyId, crmContactId, fromRole)
      }
      await this.associateCompanyWithContact(crmCompanyId, crmContactId, role)
    }
  }

  /**
   * Archives the member's labeled association on removal from a team and,
   * when the caller says no team membership remains anywhere for this
   * user, clears their team_role property. Fire-and-forget, same posture
   * as syncTeamMember. Uses archiveLabels, never archive — archive would
   * detach the contact from every company association, including their
   * own primary company from their own campaign.
   */
  async removeTeamMemberAssociation(params: {
    email: string
    role: OrganizationRole
    crmCompanyId: string | null
    clearTeamRole: boolean
  }): Promise<void> {
    if (!this.hubspot.isConfigured) {
      this.logger.debug(
        { email: params.email },
        'HubSpot not configured — skipping team member removal sync',
      )
      return
    }

    const { email, role, crmCompanyId, clearTeamRole } = params
    const crmContactId = await this.findContactIdByEmail(email)
    if (!crmContactId) {
      // No contact for this email — nothing to archive or clear.
      return
    }

    if (crmCompanyId) {
      await this.archiveRoleLabel(crmCompanyId, crmContactId, role)
    }

    if (clearTeamRole) {
      await this.clearTeamRoleProperty(crmContactId)
    }
  }

  private async findContactIdByEmail(email: string) {
    try {
      const { total, results } =
        await this.hubspot.client.crm.contacts.searchApi.doSearch({
          properties: ['email'],
          filterGroups: [
            {
              filters: [
                {
                  propertyName: 'email',
                  operator: FilterOperatorEnum.Eq,
                  value: email,
                },
              ],
            },
          ],
        })
      return total && results[0] ? results[0].id : undefined
    } catch (err) {
      // Propagate: returning undefined here would send an EXISTING contact
      // down the create branch, whose 409 skips the team_role update and
      // company association — the sync would be silently lost. The
      // fire-and-forget caller owns failure handling; a transient search
      // error should abort this sync attempt loudly, not mis-create.
      this.logger.warn(
        { err, email },
        'error searching HubSpot contact by email for team member sync',
      )
      throw err
    }
  }

  private async upsertContact(
    email: string,
    properties: CRMTeamMemberContactProperties,
  ) {
    const existingId = await this.findContactIdByEmail(email)
    try {
      if (existingId) {
        // Keep the known id even when the property update fails, so the
        // company association isn't silently dropped with it.
        return (await this.updateContact(existingId, properties)) ?? existingId
      }
      const created = await this.hubspot.client.crm.contacts.basicApi.create({
        properties,
      })
      return created?.id
    } catch (err) {
      const adoptedId = extractExistingContactId(err)
      if (!adoptedId) {
        this.logger.error(
          { err, email },
          'error upserting HubSpot contact for team member',
        )
        return undefined
      }
      // A race between the search above and this create — another caller
      // (or a merge) created/owns the contact between the two. Adopt it
      // instead of dropping the team_role sync.
      this.logger.debug(
        { adoptedId, email },
        'team member contact create conflicted with an existing contact — adopting',
      )
      // Keep the adopted id even when the follow-up property update fails,
      // so the caller can still associate the contact with the company.
      return (await this.updateContact(adoptedId, properties)) ?? adoptedId
    }
  }

  private async updateContact(
    contactId: string,
    properties: CRMTeamMemberContactProperties,
  ) {
    try {
      const updated = await this.hubspot.client.crm.contacts.basicApi.update(
        contactId,
        { properties },
      )
      return updated?.id
    } catch (err) {
      this.logger.error(
        { err, contactId },
        'error updating HubSpot contact for team member',
      )
      return undefined
    }
  }

  // Writes the role's user-defined label, never a HubSpot-defined
  // companyToContact/primaryCompanyToContact — a team member can already
  // have their own primary company from their own campaign, and this
  // association must not displace it (ENG-10826 regression).
  private async associateCompanyWithContact(
    crmCompanyId: string,
    crmContactId: string,
    role: OrganizationRole,
  ): Promise<void> {
    const labelId = await this.associationLabels.resolveLabelId(
      ROLE_TO_ASSOCIATION_LABEL[role],
    )
    if (labelId === undefined) {
      // Already logged loudly by the resolver. HubSpot silently drops
      // writes to an undefined association type, so skip rather than send
      // a create the portal would quietly discard.
      return
    }

    try {
      await this.hubspot.client.crm.associations.v4.batchApi.create(
        COMPANY_OBJECT_TYPE,
        CONTACT_OBJECT_TYPE,
        {
          inputs: [
            {
              _from: { id: crmCompanyId },
              to: { id: crmContactId },
              types: [
                {
                  associationCategory:
                    AssociationSpecAssociationCategoryEnum.UserDefined,
                  associationTypeId: labelId,
                },
              ],
            },
          ],
        },
      )
    } catch (err) {
      this.logger.error(
        { err, crmCompanyId, crmContactId },
        'error associating team member contact with company',
      )
    }
  }

  private async archiveRoleLabel(
    crmCompanyId: string,
    crmContactId: string,
    role: OrganizationRole,
  ): Promise<void> {
    const labelId = await this.associationLabels.resolveLabelId(
      ROLE_TO_ASSOCIATION_LABEL[role],
    )
    if (labelId === undefined) {
      return
    }

    try {
      await this.hubspot.client.crm.associations.v4.batchApi.archiveLabels(
        COMPANY_OBJECT_TYPE,
        CONTACT_OBJECT_TYPE,
        {
          inputs: [
            {
              _from: { id: crmCompanyId },
              to: { id: crmContactId },
              types: [
                {
                  associationCategory:
                    AssociationSpecAssociationCategoryEnum.UserDefined,
                  associationTypeId: labelId,
                },
              ],
            },
          ],
        },
      )
    } catch (err) {
      this.logger.error(
        { err, crmCompanyId, crmContactId, role },
        'error archiving team member association label',
      )
    }
  }

  private async clearTeamRoleProperty(crmContactId: string): Promise<void> {
    try {
      await this.hubspot.client.crm.contacts.basicApi.update(crmContactId, {
        properties: { team_role: '' },
      })
    } catch (err) {
      this.logger.error(
        { err, crmContactId },
        'error clearing team_role on team member removal',
      )
    }
  }
}
