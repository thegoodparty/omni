import { Message } from '@aws-sdk/client-sqs'
import { Injectable } from '@nestjs/common'
import {
  OutreachType,
  Poll,
  PollAudienceKind,
  PollIndividualMessageSender,
  Prisma,
} from '../../generated/prisma'
import { isPrismaError } from 'src/prisma/util/prismaErrors.util'
import { SqsConsumerEventHandler, SqsMessageHandler } from '@ssut/nestjs-sqs'
import { format, isBefore } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import parseCsv from 'neat-csv'
import { serializeError } from 'serialize-error'
import { PersonOutput } from 'src/contacts/schemas/person.schema'
import { SampleContacts } from 'src/contacts/schemas/sampleContacts.schema'
import { ContactsService } from 'src/contacts/services/contacts.service'
import { ElectedOfficeService } from 'src/electedOffice/services/electedOffice.service'
import { CampaignStrategyService } from 'src/campaignStrategy/services/campaignStrategy.service'
import { OrdinanceQualityLoopService } from 'src/ordinances/services/ordinanceQualityLoop.service'
import { PollsService } from 'src/polls/services/polls.service'
import { sendTevynAPIPollMessage } from 'src/polls/utils/polls.utils'
import { UsersService } from 'src/users/services/users.service'
import { S3Service } from 'src/vendors/aws/services/s3.service'
import { SlackService } from 'src/vendors/slack/services/slack.service'
import { CampaignTcrComplianceService } from '../../campaigns/tcrCompliance/services/campaignTcrCompliance.service'
import { csvEscape } from '../../shared/util/csv.util'
import { normalizePhoneNumber } from '../../shared/util/strings.util'
import { ForwardEmailDomainResponse } from '../../vendors/forwardEmail/forwardEmail.types'
import { DomainsService } from '../../websites/services/domains.service'
import {
  AgenticComplianceKickoffMessageSchema,
  CampaignPlanCompleteMessageSchema,
  AgentExperimentResultSchema,
  DomainEmailForwardingMessage,
  CvStatusPollMessageSchema,
  ExtractChatAttachmentMessageSchema,
  Nightly10DlcReportMessageSchema,
  PeerlyVendorEscalationMessageSchema,
  CampaignStoryCompletedMessageSchema,
  OcrAttachmentMessageSchema,
  OrdinanceQualityLoopMessageSchema,
  OutreachTextSendEventSchema,
  P2pPhoneListBuildMessageSchema,
  EmailSendPrepareMessageSchema,
  EmailInboundMessageSchema,
  PollAnalysisCompleteEventSchema,
  PollCreationEvent,
  PollCreationEventSchema,
  PollExpansionEvent,
  PollExpansionEventSchema,
  OutreachTextSendEvent,
  QueueMessage,
  QueueType,
  SqsConsumerErrorEventName,
  TcrComplianceStatusCheckMessage,
} from '../queue.types'
import { Nightly10DlcReportService } from '../../campaigns/tcrCompliance/services/nightly10DlcReport.service'
import { CvStatusPollService } from '../../campaigns/tcrCompliance/services/cvStatusPoll.service'
import { PinoLogger } from 'nestjs-pino'
import { OutreachService } from '@/outreach/services/outreach.service'
import { OutreachServePollExpansionService } from '@/outreach/services/outreachServePollExpansion.service'
import {
  OutreachTextDeliveryService,
  TextDeliveryAudience,
} from '@/outreach/services/outreachTextDelivery.service'
import { OutreachTextSendFundingService } from '@/outreach/services/outreachTextSendFunding.service'
import { P2pPhoneListUploadService } from '@/vendors/peerly/services/p2pPhoneListUpload.service'
import {
  FeedbackSynthesisCompleteEventSchema,
  PanelRepliesUploadedEventSchema,
} from '@goodparty_org/contracts'
import { isUndrawnSample } from '@/priorities/util/roundTwo.util'
import { EmailOutreachQueueService } from '@/emailOutreach/services/emailOutreachQueue.service'
import { JobsService } from '@/jobs/jobs.service'

const INITIAL_POLL_SEND_SEQ = 1

