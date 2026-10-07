import { Injectable } from '@nestjs/common'
import { isAfter } from 'date-fns'
import { AssociationSpecAssociationCategoryEnum } from '@hubspot/api-client/lib/codegen/crm/associations/v4/models/AssociationSpec'
import { CRMOfficeHolderProperties, HubSpot } from '@/crm/crm.types'
import { HubspotService } from '@/crm/hubspot.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { toDateOnlyString } from '@/shared/util/date.util'
import { getUserFullName, isTestUser } from '@/users/util/users.util'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { ElectedOffice, User } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'

const CONTACT_OBJECT_TYPE = '0-1'
const COMPANY_OBJECT_TYPE = '0-2'
const OFFICE_HOLDER_ID_PROPERTY = 'gp_api_elected_office_id'

type OfficeHolderConfig = {
  objectTypeId: string
  contactAssociationTypeId: number
  companyAssociationTypeId: number
}

const parseTypeId = (raw: string | undefined): number | null => {
  const id = raw ? Number(raw) : NaN
  return Number.isInteger(id) ? id : null
}

const getOfficeHolderConfig = (): OfficeHolderConfig | null => {
  const objectTypeId = process.env.HUBSPOT_OFFICE_HOLDER_OBJECT_TYPE_ID
  const contactAssociationTypeId = parseTypeId(
    process.env.HUBSPOT_OFFICE_HOLDER_CONTACT_ASSOCIATION_TYPE_ID,
  )
  const companyAssociationTypeId = parseTypeId(
    process.env.HUBSPOT_OFFICE_HOLDER_COMPANY_ASSOCIATION_TYPE_ID,
  )
  return process.env.HUBSPOT_OFFICE_HOLDER_SYNC_ENABLED === 'true' &&
    objectTypeId &&
    contactAssociationTypeId !== null &&
    companyAssociationTypeId !== null
    ? { objectTypeId, contactAssociationTypeId, companyAssociationTypeId }
    : null
}

/**
 * Terms are half-open [start, end), the same convention dateRangesOverlap
 * uses, so a term ending today is already former.
 */
export const deriveOfficeHolderStatus = (
  office: Pick<ElectedOffice, 'termStartDate' | 'termEndDate' | 'campaignId'>,
  now: Date = new Date(),
): HubSpot.OfficeHolderStatus | undefined => {
  const { termStartDate, termEndDate, campaignId } = office
  if (termEndDate && !isAfter(termEndDate, now)) {
    return HubSpot.OfficeHolderStatus.FORMER
  }
  if (termStartDate && !isAfter(termStartDate, now)) {
    return HubSpot.OfficeHolderStatus.IN_OFFICE
  }
  // An office created from a won campaign is a winner sales works before
  // BallotReady publishes the term, so no dates still means elected.
  return termStartDate || campaignId !== null
    ? HubSpot.OfficeHolderStatus.ELECTED
    : undefined
}

