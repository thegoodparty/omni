import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/contacts'
import { AssociationSpecAssociationCategoryEnum } from '@hubspot/api-client/lib/codegen/crm/associations/v4/models/AssociationSpec'
import { AssociationTypes } from '@hubspot/api-client'
import { OrganizationRole } from '../generated/prisma'
import { HubspotService } from './hubspot.service'
import { CRMTeamMemberContactProperties, HubSpot } from './crm.types'

const ROLE_TO_TEAM_ROLE: Record<OrganizationRole, HubSpot.TeamRole> = {
  owner: HubSpot.TeamRole.OWNER,
  campaignAdmin: HubSpot.TeamRole.CAMPAIGN_MANAGER,
  volunteer: HubSpot.TeamRole.VOLUNTEER,
}

@Injectable()
export class CrmTeamMembersService {
  constructor(
    private readonly hubspot: HubspotService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(this.constructor.name)
  }

  /**
   * Upserts a HubSpot contact for a team member by email, sets team_role,
   * and associates it with the campaign's company. Fire-and-forget by
   * design (ENG-10826): callers must wrap this in try/catch — a HubSpot
   * failure must never fail an invite/accept/role-change request. The
   * team_role property must already exist in the HubSpot portal
   * (21589597); HubSpot silently drops writes to an undefined property.
   */
  async syncTeamMember(params: {
    email: string
    name: string | null
    role: OrganizationRole
    crmCompanyId: string | null
  }): Promise<void> {
    if (!this.hubspot.isConfigured) {
      this.logger.debug(
        { email: params.email },
        'HubSpot not configured — skipping team member contact sync',
      )
      return
    }

    const { email, name, role, crmCompanyId } = params
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
      await this.associateCompanyWithContact(crmCompanyId, crmContactId)
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
        const updated = await this.hubspot.client.crm.contacts.basicApi.update(
          existingId,
          { properties },
        )
        return updated?.id
      }
      const created = await this.hubspot.client.crm.contacts.basicApi.create({
        properties,
      })
      return created?.id
    } catch (err) {
      this.logger.error(
        { err, email },
        'error upserting HubSpot contact for team member',
      )
      return undefined
    }
  }

  // Non-primary companyToContact (280), not primaryCompanyToContact — a
  // team member can already have their own primary company from their own
  // campaign, and this association must not displace it.
  private async associateCompanyWithContact(
    crmCompanyId: string,
    crmContactId: string,
  ): Promise<void> {
    try {
      await this.hubspot.client.crm.associations.v4.batchApi.create(
        '0-2',
        '0-1',
        {
          inputs: [
            {
              _from: { id: crmCompanyId },
              to: { id: crmContactId },
              types: [
                {
                  associationCategory:
                    AssociationSpecAssociationCategoryEnum.HubspotDefined,
                  associationTypeId: AssociationTypes.companyToContact,
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
}