@Injectable()
export class QueueConsumerService {
  constructor(
    private readonly slackService: SlackService,
    private readonly tcrComplianceService: CampaignTcrComplianceService,
    private readonly domainsService: DomainsService,
    private readonly pollsService: PollsService,
    private readonly electedOfficeService: ElectedOfficeService,
    private readonly contactsService: ContactsService,
    private readonly s3Service: S3Service,
    private readonly usersService: UsersService,
    private readonly nightly10DlcReport: Nightly10DlcReportService,
    private readonly cvStatusPollService: CvStatusPollService,
    private readonly campaignStrategy: CampaignStrategyService,
    private readonly ordinanceQualityLoop: OrdinanceQualityLoopService,
    private readonly outreachService: OutreachService,
    private readonly outreachTextDelivery: OutreachTextDeliveryService,
    private readonly pollExpansion: OutreachServePollExpansionService,
    private readonly p2pPhoneListUpload: P2pPhoneListUploadService,
    private readonly logger: PinoLogger,
    private readonly textSendFunding: OutreachTextSendFundingService,
    private readonly emailOutreachQueue: EmailOutreachQueueService,
    private readonly jobs: JobsService,
  ) {
    this.logger.setContext(QueueConsumerService.name)
  }

  private logConsumerError = (
    eventName: SqsConsumerErrorEventName,
    error: Error,
    message: Message | Message[] | undefined,
  ) => {
    this.logger.error(
      { error: serializeError(error), message },
      `SQS consumer ${eventName}`,
    )
  }

  @SqsConsumerEventHandler(
    process.env.SQS_QUEUE || '',
    SqsConsumerErrorEventName.ERROR,
  )
  onError(error: Error, message: Message | Message[] | undefined) {
    this.logConsumerError(SqsConsumerErrorEventName.ERROR, error, message)
  }

  @SqsConsumerEventHandler(
    process.env.SQS_QUEUE || '',
    SqsConsumerErrorEventName.PROCESSING_ERROR,
  )
  onProcessingError(error: Error, message: Message) {
    this.logConsumerError(
      SqsConsumerErrorEventName.PROCESSING_ERROR,
      error,
      message,
    )
  }

  @SqsConsumerEventHandler(
    process.env.SQS_QUEUE || '',
    SqsConsumerErrorEventName.TIMEOUT_ERROR,
  )
  onTimeoutError(error: Error, message: Message) {
    this.logConsumerError(
      SqsConsumerErrorEventName.TIMEOUT_ERROR,
      error,
      message,
    )
  }

  @SqsMessageHandler(process.env.SQS_QUEUE || '', false)
  async handleMessage(message: Message) {
    const shouldRequeue = await this.handleMessageAndMaybeRequeue(message)

    return shouldRequeue
      ? // Return a rejected promise if requeue is needed without throwing an error
        Promise.reject('Requeuing message without stopping the process')
      : true // Return true to delete the message from the queue
  }

  // Function to process message and decide if requeue is necessary
  async handleMessageAndMaybeRequeue(message: Message): Promise<boolean> {
    try {
      this.logger.debug(message, 'Processing queue message: ')
      const success = await this.processMessage(message)
      return !success // Invert: true (success) becomes false (don't requeue)
    } catch (error) {
      this.logger.error({
        message,
        error: serializeError(error),
        msg: 'Message processing failed, will requeue',
      })
      return true // Indicate that we should requeue
    }
  }

  private legacyShouldRequeueError(error: Error): boolean {
    // Don't retry Prisma errors for missing records - these are permanent failures
    // P2025: Record not found; P2002: Unique constraint violation
    if (isPrismaError(error, 'P2025') || isPrismaError(error, 'P2002')) {
      return false
    }

    // Don't retry validation errors or other client errors
    if (
      error.message.includes('validation') ||
      error.message.includes('Invalid')
    ) {
      return false
    }

    // Retry network errors, timeouts, and other temporary failures
    return true
  }

  private withLegacyErrorSwallowing = async (
    message: Message,
    queueMessageType: QueueType,
    fn: () => Promise<boolean>,
  ) => {
    try {
      return await fn()
    } catch (error) {
      const shouldRequeue =
        error instanceof Error && this.legacyShouldRequeueError(error)
      if (shouldRequeue) {
        return false // Requeue the message
      }

      this.logger.error(
        { error: serializeError(error), queueMessageType, message },
        'Message processing failed with non-retryable error, discarding message',
      )

      return true // Don't requeue, delete the message
    }
  }

