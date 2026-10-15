import { BadRequestException, Injectable } from '@nestjs/common'
import {
  mergeTagToken,
  POLL_TOPICS,
  SMS_COMPOSED_MAX_LENGTH,
  ServePollCreate,
  ServePollCreateResponse,
} from '@goodparty_org/contracts'
import { ContactsService } from '@/contacts/services/contacts.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { calcTextAmountInCents } from '@/shared/util/textPricing.util'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import {
  ElectedOffice,
  Organization,
  OutreachStatus,
  OutreachType,
  PollAudienceKind,
  Prisma,
  User,
} from '../../generated/prisma'
import {
  assertServeSmsSendDateAllowed,
  MIN_SERVE_SMS_RECIPIENTS,
  OutreachServeSmsCreateService,
} from './outreachServeSmsCreate.service'

const OPT_OUT_LINE = 'Reply STOP to opt out.'

/**
 * The Serve poll draft-first create: `POST /v1/outreach/serve/poll`.
 *
 * Writes the `Outreach` spine (`outreachType: poll`, `pending_payment`,
 * org-scoped, the question composed into `message`) and its `OutreachPoll`
 * satellite in one nested create, and quotes the count and price. Payment is
 * the Serve SMS purchase handler, unchanged: `Outreach.textCount` is what it
 * prices from.
 */
@Injectable()
export class OutreachServePollCreateService extends createPrismaBase(
  MODELS.Outreach,
) {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly organizationsService: OrganizationsService,
    private readonly voterFileFilterService: VoterFileFilterService,
    private readonly smsCreate: OutreachServeSmsCreateService,
  ) {
    super()
  }

  composeMessage(
    question: string,
    official: Pick<User, 'firstName' | 'lastName'>,
    office: string,
  ): string {
    const name = [official.firstName, official.lastName]
      .filter(Boolean)
      .join(' ')
      .trim()
    const sender = [name, office].filter(Boolean).join(', ')
    return (
      `Hi ${mergeTagToken('first_name', 'serve')}, this is ${sender}. ` +
      `${question} ${OPT_OUT_LINE}`
    )
  }

  async createPoll(
    electedOffice: Pick<ElectedOffice, 'organizationSlug'>,
    official: Pick<User, 'firstName' | 'lastName'>,
    office: string,
    input: ServePollCreate,
  ): Promise<ServePollCreateResponse> {
    const { organizationSlug } = electedOffice
    assertServeSmsSendDateAllowed(input.scheduledLocalDate)

    const message = this.composeMessage(input.question, official, office)
    if (message.length > SMS_COMPOSED_MAX_LENGTH) {
      throw new BadRequestException(
        `This poll text is ${message.length} characters, over the ` +
          `${SMS_COMPOSED_MAX_LENGTH} limit. Shorten the question and try again.`,
      )
    }

    const organization = await this.organizationsService.findFirst({
      where: { slug: organizationSlug },
    })
    if (!organization) {
      throw new BadRequestException('Organization not found')
    }

    let voterFileFilterId: number | null = null
    let textCount: number
    if (input.audience.kind === 'list') {
      const filter =
        await this.voterFileFilterService.findByIdAndOrganizationSlug(
          input.audience.voterFileFilterId,
          organizationSlug,
        )
      if (!filter) {
        throw new BadRequestException('Constituent list not found')
      }
      voterFileFilterId = filter.id
      ;({ recipientCount: textCount } =
        await this.smsCreate.resolveListAudienceCount(
          organization,
          { ...filter },
          organizationSlug,
        ))
    } else {
      textCount = await this.resolveSampleCount(
        organization,
        input.audience.size,
      )
    }

    if (textCount < MIN_SERVE_SMS_RECIPIENTS) {
      throw new BadRequestException(
        `This poll reaches ${textCount} ` +
          `${textCount === 1 ? 'constituent' : 'constituents'} with a ` +
          `mobile number. A poll needs at least ${MIN_SERVE_SMS_RECIPIENTS}.`,
      )
    }

    const topic = POLL_TOPICS.find((candidate) => candidate.id === input.topic)
    const outreach = await this.model.create({
      data: {
        campaignId: null,
        organizationSlug,
        outreachType: OutreachType.poll,
        status: OutreachStatus.pending_payment,
        name: input.topic === 'custom' ? 'Poll' : `${topic?.label} poll`,
        message,
        imageUrl: input.imageUrl,
        scheduledLocalDate: input.scheduledLocalDate,
        voterFileFilterId,
        textCount,
        pollDetails: {
          create: {
            topic: input.topic,
            tone: input.tone ?? null,
            audienceKind:
              input.audience.kind === 'list'
                ? PollAudienceKind.list
                : PollAudienceKind.sample,
            biasOverridden: input.biasOverridden,
          },
        },
      } satisfies Prisma.OutreachUncheckedCreateInput,
      select: { id: true },
    })

    this.logger.info(
      { outreachId: outreach.id, organizationSlug, textCount },
      'Serve poll draft created',
    )

    return {
      outreachId: outreach.id,
      recipientCount: textCount,
      amountCents: calcTextAmountInCents(textCount),
    }
  }

  // The delivery layer draws a sample from the district's cell-phone pool
  // with the org's opted-out people excluded upstream, then drops repeated
  // phone numbers. Counting the same draw here is what keeps the billed count
  // equal to the delivered one.
  private async resolveSampleCount(
    organization: Organization,
    size: number,
  ): Promise<number> {
    const { totalConstituentsWithCellPhone } =
      await this.contactsService.getDistrictStats(organization)
    const wanted = Math.min(size, totalConstituentsWithCellPhone)
    if (wanted < MIN_SERVE_SMS_RECIPIENTS) return wanted

    const optedOut = await this.smsCreate.resolveOptOutScrub(organization.slug)
    const sample = await this.contactsService.sampleContacts(
      { size: wanted, excludeIds: [...optedOut] },
      organization,
    )
    return new Set(sample.flatMap((person) => person.cellPhone ?? [])).size
  }
}
