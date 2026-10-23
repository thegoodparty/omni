import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import {
  cityFromDistrictName,
  type CivicPanelJoinPage,
  type JoinCivicPanelInput,
  type JoinCivicPanelResponse,
} from '@goodparty_org/contracts'
import {
  CivicPanelJoinSource,
  CivicPanelStatus,
  ContactStatusField,
  ContactStatusSource,
  ManagedCivicPanelStatus,
  type Organization,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { FeaturesService } from '@/features/services/features.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { SERVE_CITIZEN_PANELS_FLAG } from '@/shared/util/serveCitizenPanelsFlag.util'
import { phoneDigitsKey } from '@/shared/util/strings.util'
import { ContactsService } from './contacts.service'

type Enrollment = {
  id: string
  status: ManagedCivicPanelStatus
  approvedByUserId: number | null
  organization: Organization
}

// Joining a civic panel from outside a send: the office's public join page,
// and a texted JOIN from a number nothing else resolves. Both end in the
// same `civic_panel = member` write every other way onto the panel makes, so
// a person is counted once however many ways they join. See the contacts
// AGENTS.md, "Joining from a link or a text".
@Injectable()
export class CivicPanelJoinService extends createPrismaBase(
  MODELS.CivicPanelJoiner,
) {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly contactStatus: ContactStatusService,
    private readonly textInteractions: ContactInteractionTextService,
    private readonly features: FeaturesService,
    private readonly organizations: OrganizationsService,
  ) {
    super()
  }

  // The person each phone already joined as, for the reply ingest: a STOP
  // or LEAVE from a joiner the voter file does not hold still reaches them.
  async personIdsByPhone(
    organizationSlug: string,
    phoneDigits: string[],
  ): Promise<Map<string, string>> {
    if (phoneDigits.length === 0) return new Map()
    const rows = await this.model.findMany({
      where: { organizationSlug, phone: { in: phoneDigits } },
      select: { phone: true, personId: true },
    })
    return new Map(rows.map((row) => [row.phone, row.personId]))
  }

  // A texted JOIN from a number no send recipient or voter holds: the
  // texter joins as a person of their own, keyed by phone, so a repeat or a
  // later page join is the same person.
  async unmatchedTextJoiner(
    organizationSlug: string,
    phone: string,
  ): Promise<string> {
    return this.saveJoiner({
      organizationSlug,
      phone,
      matchedPersonId: null,
      source: CivicPanelJoinSource.text,
    })
  }

  async readJoinPage(shareCode: string): Promise<CivicPanelJoinPage> {
    const enrollment = await this.findOffered(shareCode)
    const { organization } = enrollment
    const [official, officeName, place] = await Promise.all([
      this.client.user.findUnique({
        where: { id: enrollment.approvedByUserId ?? organization.ownerId },
        select: { firstName: true, lastName: true },
      }),
      this.organizations
        .resolvePositionNameByOrganizationSlug(organization.slug)
        .catch((err: Error) => {
          this.logger.warn({ err }, 'join page: office name read failed')
          return null
        }),
      this.organizations
        .getDistrictForOrgSlug(organization.slug)
        .then((district) =>
          district?.l2Name ? cityFromDistrictName(district.l2Name) : null,
        )
        .catch((err: Error) => {
          this.logger.warn({ err }, 'join page: district read failed')
          return null
        }),
    ])
    const officialName =
      [official?.firstName, official?.lastName]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(' ') || null
    return {
      officialName,
      officeName,
      place,
      open: enrollment.status !== ManagedCivicPanelStatus.stopped,
    }
  }

  // Every outcome reads the same to the caller, so the page never says
  // whether a number was already on the panel, opted out or in the voter
  // file.
  async joinFromPage(
    shareCode: string,
    input: JoinCivicPanelInput,
  ): Promise<JoinCivicPanelResponse> {
    const enrollment = await this.findOffered(shareCode)
    if (enrollment.status === ManagedCivicPanelStatus.stopped) {
      throw new NotFoundException('This civic panel is not taking new members')
    }
    const phone = phoneDigitsKey(input.phone)
    if (!phone) {
      throw new BadRequestException('Enter a 10-digit US phone number.')
    }
    const { organization } = enrollment
    const known = (await this.personIdsByPhone(organization.slug, [phone])).get(
      phone,
    )
    const matched =
      known === undefined
        ? await this.contactsService.findPersonByPhone(phone, organization)
        : null
    const personId = await this.saveJoiner({
      organizationSlug: organization.slug,
      phone,
      matchedPersonId: matched?.id ?? null,
      source: CivicPanelJoinSource.share_page,
      firstName: input.firstName,
      lastName: input.lastName,
    })
    const joined = await this.makeMember(organization.slug, personId)
    this.logger.info(
      {
        enrollmentId: enrollment.id,
        matched: Boolean(matched) || known !== undefined,
        joined,
      },
      'Civic panel join page submitted',
    )
    return { received: true }
  }

  // An opted-out person is never put back on the panel, as a texted JOIN
  // after a STOP is not: a STOP stays the last word.
  private async makeMember(
    organizationSlug: string,
    personId: string,
  ): Promise<boolean> {
    if (
      await this.textInteractions.latestOptOutAt(organizationSlug, personId)
    ) {
      return false
    }
    const event = await this.contactStatus.changeStatus({
      organizationSlug,
      personId,
      field: ContactStatusField.civic_panel,
      toValue: CivicPanelStatus.member,
      source: ContactStatusSource.share_page,
      actorUserId: null,
      fallbackFromValue: CivicPanelStatus.left,
    })
    return event !== null
  }

  // The joiner row for this phone, made if it is new. The first join fixes
  // who the phone is; a later join only refreshes the name it gave.
  private async saveJoiner(input: {
    organizationSlug: string
    phone: string
    matchedPersonId: string | null
    source: CivicPanelJoinSource
    firstName?: string
    lastName?: string
  }): Promise<string> {
    const { organizationSlug, phone, matchedPersonId, source } = input
    const names = {
      ...(input.firstName && { firstName: input.firstName }),
      ...(input.lastName && { lastName: input.lastName }),
    }
    const existing = await this.model.findUnique({
      where: { organizationSlug_phone: { organizationSlug, phone } },
      select: { id: true, personId: true },
    })
    if (existing) {
      if (Object.keys(names).length > 0) {
        await this.model.update({ where: { id: existing.id }, data: names })
      }
      return existing.personId
    }
    const id = uuidv7()
    try {
      const row = await this.model.create({
        data: {
          id,
          organizationSlug,
          phone,
          personId: matchedPersonId ?? id,
          matched: matchedPersonId !== null,
          source,
          ...names,
        },
        select: { personId: true },
      })
      return row.personId
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err
      const raced = await this.model.findUniqueOrThrow({
        where: { organizationSlug_phone: { organizationSlug, phone } },
        select: { personId: true },
      })
      return raced.personId
    }
  }

  // The enrollment behind a join page, 404 when there is none or the panel
  // is not offered to the official who approved it, so an unflagged office
  // has no join page at all.
  private async findOffered(shareCode: string): Promise<Enrollment> {
    const enrollment = await this.client.managedCivicPanel.findUnique({
      where: { shareCode },
      select: {
        id: true,
        status: true,
        approvedByUserId: true,
        organization: true,
      },
    })
    const approver = enrollment?.approvedByUserId ?? null
    const offered =
      approver !== null &&
      (await this.features.isFeatureEnabled({
        user: approver,
        feature: SERVE_CITIZEN_PANELS_FLAG,
      }))
    if (!enrollment || !offered) {
      throw new NotFoundException('This civic panel join page does not exist')
    }
    return enrollment
  }
}