  // TODO: Each message type should be assigned it's own SQS queue allowing each
  //  module/service to listen to and handle it's own messages.  Or, in the very
  //  least, at _least_ delineate and abstract the message handling based on the
  //  MessageGroup for each message. However, that would be less desirable due
  //  to the requirement to still have a single queue consumer/poller.
  //
  //  This also limits us to using features that are only available for FIFO
  //  queues, complicating implementations. i.e. Long-polling semiphores are
  //  complicated since FIFO queues do not support the delaySeconds option field.
  //
  //  Furthermore, the message types here are not type-safe and could be
  //  misinterpreted by other modules/services.
  //
  //  https://goodparty.atlassian.net/browse/WEB-4518
  async processMessage(message: Message): Promise<boolean> {
    if (!message || !message.Body) {
      return true // Delete invalid messages from queue
    }

    // JSON.parse returns unknown — no way to infer parsed shape at compile time
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const queueMessage = JSON.parse(message.Body) as QueueMessage
    this.logger.info(`processing queue message type ${queueMessage.type}`)

    switch (queueMessage.type) {
      case QueueType.TCR_COMPLIANCE_STATUS_CHECK:
        this.logger.info('received tcrComplianceStatusCheck message')
        return await this.withLegacyErrorSwallowing(
          message,
          queueMessage.type,
          () => this.handleTcrComplianceCheckMessage(queueMessage.data),
        )
      case QueueType.DOMAIN_EMAIL_FORWARDING:
        this.logger.info('received domainEmailForwarding message')
        return await this.withLegacyErrorSwallowing(
          message,
          queueMessage.type,
          () => this.handleDomainEmailForwardingMessage(queueMessage.data),
        )
      // pollAnalysisComplete, feedbackSynthesisComplete,
      // panelRepliesUploaded, campaignPlanComplete and agentExperimentResult
      // come from other systems. Each is checked and forwarded to its
      // pg-boss job, which does the work. The job is keyed by the SQS
      // MessageId, so a redelivered message queues nothing new, and grouped
      // as its sender groups it on SQS.
      case QueueType.POLL_ANALYSIS_COMPLETE: {
        const { data } = PollAnalysisCompleteEventSchema.parse(queueMessage)
        await this.jobs.sendMany('pollAnalysisComplete', [
          { data, key: message.MessageId!, group: data.pollId },
        ])
        return true
      }
      case QueueType.FEEDBACK_SYNTHESIS_COMPLETE: {
        // A malformed event can never become valid, and requeueing it would
        // hold its FIFO group until the DLQ limit. Ack-drop it, logged; the
        // run it names is failed by the stale-run sweep.
        const event =
          FeedbackSynthesisCompleteEventSchema.safeParse(queueMessage)
        if (!event.success) {
          this.logger.error(
            { messageId: message.MessageId, error: event.error },
            'malformed feedbackSynthesisComplete message, discarding',
          )
          return true
        }
        const { data } = event.data
        await this.jobs.sendMany('feedbackSynthesisComplete', [
          { data, key: message.MessageId!, group: data.sourceId },
        ])
        return true
      }
      case QueueType.PANEL_REPLIES_UPLOADED: {
        const event = PanelRepliesUploadedEventSchema.safeParse(
          queueMessage.data,
        )
        if (!event.success) {
          this.logger.error(
            { messageId: message.MessageId, error: event.error },
            'malformed panelRepliesUploaded message, discarding',
          )
          return true
        }
        // EventBridge puts every upload in one SQS group; one export at a
        // time is the ordering that matters.
        await this.jobs.sendMany('panelRepliesUploaded', [
          { data: event.data, key: message.MessageId!, group: event.data.key },
        ])
        return true
      }
      case QueueType.POLL_CREATION:
        this.logger.info('received pollCreation message')
        const pollCreationEvent = PollCreationEventSchema.parse(queueMessage)
        return await this.handlePollCreation(
          pollCreationEvent,
          message.MessageId!,
        )
      case QueueType.POLL_EXPANSION:
        this.logger.info('received pollExpansion message')
        const pollExpansionEvent = PollExpansionEventSchema.parse(queueMessage)
        return await this.handlePollExpansion(
          pollExpansionEvent,
          message.MessageId!,
        )
      case QueueType.CAMPAIGN_PLAN_COMPLETE: {
        const plan = CampaignPlanCompleteMessageSchema.safeParse(
          queueMessage.data,
        )
        if (!plan.success) {
          this.logger.error(
            { messageId: message.MessageId, error: plan.error },
            'malformed campaignPlanComplete message, discarding',
          )
          return true
        }
        await this.jobs.sendMany('campaignPlanComplete', [
          {
            data: plan.data,
            key: message.MessageId!,
            group: String(plan.data.campaignId),
          },
        ])
        return true
      }
      case QueueType.CAMPAIGN_STORY_COMPLETED:
        this.logger.info('received campaignStoryCompleted message')
        return await this.withLegacyErrorSwallowing(
          message,
          queueMessage.type,
          async () => {
            const { campaignId } = CampaignStoryCompletedMessageSchema.parse(
              queueMessage.data,
            )
            await this.campaignStrategy.regenerateOnStoryComplete(campaignId)
            return true
          },
        )
      case QueueType.NIGHTLY_10DLC_REPORT:
        this.logger.info('received nightly10DlcReport message')
        return await this.withLegacyErrorSwallowing(
          message,
          queueMessage.type,
          async () => {
            const reportData = Nightly10DlcReportMessageSchema.parse(
              queueMessage.data,
            )
            return await this.nightly10DlcReport.handleNightlyReport(reportData)
          },
        )
      case QueueType.PEERLY_VENDOR_ESCALATION:
        this.logger.info('received peerlyVendorEscalation message')
        return await this.withLegacyErrorSwallowing(
          message,
          queueMessage.type,
          async () =>
            this.nightly10DlcReport.handleVendorEscalations(
              PeerlyVendorEscalationMessageSchema.parse(queueMessage.data),
            ),
        )
      case QueueType.CV_STATUS_POLL:
        this.logger.info('received cvStatusPoll message')
        // Acks immediately — the paced scan runs detached because it outlives
        // the SQS visibility timeout (see CvStatusPollService). Wrapped so a
        // malformed payload discards instead of redelivering forever.
        return await this.withLegacyErrorSwallowing(
          message,
          queueMessage.type,
          async () =>
            this.cvStatusPollService.handleCvStatusPoll(
              CvStatusPollMessageSchema.parse(queueMessage.data),
            ),
        )
      case QueueType.AGENT_EXPERIMENT_RESULT: {
        const data = AgentExperimentResultSchema.parse(queueMessage.data)
        await this.jobs.sendMany('agentExperimentResult', [
          { data, key: message.MessageId!, group: data.runId },
        ])
        return true
      }
      case QueueType.AGENTIC_COMPLIANCE_KICKOFF:
        this.logger.info('received agenticComplianceKickoff message')
        return await this.withLegacyErrorSwallowing(
          message,
          queueMessage.type,
          async () => {
            const kickoff = AgenticComplianceKickoffMessageSchema.parse(
              queueMessage.data,
            )
            await this.tcrComplianceService.handleAgenticKickoff(kickoff)
            return true
          },
        )
      // ocrAttachment runs on pg-boss now. This hands a message the previous
      // release left in SQS to it; remove the case once a release has
      // shipped.
      case QueueType.OCR_ATTACHMENT: {
        const { attachmentId } = OcrAttachmentMessageSchema.parse(
          queueMessage.data,
        )
        await this.jobs.send(
          'ocrAttachment',
          { attachmentId },
          { group: attachmentId },
        )
        return true
      }
      case QueueType.ORDINANCE_QUALITY_LOOP: {
        // Parse failure is a poison message — it can never become valid, and
        // requeueing would block the ordinance's FIFO group until the DLQ
        // limit. Ack-drop it. handleStep errors still escape to the requeue
        // path: position resolution makes redelivery of a valid step safe.
        const step = OrdinanceQualityLoopMessageSchema.safeParse(
          queueMessage.data,
        )
        if (!step.success) {
          this.logger.error(
            { messageId: message.MessageId, error: step.error },
            'malformed ordinance quality loop message, discarding',
          )
          return true
        }
        return await this.ordinanceQualityLoop.handleStep(step.data)
      }
      // extractChatAttachment runs on pg-boss now. This hands a message the
      // previous release left in SQS to it; remove the case once a release
      // has shipped.
      case QueueType.EXTRACT_CHAT_ATTACHMENT: {
        const { attachmentId } = ExtractChatAttachmentMessageSchema.parse(
          queueMessage.data,
        )
        await this.jobs.send(
          'extractChatAttachment',
          { attachmentId },
          { group: attachmentId },
        )
        return true
      }
      case QueueType.OUTREACH_TEXT_SEND: {
        this.logger.info('received outreachTextSend message')
        // A malformed payload is left to throw: the producer is our own
        // purchase handler, so a shape it cannot satisfy is a bug, and this
        // is a paid send. Let it age to the DLQ where someone sees it rather
        // than ack-dropping it the way a poison ordinance step is dropped.
        const { data } = OutreachTextSendEventSchema.parse(queueMessage)
        return await this.handleOutreachTextSend(data)
      }
      case QueueType.P2P_PHONE_LIST_BUILD: {
        this.logger.info('received p2pPhoneListBuild message')
        // A malformed payload is our own producer's bug (the message only
        // ever carries a buildId) — let it throw and age to the DLQ rather
        // than ack-dropping it.
        const { buildId } = P2pPhoneListBuildMessageSchema.parse(
          queueMessage.data,
        )
        return await this.p2pPhoneListUpload.handleQueuedBuild(buildId)
      }
      // Email payloads are parsed so a malformed one throws and ages to the
      // DLQ rather than being acked.
      case QueueType.EMAIL_SEND_PREPARE:
        return await this.emailOutreachQueue.handleSendPrepare(
          EmailSendPrepareMessageSchema.parse(queueMessage.data),
        )
      case QueueType.EMAIL_INBOUND:
        return await this.emailOutreachQueue.handleInbound(
          EmailInboundMessageSchema.parse(queueMessage.data),
        )

      default:
        this.logger.warn(
          { messageId: message.MessageId, body: message.Body },
          'unknown queue message type',
        )
        return true
    }
  }

