import { Injectable } from '@nestjs/common'
import { OutreachType, PollAudienceKind } from '@/generated/prisma'
import type { JobRun } from '@/jobs/jobs.registry'
import { isUndrawnSample } from '@/priorities/util/roundTwo.util'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { OutreachServePollExpansionService } from './outreachServePollExpansion.service'
import {
  OutreachTextDeliveryService,
  TextDeliveryAudience,
} from './outreachTextDelivery.service'
import { OutreachTextSendFundingService } from './outreachTextSendFunding.service'

const INITIAL_POLL_SEND_SEQ = 1

// The outreachTextSend job's payload, as its schema in jobs.registry.ts
// parses it. Spelled out here because the registry imports this service.
type OutreachTextSendJobData = {
  outreachId: number
  sendSeq: number
  agentHandoff?: {
    mode: 'shadow' | 'auto'
    sendAt: string
    timeZone: string
  }
}

/**
 * The outreachTextSend job's worker: the outbound half of the shared text
 * delivery layer. Sent by the Serve SMS purchase handler, the poll approval,
 * a managed civic panel wave and a priority's round 2 draw.
 *
 * The job carries the envelope id and nothing else, so the product-shaped
 * half of `requestSend`'s input (which saved list, what message, which day)
 * is read back off the row here. That is deliberate: the delivery layer
 * takes an audience spec rather than an outreach id precisely so polls can
 * hand it a random sample without the layer learning what a poll is.
 *
 * Every refusal below completes the job rather than retrying. A row that is
 * missing, or that has no saved list / message / date, is in exactly the
 * same state on every attempt, so retrying only ends in a dead letter for a
 * job nothing can act on. Real faults (S3, Slack, the database) still throw
 * out of `requestSend` and retry; the send is idempotent under that.
 */
