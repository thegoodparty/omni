import { Message } from '@aws-sdk/client-sqs'
import { Injectable } from '@nestjs/common'
import { SqsConsumerEventHandler, SqsMessageHandler } from '@ssut/nestjs-sqs'
import { serializeError } from 'serialize-error'
import { OrdinanceQualityLoopService } from 'src/ordinances/services/ordinanceQualityLoop.service'
import { pollMessageGroup } from 'src/polls/utils/polls.utils'
import {
  AgenticComplianceKickoffMessageSchema,
  CampaignPlanCompleteMessageSchema,
  AgentExperimentResultSchema,
  ExtractChatAttachmentMessageSchema,
  CampaignStoryCompletedMessageSchema,
  OcrAttachmentMessageSchema,
  OrdinanceQualityLoopMessageSchema,
  OutreachTextSendEventSchema,
  P2pPhoneListBuildMessageSchema,
  EmailSendPrepareMessageSchema,
  EmailInboundMessageSchema,
  PollAnalysisCompleteEventSchema,
  PollCreationEventSchema,
  PollExpansionEventSchema,
  QueueMessage,
  QueueType,
  SqsConsumerErrorEventName,
} from '../queue.types'
import { PinoLogger } from 'nestjs-pino'
import { outreachTextSendJob } from '@/outreach/util/outreachTextSendJob.util'
import { PrismaService } from '@/prisma/prisma.service'
import { P2pPhoneListUploadService } from '@/vendors/peerly/services/p2pPhoneListUpload.service'
import {
  FeedbackSynthesisCompleteEventSchema,
  PanelRepliesUploadedEventSchema,
} from '@goodparty_org/contracts'
import { EmailOutreachQueueService } from '@/emailOutreach/services/emailOutreachQueue.service'
import { JobsService } from '@/jobs/jobs.service'

@Injectable()
export class QueueConsumerService {
  constructor(
    private readonly ordinanceQualityLoop: OrdinanceQualityLoopService,
    private readonly p2pPhoneListUpload: P2pPhoneListUploadService,
    private readonly logger: PinoLogger,
    private readonly emailOutreachQueue: EmailOutreachQueueService,
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
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
      // The 10DLC jobs and schedules run on pg-boss now. These hand a message
      // the previous release left in SQS to them; remove the cases once a
      // release has shipped.
      case QueueType.TCR_COMPLIANCE_STATUS_CHECK:
        await this.jobs.send('tcrComplianceStatusCheck', {
          tcrComplianceId: queueMessage.data.tcrCompliance.id,
        })
        return true
      // domainEmailForwarding runs on pg-boss now. This hands a message the
      // previous release left in SQS to it; remove the case once a release
      // has shipped.
      // Same key as the boot backfill, so a leftover message and the boot
      // job for one domain collapse into one job instead of running at once.
      case QueueType.DOMAIN_EMAIL_FORWARDING:
        await this.jobs.sendMany('domainEmailForwarding', [
          {
            data: { domainId: queueMessage.data.domainId },
            key: String(queueMessage.data.domainId),
          },
        ])
        return true
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
      // pollCreation and pollExpansion run on pg-boss now. These hand a
      // message the previous release left in SQS to them; remove the cases
      // once a release has shipped. Keyed by the MessageId, as above, so a
      // redelivered message queues nothing new.
      case QueueType.POLL_CREATION: {
        const { pollId } = PollCreationEventSchema.parse(queueMessage).data
        await this.jobs.sendMany('pollCreation', [
          {
            data: { pollId },
            key: message.MessageId!,
            group: pollMessageGroup(pollId),
          },
        ])
        return true
      }
      case QueueType.POLL_EXPANSION: {
        const { pollId } = PollExpansionEventSchema.parse(queueMessage).data
        await this.jobs.sendMany('pollExpansion', [
          {
            data: { pollId },
            key: message.MessageId!,
            group: pollMessageGroup(pollId),
          },
        ])
        return true
      }
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
      // campaignStoryCompleted runs on pg-boss now. This hands a message the
      // previous release left in SQS to it; remove the case once a release
      // has shipped.
      case QueueType.CAMPAIGN_STORY_COMPLETED: {
        const { campaignId } = CampaignStoryCompletedMessageSchema.parse(
          queueMessage.data,
        )
        await this.jobs.send(
          'campaignStoryCompleted',
          { campaignId },
          { group: String(campaignId) },
        )
        return true
      }
      case QueueType.NIGHTLY_10DLC_REPORT:
        await this.jobs.sendScheduleRun('nightly10DlcReport')
        return true
      case QueueType.PEERLY_VENDOR_ESCALATION:
        await this.jobs.sendScheduleRun('peerlyVendorEscalation')
        return true
      case QueueType.CV_STATUS_POLL:
        await this.jobs.sendScheduleRun(
          queueMessage.data.fresh ? 'cvStatusFreshScan' : 'cvStatusScan',
        )
        return true
      case QueueType.AGENT_EXPERIMENT_RESULT: {
        const data = AgentExperimentResultSchema.parse(queueMessage.data)
        await this.jobs.sendMany('agentExperimentResult', [
          { data, key: message.MessageId!, group: data.runId },
        ])
        return true
      }
      case QueueType.AGENTIC_COMPLIANCE_KICKOFF: {
        const kickoff = AgenticComplianceKickoffMessageSchema.parse(
          queueMessage.data,
        )
        await this.jobs.send('agenticComplianceKickoff', kickoff, {
          group: String(kickoff.campaignId),
        })
        return true
      }
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
      // The quality loop runs on pg-boss now (ordinanceQualityLoopStep). This
      // hands a step the previous release left in SQS to it; remove the case
      // once a release has shipped.
      case QueueType.ORDINANCE_QUALITY_LOOP: {
        // Parse failure is a poison message — it can never become valid, and
        // requeueing would block the ordinance's FIFO group until the DLQ
        // limit. Ack-drop it.
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
        await this.ordinanceQualityLoop.enqueueStep(step.data)
        return true
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
      // outreachTextSend and p2pPhoneListBuild run on pg-boss now. These hand
      // a message the previous release left in SQS to the job, under the key
      // its producers use, so a send the new release also made is one job.
      // Remove both cases once a release has shipped.
      case QueueType.OUTREACH_TEXT_SEND: {
        // A malformed payload is left to throw: this is a paid send, so let
        // it age to the DLQ where someone sees it.
        const { data } = OutreachTextSendEventSchema.parse(queueMessage)
        await this.jobs.sendMany('outreachTextSend', [
          outreachTextSendJob(data),
        ])
        return true
      }
      case QueueType.P2P_PHONE_LIST_BUILD: {
        const { buildId } = P2pPhoneListBuildMessageSchema.parse(
          queueMessage.data,
        )
        const build = await this.prisma.peerlyPhoneList.findUnique({
          where: { id: buildId },
          select: { buildAttempts: true },
        })
        // The producer keyed the message on the attempt count it had then,
        // which a queued build still carries.
        if (build) {
          await this.p2pPhoneListUpload.enqueueBuild(
            buildId,
            build.buildAttempts,
          )
        }
        return true
      }
      // Email payloads are parsed so a malformed one throws and ages to the
      // DLQ rather than being acked. Both run on pg-boss now: these hand a
      // message the previous release left in SQS to its job; remove them
      // once a release has shipped.
      case QueueType.EMAIL_SEND_PREPARE:
        return await this.emailOutreachQueue.forwardSendPrepare(
          EmailSendPrepareMessageSchema.parse(queueMessage.data),
        )
      case QueueType.EMAIL_INBOUND:
        return await this.emailOutreachQueue.forwardInbound(
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
}