  /**
   * The outbound half of the shared text delivery layer, triggered by the
   * Serve SMS purchase handler's post-purchase step.
   *
   * The queue message carries the envelope id and nothing else, so the
   * product-shaped half of `requestSend`'s input — which saved list, what
   * message, which day — is read back off the row here. That is deliberate:
   * the delivery layer takes an audience spec rather than an outreach id
   * precisely so polls can hand it a random sample later without the layer
   * learning what a poll is.
   *
   * Every refusal below ACKS rather than retrying. A row that is missing, or
   * that has no saved list / message / date, is in exactly the same state on
   * every redelivery, so retrying only burns the DLQ budget on a message
   * nothing can act on. Real faults (S3, Slack, the database) still throw out
   * of `requestSend` and redeliver; the send is idempotent under that.
   */
  private async handleOutreachTextSend({
    outreachId,
    sendSeq,
    agentHandoff,
  }: OutreachTextSendEvent['data']): Promise<boolean> {
    const outreach = await this.outreachService.model.findUnique({
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
        'outreachTextSend: no such outreach; acking, retrying cannot help',
      )
      return true
    }

    const isPoll = outreach.outreachType === OutreachType.poll
    if (isPoll && !outreach.approvedAt) {
      this.logger.error(
        { outreachId, sendSeq },
        'outreachTextSend: a poll reached delivery without approval, which ' +
          'should never happen; acking without sending',
      )
      return true
    }
    // A round 2 text is enqueued by its draw, never before: its list holds
    // nobody until then.
    if (isUndrawnSample(outreach.voterFileFilter)) {
      this.logger.error(
        { outreachId, sendSeq },
        'outreachTextSend: a round 2 text reached delivery before its draw, ' +
          'which should never happen; acking without sending',
      )
      return true
    }
    const expansion =
      isPoll && sendSeq > INITIAL_POLL_SEND_SEQ
        ? await this.pollExpansion.resolveDelivery(outreachId, sendSeq)
        : null
    if (isPoll && sendSeq > INITIAL_POLL_SEND_SEQ && !expansion) {
      this.logger.error(
        { outreachId, sendSeq },
        'outreachTextSend: an expansion reached delivery without an ' +
          'approved row, which should never happen; acking without sending',
      )
      return true
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
      return true
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
        'outreachTextSend: the row is missing what a send needs; acking, ' +
          'retrying cannot help',
      )
      return true
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
    })

    // `terminalReason` means nothing was handed off and nothing ever will be.
    // `requestSend` returns rather than throwing for exactly these cases,
    // because a redelivery would hit the same wall: ack instead of burning
    // the redrive budget on the way to the DLQ.
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
      return true
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
    return true
  }

  // TODO: ALL of the below functions should be moved to their respective
  //  services. This is a queue consumer class. There should be no business
  //  logic in the queue consumer class. This GREATLY complicates development.
  private async handleTcrComplianceCheckMessage({
    tcrCompliance,
  }: TcrComplianceStatusCheckMessage) {
    return await this.tcrComplianceService.checkUsecaseActivation(tcrCompliance)
  }

  private async handleDomainEmailForwardingMessage({
    domainId,
  }: DomainEmailForwardingMessage): Promise<boolean> {
    if (!this.domainsService.shouldEnableDomainPurchase()) {
      const message = `Domain purchasing is disabled - skipping backfill for domainId: ${domainId}`
      this.logger.debug(message)
      throw new Error(message, { cause: { domainId } })
    }
    const domain = await this.domainsService.model.findUniqueOrThrow({
      where: { id: domainId },
    })
    if (domain.emailForwardingDomainId) {
      this.logger.debug(
        `Email forwarding already set up for domain *@${domain.name}, skipping`,
      )
      return true
    }

    let forwardEmailDomain: ForwardEmailDomainResponse | null = null
    try {
      forwardEmailDomain =
        await this.domainsService.setupDomainEmailForwarding(domain)
      this.logger.debug(`Email forwarding set up for domain *@${domain.name}`)
    } catch {
      const message = `Error setting up email forwarding for domain *@${domain.name}`
      this.logger.error(message)
      throw new Error(message, { cause: { domainId } })
    }

    forwardEmailDomain &&
      (await this.domainsService.model.update({
        where: {
          id: domainId,
        },
        data: { emailForwardingDomainId: forwardEmailDomain.id },
      }))

    return true
  }

  private async handlePollCreation(
    event: PollCreationEvent,
    messageId: string,
  ) {
    return this.triggerPollExecution({
      pollId: event.data.pollId,
      messageId,
      sampleParams: async (poll) => {
        return { size: poll.targetAudienceSize }
      },
      isExpansion: false,
    })
  }

  private async handlePollExpansion(
    event: PollExpansionEvent,
    messageId: string,
  ) {
    return this.triggerPollExecution({
      pollId: event.data.pollId,
      messageId,
      sampleParams: async (poll) => {
        const alreadySent =
          await this.pollsService.client.pollIndividualMessage.findMany({
            where: {
              pollId: poll.id,
              sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
            },
            select: { personId: true },
          })

        return {
          size: poll.targetAudienceSize - alreadySent.length,
          excludeIds: alreadySent.map((p) => p.personId),
        }
      },
      isExpansion: true,
    })
  }

  private async triggerPollExecution(params: {
    pollId: string
    messageId: string
    sampleParams: (poll: Poll) => Promise<SampleContacts> | SampleContacts
    isExpansion: boolean
  }): Promise<boolean> {
    const data = await this.getPollAndOrganization(params.pollId)
    if (!data) {
      this.logger.info(`${params.pollId} Poll not found, ignoring event`)
      return true
    }
    const { poll, office, organization } = data

    const user = await this.usersService.findUnique({
      where: { id: office.userId },
    })
    this.logger.info(`${params.pollId} Fetched sample and user`)

    if (!user) {
      this.logger.info(`${params.pollId} User not found, ignoring event`)
      return true
    }

    const bucket = process.env.TEVYN_POLL_CSVS_BUCKET
    if (!bucket) {
      throw new Error(
        `${params.pollId} TEVYN_POLL_CSVS_BUCKET environment variable is required`,
      )
    }
    // It's important that this filename be deterministic based on the particular poll "run".
    // That way, in the event of a failure and retry, we can safely re-use a previously generated CSV.
    // We use the estimated completion date here because it gets set when the poll expanded, and then
    // does not change.
    const fileName = `${poll.id}-${poll.estimatedCompletionDate.toISOString()}.csv`
    const key = this.s3Service.buildKey(undefined, fileName)

    // 1. Get or create the CSV file of a random sample of contacts.
    // We do get-or-create here so that the logic remains retry-safe in the event of a failure.
    let csv = await this.s3Service.getFile(bucket, key)

    if (!csv) {
      this.logger.info(
        `${params.pollId} No existing CSV found, generating new one`,
      )
      const sampleParams = await params.sampleParams(poll)
      this.logger.info(
        { sampleParams },
        `${poll.id} Sampling contacts with params: `,
      )
      const sample = await this.contactsService.sampleContacts(
        sampleParams,
        organization,
      )
      if (sample.length === 0) {
        throw new Error(`No contacts returned in sample for poll ${poll.id}`)
      }
      this.logger.info(
        `${params.pollId} Generated sample of ${sample.length} contacts`,
      )
      csv = buildCsvFromContacts(sample)
      await this.s3Service.uploadFile(bucket, csv, key, {
        contentType: 'text/csv',
      })
    }

    const people = await parseCsv<{ id: string; cellPhone: string }>(csv)

    // 2. Create individual poll messages
    // IDs are deterministic (`pollId-personId`) so re-processing the same CSV
    // is safe: skipDuplicates silently ignores rows that already exist.
    const now = new Date()
    const messages: Prisma.PollIndividualMessageCreateManyInput[] = people.map(
      (person) => ({
        id: `${poll.id}-${person.id}`,
        pollId: poll.id,
        personId: person.id!,
        sentAt: now,
        personCellPhone: normalizePhoneNumber(person.cellPhone),
        electedOfficeId: poll.electedOfficeId,
      }),
    )
    await this.pollsService.client.pollIndividualMessage.createMany({
      data: messages,
      skipDuplicates: true,
    })

    this.logger.info(`${params.pollId} Created individual poll messages`)

    // 3. Send CSV file to Slack for Tevyn
    if (!this.slackService.isConfigured) {
      this.logger.warn(
        `${params.pollId} Slack not configured, skipping Tevyn poll message`,
      )
    } else {
      await sendTevynAPIPollMessage(this.slackService.client, {
        message: poll.messageContent,
        pollId: poll.id,
        scheduledDate: isBefore(poll.scheduledDate, new Date())
          ? 'Now'
          : formatInTimeZone(poll.scheduledDate, 'America/New_York', 'PP p') +
            ' ET',
        csv: {
          fileContent: Buffer.from(csv),
          filename: `${user.email}-${format(poll.scheduledDate, 'yyyy-MM-dd')}.csv`,
        },
        imageUrl: poll.imageUrl || undefined,
        userInfo: {
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          email: user.email,
          phone: user.phone || undefined,
        },
        isExpansion: params.isExpansion,
      })
      this.logger.info(`${params.pollId} Slack message sent`)
    }

    return true
  }

  private async getPollAndOrganization(pollId: string) {
    const poll = await this.pollsService.findUnique({
      where: { id: pollId },
    })
    if (!poll) {
      this.logger.info('Poll not found, ignoring event')
      return
    }

    if (!poll.electedOfficeId) {
      this.logger.info('Poll has no elected office, ignoring event')
      return
    }

    const office =
      await this.electedOfficeService.client.electedOffice.findUnique({
        where: { id: poll.electedOfficeId },
        include: { organization: true },
      })

    if (!office) {
      this.logger.info('Elected office not found, ignoring event')
      return
    }

    const organization = office.organization
    if (!organization) {
      this.logger.info('Elected office has no organization, ignoring event')
      return
    }

    return { poll, office, organization }
  }
}

const buildCsvFromContacts = (people: PersonOutput[]) => {
  const headers: (keyof PersonOutput)[] = [
    'id',
    'firstName',
    'lastName',
    'cellPhone',
  ]
  const lines = [headers.join(',')]
  for (const person of people) {
    const row = headers.map((key) => csvEscape(person?.[key] ?? ''))
    lines.push(row.join(','))
  }
  return lines.join('\n')
}