@Injectable()
export class CrmOfficeHolderService extends createPrismaBase(
  MODELS.ElectedOffice,
) {
  constructor(
    private readonly hubspot: HubspotService,
    private readonly organizations: OrganizationsService,
    private readonly slack: SlackService,
  ) {
    super()
  }

  /**
   * Upserts the HubSpot Office Holder record for an elected office by
   * gp_api_elected_office_id (DATA-2623) and links it to the user's Contact
   * and the won campaign's Company. Best effort: never throws, so a HubSpot
   * failure can't fail the elected office write that triggered it.
   */
  async syncElectedOffice(
    electedOfficeId: string,
    { justCreated = false }: { justCreated?: boolean } = {},
  ): Promise<void> {
    const config = getOfficeHolderConfig()
    if (!config || !this.hubspot.isConfigured) {
      this.logger.debug(
        { electedOfficeId },
        'HubSpot Office Holder sync off or unconfigured — skipping',
      )
      return
    }

    try {
      const office = await this.model.findUnique({
        where: { id: electedOfficeId },
        include: { user: true, campaign: true },
      })
      if (!office?.user) {
        this.logger.warn(
          { electedOfficeId },
          'no elected office with a user for the HubSpot Office Holder sync',
        )
        return
      }
      const { user, campaign } = office
      if (isTestUser({ email: user.email })) {
        this.logger.debug(
          { electedOfficeId, email: user.email },
          'skipping HubSpot Office Holder sync for a test user',
        )
        return
      }

      const officeHolderId = await this.upsertOfficeHolder(
        office,
        user,
        config.objectTypeId,
        justCreated,
      )
      await this.associate({
        objectTypeId: config.objectTypeId,
        officeHolderId,
        toObjectType: CONTACT_OBJECT_TYPE,
        toObjectId: user.metaData?.hubspotId,
        associationTypeId: config.contactAssociationTypeId,
      })
      await this.associate({
        objectTypeId: config.objectTypeId,
        officeHolderId,
        toObjectType: COMPANY_OBJECT_TYPE,
        toObjectId: campaign?.data?.hubspotId,
        associationTypeId: config.companyAssociationTypeId,
      })
    } catch (err) {
      const message = `hubspot error - office holder sync for elected office ${electedOfficeId}`
      this.logger.error({ err, electedOfficeId }, message)
      await this.slack.errorMessage({ message, error: err })
    }
  }

  private async upsertOfficeHolder(
    office: ElectedOffice,
    user: User,
    objectTypeId: string,
    justCreated: boolean,
  ): Promise<string> {
    // The data platform owns the seat fields after the app's day-one
    // snapshot. Onboarding fills a net-new office over several writes, so the
    // snapshot runs until onboarding completes; after that the app sends only
    // the fields it owns and never overwrites the data platform's values.
    const sendSeatFields = justCreated || office.onboardingCompletedAt === null
    const properties: CRMOfficeHolderProperties = {
      ...(sendSeatFields ? await this.seatProperties(office, user) : {}),
      elected_date: toDateOnlyString(office.electedDate) ?? '',
      sworn_in_date: toDateOnlyString(office.swornInDate) ?? '',
      pledged_at: office.pledgedAt?.toISOString() ?? '',
      onboarding_completed_at:
        office.onboardingCompletedAt?.toISOString() ?? '',
      self_reported: office.selfReported ? 'true' : 'false',
    }

    const { results } = await this.hubspot.client.crm.objects.batchApi.upsert(
      objectTypeId,
      {
        inputs: [
          { idProperty: OFFICE_HOLDER_ID_PROPERTY, id: office.id, properties },
        ],
      },
    )
    const officeHolderId = results[0]?.id
    if (!officeHolderId) {
      throw new Error('HubSpot returned no record for the Office Holder upsert')
    }
    return officeHolderId
  }

  private async seatProperties(
    office: ElectedOffice,
    user: User,
  ): Promise<Partial<CRMOfficeHolderProperties>> {
    const { positionName, district } =
      await this.organizations.getCrmCompanyOrgContextByOrgSlug(
        office.organizationSlug,
      )
    const state = district?.state
    const personName = getUserFullName(user) || user.email
    const seat = positionName ? `${personName}, ${positionName}` : personName
    const status = deriveOfficeHolderStatus(office)
    const termStartDate = toDateOnlyString(office.termStartDate)
    const termEndDate = toDateOnlyString(office.termEndDate)

    return {
      name: state ? `${seat} (${state})` : seat,
      ...(status ? { status } : {}),
      // The Company sync fills candidate_office with the position name too;
      // the data platform later replaces it with BallotReady's office.
      ...(positionName
        ? { position_name: positionName, candidate_office: positionName }
        : {}),
      ...(state ? { state } : {}),
      ...(office.party ? { party_affiliation: office.party } : {}),
      ...(termStartDate ? { term_start_date: termStartDate } : {}),
      ...(termEndDate ? { term_end_date: termEndDate } : {}),
    }
  }

  private async associate(params: {
    objectTypeId: string
    officeHolderId: string
    toObjectType: string
    toObjectId: string | null | undefined
    associationTypeId: number
  }): Promise<void> {
    const { objectTypeId, officeHolderId, toObjectType, toObjectId } = params
    if (!toObjectId) {
      this.logger.debug(
        { officeHolderId, toObjectType },
        'no HubSpot id to link the Office Holder to — skipping the link',
      )
      return
    }
    await this.hubspot.client.crm.associations.v4.batchApi.create(
      objectTypeId,
      toObjectType,
      {
        inputs: [
          {
            _from: { id: officeHolderId },
            to: { id: toObjectId },
            types: [
              {
                associationCategory:
                  AssociationSpecAssociationCategoryEnum.UserDefined,
                associationTypeId: params.associationTypeId,
              },
            ],
          },
        ],
      },
    )
  }
}
