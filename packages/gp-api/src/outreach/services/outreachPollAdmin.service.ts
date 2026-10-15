import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  SMS_COMPOSED_MAX_LENGTH,
  type ApprovePollRequest,
  type DenyPollRequest,
  type EditPollRequest,
  type PollApprovalStatus,
  type PollQueueItem,
  type PollReviewDetail,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { QueueProducerService } from 'src/queue/producer/queueProducer.service'
import { MessageGroup, QueueType } from 'src/queue/queue.types'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import {
  OutreachPollExpansion,
  OutreachStatus,
  OutreachType,
  Prisma,
} from '../../generated/prisma'
import { OutreachServePollCreateService } from './outreachServePollCreate.service'

const INITIAL_SEND_SEQ = 1

const pollInclude = {
  pollDetails: { include: { expansions: { orderBy: { sendSeq: 'asc' } } } },
  organization: {
    select: {
      slug: true,
      customPositionName: true,
      positionId: true,
      owner: { select: { firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.OutreachInclude

type PollRow = Prisma.OutreachGetPayload<{ include: typeof pollInclude }>
type PollOrganization = NonNullable<PollRow['organization']>

// A poll is reviewable only between payment and a decision. Payment's claim
// is what moves it to `pending`, so `pending` alone means paid.
const awaitingReviewWhere = (outreachId?: number) =>
  ({
    ...(outreachId === undefined ? {} : { id: outreachId }),
    outreachType: OutreachType.poll,
    status: OutreachStatus.pending,
    approvedAt: null,
    deniedAt: null,
  }) satisfies Prisma.OutreachWhereInput

const queueWhere = (status: PollApprovalStatus): Prisma.OutreachWhereInput => {
  switch (status) {
    case 'awaiting_review':
      return awaitingReviewWhere()
    case 'approved':
      return {
        outreachType: OutreachType.poll,
        approvedAt: { not: null },
        status: { in: [OutreachStatus.pending, OutreachStatus.in_progress] },
      }
    case 'denied':
      return { outreachType: OutreachType.poll, deniedAt: { not: null } }
    case 'sent':
      return {
        outreachType: OutreachType.poll,
        status: OutreachStatus.completed,
      }
    case 'canceled':
      return {
        outreachType: OutreachType.poll,
        status: OutreachStatus.canceled,
      }
  }
}

const approvalStatusOf = (row: {
  status: OutreachStatus | null
  approvedAt: Date | null
  deniedAt: Date | null
}): PollApprovalStatus => {
  if (row.deniedAt) return 'denied'
  if (row.status === OutreachStatus.canceled) return 'canceled'
  if (row.status === OutreachStatus.completed) return 'sent'
  if (row.approvedAt) return 'approved'
  return 'awaiting_review'
}

/**
 * The staff poll review queue (gp-admin over M2M). Nothing about a paid poll
 * sends until an approval here enqueues it; see "Paid polls wait for review"
 * in docs/features/serve-sms.md.
 */
@Injectable()
export class OutreachPollAdminService extends createPrismaBase(
  MODELS.Outreach,
) {
  constructor(
    private readonly queueProducer: QueueProducerService,
    private readonly organizations: OrganizationsService,
    private readonly pollCreate: OutreachServePollCreateService,
  ) {
    super()
  }

  async listQueue(status: PollApprovalStatus): Promise<PollQueueItem[]> {
    const rows = await this.model.findMany({
      where: queueWhere(status),
      include: pollInclude,
      orderBy: {
        createdAt: status === 'awaiting_review' ? 'asc' : 'desc',
      },
    })
    const offices = await this.officesFor(rows)
    return rows.map((row) =>
      this.toQueueItem(row, offices.get(row.organizationSlug ?? '')),
    )
  }

  async getDetail(outreachId: number): Promise<PollReviewDetail> {
    const row = await this.findPoll(outreachId)
    const offices = await this.officesFor([row])
    return this.toDetail(row, offices.get(row.organizationSlug ?? ''))
  }

  /**
   * Claims the poll, then enqueues its first send. The claim is the gate: of
   * two concurrent approvals exactly one matches the `approvedAt IS NULL`
   * update, and only that one enqueues. Status stays `pending`, because the
   * delivery layer's own claim moves `pending` to `in_progress` and refuses
   * any other status.
   */
  async approve(
    outreachId: number,
    input: ApprovePollRequest,
  ): Promise<PollQueueItem> {
    if (input.expansionId) {
      throw new BadRequestException('Expansion approval is not available yet')
    }

    const claimedAt = new Date()
    const claimed = await this.model.updateMany({
      where: awaitingReviewWhere(outreachId),
      data: { approvedAt: claimedAt, approvedBy: input.approvedBy },
    })
    if (claimed.count === 0) {
      await this.throwNotReviewable(outreachId)
    }

    try {
      await this.queueProducer.sendMessage(
        {
          type: QueueType.OUTREACH_TEXT_SEND,
          data: { outreachId, sendSeq: INITIAL_SEND_SEQ },
        },
        `${MessageGroup.outreachTextSend}-${outreachId}`,
        {
          throwOnError: true,
          deduplicationId:
            `${QueueType.OUTREACH_TEXT_SEND}-${outreachId}-` +
            `${INITIAL_SEND_SEQ}`,
        },
      )
    } catch (error) {
      // Scoped to the timestamp this call wrote, so it can only ever clear
      // its own claim, never a later approver's.
      await this.model.updateMany({
        where: { id: outreachId, approvedAt: claimedAt },
        data: { approvedAt: null, approvedBy: null },
      })
      this.logger.error(
        { err: error, outreachId },
        'Poll approval could not enqueue the send; approval reverted',
      )
      throw error
    }

    this.logger.info(
      { outreachId, approvedBy: input.approvedBy },
      'Poll approved and its first send enqueued',
    )
    const row = await this.findPoll(outreachId)
    const offices = await this.officesFor([row])
    return this.toQueueItem(row, offices.get(row.organizationSlug ?? ''))
  }

  // No refund and no notice to the official, the same as the SMS console's
  // deny. Terminal: a denied poll does not come back to the queue.
  async deny(
    outreachId: number,
    input: DenyPollRequest,
  ): Promise<PollQueueItem> {
    const denied = await this.model.updateMany({
      where: awaitingReviewWhere(outreachId),
      data: {
        status: OutreachStatus.denied,
        deniedAt: new Date(),
        deniedBy: input.deniedBy,
        deniedReason: input.reason,
      },
    })
    if (denied.count === 0) {
      await this.throwNotReviewable(outreachId)
    }

    this.logger.info({ outreachId, deniedBy: input.deniedBy }, 'Poll denied')
    const row = await this.findPoll(outreachId)
    const offices = await this.officesFor([row])
    return this.toQueueItem(row, offices.get(row.organizationSlug ?? ''))
  }

  async edit(
    outreachId: number,
    input: EditPollRequest,
  ): Promise<PollReviewDetail> {
    const row = await this.findPoll(outreachId)
    if (!row.organization) {
      throw new NotFoundException('Poll not found')
    }
    // Not best-effort, unlike the queue: a failed office lookup here would
    // silently drop the office from the text that sends.
    const office = await this.resolveOffice(row.organization)
    const message = this.pollCreate.composeMessage(
      input.question,
      row.organization.owner,
      office,
    )
    if (message.length > SMS_COMPOSED_MAX_LENGTH) {
      throw new BadRequestException(
        `This poll text is ${message.length} characters, over the ` +
          `${SMS_COMPOSED_MAX_LENGTH} limit. Shorten the question.`,
      )
    }

    const edited = await this.model.updateMany({
      where: awaitingReviewWhere(outreachId),
      data: {
        message,
        adminEditedAt: new Date(),
        adminEditedBy: input.editedBy,
      },
    })
    if (edited.count === 0) {
      await this.throwNotReviewable(outreachId)
    }

    this.logger.info(
      { outreachId, editedBy: input.editedBy },
      'Poll question edited by staff',
    )
    return this.toDetail(await this.findPoll(outreachId), office)
  }

  private async findPoll(outreachId: number): Promise<PollRow> {
    const row = await this.model.findFirst({
      where: { id: outreachId, outreachType: OutreachType.poll },
      include: pollInclude,
    })
    if (!row) {
      throw new NotFoundException('Poll not found')
    }
    return row
  }

  private async throwNotReviewable(outreachId: number): Promise<never> {
    await this.findPoll(outreachId)
    throw new ConflictException('This poll is not awaiting review any more')
  }

  private resolveOffice(organization: PollOrganization): Promise<string> {
    return this.organizations
      .resolvePositionContext({
        customPositionName: organization.customPositionName,
        positionId: organization.positionId,
      })
      .then(({ positionName }) => positionName ?? '')
  }

  // One office lookup per organization. Best-effort: a failure only leaves
  // `question` null on that org's rows.
  private async officesFor(
    rows: PollRow[],
  ): Promise<Map<string, string | null>> {
    const organizations = new Map<string, PollOrganization>()
    for (const row of rows) {
      if (row.organization) {
        organizations.set(row.organization.slug, row.organization)
      }
    }
    const entries = await Promise.all(
      [...organizations.values()].map(
        async (organization): Promise<[string, string | null]> => {
          try {
            return [organization.slug, await this.resolveOffice(organization)]
          } catch (err) {
            this.logger.warn(
              { err, organizationSlug: organization.slug },
              'Poll queue office lookup failed; question left blank',
            )
            return [organization.slug, null]
          }
        },
      ),
    )
    return new Map(entries)
  }

  // The question is not stored on its own; it is the middle of the composed
  // message. Composing around a marker gives the exact prefix and suffix the
  // composer would write, so the two cannot drift apart.
  private questionOf(row: PollRow, office: string | null | undefined) {
    if (!row.message || !row.organization || office == null) return null
    const marker = '\u0000'
    const [prefix, suffix] = this.pollCreate
      .composeMessage(marker, row.organization.owner, office)
      .split(marker)
    const { message } = row
    if (
      message.length <= prefix.length + suffix.length ||
      !message.startsWith(prefix) ||
      !message.endsWith(suffix)
    ) {
      return null
    }
    return message.slice(prefix.length, message.length - suffix.length)
  }

  private toQueueItem(
    row: PollRow,
    office: string | null | undefined,
  ): PollQueueItem {
    return {
      kind: 'poll',
      outreachId: row.id,
      expansionId: null,
      organizationSlug: row.organizationSlug ?? '',
      name: row.name,
      question: this.questionOf(row, office),
      topic: row.pollDetails?.topic ?? 'custom',
      textCount: row.textCount,
      sendAt: row.scheduledLocalDate
        ? new Date(`${row.scheduledLocalDate}T00:00:00Z`)
        : null,
      createdAt: row.createdAt,
      approvalStatus: approvalStatusOf(row),
      approvedAt: row.approvedAt,
      approvedBy: row.approvedBy,
      deniedAt: row.deniedAt,
      deniedBy: row.deniedBy,
      deniedReason: row.deniedReason,
    }
  }

  private toExpansionItem(
    row: PollRow,
    expansion: OutreachPollExpansion,
    question: string | null,
  ): PollQueueItem {
    return {
      kind: 'expansion',
      outreachId: row.id,
      expansionId: expansion.id,
      organizationSlug: row.organizationSlug ?? '',
      name: row.name,
      question,
      topic: row.pollDetails?.topic ?? 'custom',
      textCount: expansion.textCount,
      sendAt: null,
      createdAt: expansion.createdAt,
      approvalStatus: approvalStatusOf(expansion),
      approvedAt: expansion.approvedAt,
      approvedBy: expansion.approvedBy,
      deniedAt: expansion.deniedAt,
      deniedBy: expansion.deniedBy,
      deniedReason: expansion.deniedReason,
    }
  }

  private toDetail(
    row: PollRow,
    office: string | null | undefined,
  ): PollReviewDetail {
    const item = this.toQueueItem(row, office)
    if (!row.pollDetails) {
      throw new NotFoundException('Poll details not found')
    }
    return {
      item,
      message: row.message,
      imageUrl: row.imageUrl,
      tone: row.pollDetails.tone,
      audienceKind: row.pollDetails.audienceKind,
      biasOverridden: row.pollDetails.biasOverridden,
      expansions: row.pollDetails.expansions.map((expansion) =>
        this.toExpansionItem(row, expansion, item.question),
      ),
    }
  }
}
