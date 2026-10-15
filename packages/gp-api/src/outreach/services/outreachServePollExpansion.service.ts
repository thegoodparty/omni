import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  ServePollExpansionCreate,
  ServePollExpansionCreateResponse,
} from '@goodparty_org/contracts'
import { ContactsService } from '@/contacts/services/contacts.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { calcTextAmountInCents } from '@/shared/util/textPricing.util'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import {
  ElectedOffice,
  OutreachStatus,
  OutreachType,
} from '../../generated/prisma'
import { OutreachServeSmsCreateService } from './outreachServeSmsCreate.service'

const FIRST_SEND_SEQ = 1

// people-api rejects an id filter above this, and the delivery layer sends the
// asked-already set and the opt-out scrub upstream as one.
const MAX_EXCLUDED_PERSON_IDS = 100_000

const OPEN_EXPANSION_MESSAGE =
  'Another request to gather more feedback on this poll is still waiting. ' +
  'Finish or wait for it first.'

const EXPANDABLE_STATUSES: OutreachStatus[] = [
  OutreachStatus.in_progress,
  OutreachStatus.completed,
]

/**
 * "Gather more feedback": a follow-on send on a poll that already went out,
 * to people the poll has not asked yet. Each is an `OutreachPollExpansion`
 * with its own payment and its own approval, `sendSeq` 2 and up. The first
 * send stays the spine's; nothing here touches the spine's status or approval.
 */
@Injectable()
export class OutreachServePollExpansionService extends createPrismaBase(
  MODELS.OutreachPollExpansion,
) {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly organizationsService: OrganizationsService,
    private readonly smsCreate: OutreachServeSmsCreateService,
  ) {
    super()
  }

  async createExpansion(
    electedOffice: Pick<ElectedOffice, 'organizationSlug'>,
    outreachId: number,
    input: ServePollExpansionCreate,
  ): Promise<ServePollExpansionCreateResponse> {
    const { organizationSlug } = electedOffice

    const poll = await this.client.outreach.findFirst({
      where: {
        id: outreachId,
        organizationSlug,
        campaignId: null,
        outreachType: OutreachType.poll,
      },
      select: { status: true },
    })
    if (!poll) {
      throw new NotFoundException('Poll not found')
    }
    if (!poll.status || !EXPANDABLE_STATUSES.includes(poll.status)) {
      throw new ConflictException(
        'This poll cannot gather more feedback until it has been sent',
      )
    }

    const open = await this.model.findFirst({
      where: { outreachId, approvedAt: null, deniedAt: null },
      select: { id: true },
    })
    if (open) {
      throw new ConflictException(OPEN_EXPANSION_MESSAGE)
    }

    const organization = await this.organizationsService.findFirst({
      where: { slug: organizationSlug },
    })
    if (!organization) {
      throw new BadRequestException('Organization not found')
    }

    const [optedOut, asked] = await Promise.all([
      this.smsCreate.resolveOptOutScrub(organizationSlug),
      this.askedPersonIds(outreachId),
    ])
    const excludeIds = [...new Set([...optedOut, ...asked])]
    if (excludeIds.length > MAX_EXCLUDED_PERSON_IDS) {
      throw new BadRequestException(
        'This poll has reached too many people to gather more feedback.',
      )
    }

    // Same arithmetic as the delivery layer's clamp and `samplePeople`, so the
    // count quoted here and the pool the send draws from cannot disagree.
    const { totalConstituentsWithCellPhone } =
      await this.contactsService.getDistrictStats(organization)
    const pool =
      totalConstituentsWithCellPhone -
      Math.min(excludeIds.length, totalConstituentsWithCellPhone)
    if (pool < 1) {
      throw new BadRequestException('Everyone reachable has been asked.')
    }

    // Counting the same draw the send makes is what keeps the billed count
    // equal to the delivered one: two people on one number are one text.
    const sample = await this.contactsService.sampleContacts(
      { size: Math.min(input.size, pool), excludeIds },
      organization,
    )
    const textCount = new Set(
      sample.flatMap((person) => person.cellPhone ?? []),
    ).size
    if (textCount < 1) {
      throw new BadRequestException('Everyone reachable has been asked.')
    }

    // The open check above ran before the slow pool read, so it is repeated
    // under a per-poll lock: two creates cannot both pass it and then take
    // consecutive sendSeqs.
    const { expansion, sendSeq } = await this.client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`poll_expansion:${outreachId}`}))`
        const stillOpen = await tx.outreachPollExpansion.findFirst({
          where: { outreachId, approvedAt: null, deniedAt: null },
          select: { id: true },
        })
        if (stillOpen) {
          throw new ConflictException(OPEN_EXPANSION_MESSAGE)
        }
        const { _max } = await tx.outreachPollExpansion.aggregate({
          where: { outreachId },
          _max: { sendSeq: true },
        })
        const next = (_max.sendSeq ?? FIRST_SEND_SEQ) + 1
        const created = await tx.outreachPollExpansion.create({
          data: {
            outreachId,
            sendSeq: next,
            textCount,
            status: OutreachStatus.pending_payment,
          },
          select: { id: true },
        })
        return { expansion: created, sendSeq: next }
      },
    )

    this.logger.info(
      { outreachId, expansionId: expansion.id, sendSeq, textCount },
      'Serve poll expansion draft created',
    )

    return {
      expansionId: expansion.id,
      recipientCount: textCount,
      amountCents: calcTextAmountInCents(textCount),
    }
  }

  /**
   * What the consumer needs to deliver an approved expansion: how many people
   * to draw, and everyone this outreach has already texted so none of them is
   * drawn again. Null when the expansion is missing or was never approved, so
   * the consumer acks rather than retries a message nothing can act on.
   */
  async resolveDelivery(
    outreachId: number,
    sendSeq: number,
  ): Promise<{ textCount: number; excludePersonIds: string[] } | null> {
    const expansion = await this.model.findUnique({
      where: { outreachId_sendSeq: { outreachId, sendSeq } },
      select: { textCount: true, approvedAt: true },
    })
    if (!expansion?.approvedAt) return null
    return {
      textCount: expansion.textCount,
      excludePersonIds: [...(await this.askedPersonIds(outreachId))],
    }
  }

  private async askedPersonIds(outreachId: number): Promise<Set<string>> {
    const rows = await this.client.outreachTextRecipient.findMany({
      where: { outreachId },
      select: { personId: true },
    })
    return new Set(rows.map(({ personId }) => personId))
  }
}