@Injectable()
export class OutreachTextSendJobService extends createPrismaBase(
  MODELS.Outreach,
) {
  constructor(
    private readonly outreachTextDelivery: OutreachTextDeliveryService,
    private readonly pollExpansion: OutreachServePollExpansionService,
    private readonly textSendFunding: OutreachTextSendFundingService,
  ) {
    super()
  }

  async send(job: JobRun<OutreachTextSendJobData>): Promise<void> {
    const { outreachId, sendSeq, agentHandoff } = job.data
    const outreach = await this.model.findUnique({
      where: { id: outreachId },
      select: {
        outreachType: true,
        approvedAt: true,
        message: true,
        imageUrl: true,
        scheduledLocalDate: true,
        voterFileFilterId: true,
        billableTextCount: true,
        textCount: true,
        pollDetails: { select: { audienceKind: true } },
        voterFileFilter: { select: { sampleSize: true, sampledAt: true } },
      },
    })

    if (!outreach) {
      this.logger.error(
        { outreachId, sendSeq },
        'outreachTextSend: no such outreach; completing, retrying cannot help',
      )
      return
    }

    const isPoll = outreach.outreachType === OutreachType.poll
    if (isPoll && !outreach.approvedAt) {
      this.logger.error(
        { outreachId, sendSeq },
        'outreachTextSend: a poll reached delivery without approval, which ' +
          'should never happen; completing without sending',
      )
      return
    }
    // A round 2 text is sent by its draw, never before: its list holds
    // nobody until then.
    if (isUndrawnSample(outreach.voterFileFilter)) {
      this.logger.error(
        { outreachId, sendSeq },
        'outreachTextSend: a round 2 text reached delivery before its draw, ' +
          'which should never happen; completing without sending',
      )
      return
    }
    const expansion =
      isPoll && sendSeq > INITIAL_POLL_SEND_SEQ
        ? await this.pollExpansion.resolveDelivery(outreachId, sendSeq)
        : null
    if (isPoll && sendSeq > INITIAL_POLL_SEND_SEQ && !expansion) {
      this.logger.error(
        { outreachId, sendSeq },
        'outreachTextSend: an expansion reached delivery without an ' +
          'approved row, which should never happen; completing without sending',
      )
      return
    }

    // Paid at checkout, or a live managed civic panel wave; anything else is
    // refused before an audience is resolved. `requestSend` repeats this in
    // its own claim.
    const funding = await this.textSendFunding.check(outreachId, sendSeq)
    if (!funding.funded && funding.reason !== 'not_sendable') {
      await this.textSendFunding.reportRefusal(
        outreachId,
        sendSeq,
        funding.reason,
      )
      return
    }

    const {
      message,
      imageUrl,
      scheduledLocalDate,
      voterFileFilterId,
      billableTextCount,
      textCount,
    } = outreach

    const isSamplePoll =
      isPoll && outreach.pollDetails?.audienceKind === PollAudienceKind.sample
    const audience: TextDeliveryAudience | null = expansion
      ? {
          kind: 'sample',
          size: expansion.textCount,
          excludePersonIds: expansion.excludePersonIds,
        }
      : isSamplePoll
        ? textCount
          ? { kind: 'sample', size: textCount }
          : null
        : voterFileFilterId
          ? { kind: 'savedFilter', voterFileFilterId }
          : null

    if (!message || !scheduledLocalDate || !audience) {
      this.logger.error(
        {
          outreachId,
          sendSeq,
          hasMessage: Boolean(message),
          hasScheduledLocalDate: Boolean(scheduledLocalDate),
          hasVoterFileFilterId: Boolean(voterFileFilterId),
        },
        'outreachTextSend: the row is missing what a send needs; ' +
          'completing, retrying cannot help',
      )
      return
    }

    const result = await this.outreachTextDelivery.requestSend({
      outreachId,
      sendSeq,
      audience,
      message,
      imageUrl: imageUrl ?? undefined,
      scheduledLocalDate,
      // The audience the official authorized, which is `textCount` — NOT
      // `billableTextCount`. The latter is what Stripe was charged, and
      // `markFreeTextsConsumed` sets it to textCount minus the free-text
      // allowance, so a send fully covered by the offer carries 0. Capping
      // on that would truncate a legitimate send to nobody and hand
      // fulfilment an empty file.
      paidRecipientCap: expansion?.textCount ?? textCount ?? undefined,
      agentHandoff: agentHandoff && {
        ...agentHandoff,
        sendAt: new Date(agentHandoff.sendAt),
      },
      signal: job.signal,
    })

    // `terminalReason` means nothing was handed off and nothing ever will be.
    // `requestSend` returns rather than throwing for exactly these cases,
    // because a retry would hit the same wall: complete instead of spending
    // every attempt on the way to a dead letter.
    if (result.terminalReason) {
      this.logger.warn(
        {
          outreachId,
          sendSeq,
          sendKey: result.sendKey,
          terminalReason: result.terminalReason,
        },
        result.terminalReason === 'send_failed'
          ? 'outreachTextSend: nothing was sent — the send cannot be made ' +
              'at all; the row is now failed'
          : result.terminalReason === 'unfunded'
            ? 'outreachTextSend: nothing was sent — the send was neither ' +
              'paid nor a live managed panel wave'
            : 'outreachTextSend: nothing was sent — the outreach was not ' +
              'pending, or a previous attempt already handed off this send',
      )
      return
    }

    this.logger.info(
      {
        outreachId,
        sendSeq,
        sendKey: result.sendKey,
        recipientCount: result.recipientCount,
        excludedOptedOutCount: result.excludedOptedOutCount,
        excludedDuplicateCount: result.excludedDuplicateCount,
        // What Stripe actually took, against what fulfilment actually got.
        // The row is priced at checkout and the audience is re-scrubbed at
        // send, so anyone who opts out in between was paid for and not
        // texted. Logged rather than corrected: `billableTextCount` is the
        // record of what was charged and must keep saying so, and the
        // delivered set is already durable as OutreachTextRecipient rows.
        // Whether a delta earns a refund is a product decision, not a
        // silent one — this line is what makes it countable.
        billableTextCount,
        overBilledBy:
          billableTextCount === null
            ? null
            : Math.max(0, billableTextCount - result.recipientCount),
      },
      'outreachTextSend: handed off to fulfilment',
    )
  }
}
