import { Message } from '@aws-sdk/client-sqs'
import { Injectable } from '@nestjs/common'
import { SqsConsumerEventHandler, SqsMessageHandler } from '@ssut/nestjs-sqs'
import { serializeError } from 'serialize-error'
import {
  CampaignPlanCompleteMessageSchema,
  AgentExperimentResultSchema,
  PollAnalysisCompleteEventSchema,
  QueueMessage,
  QueueType,
  SqsConsumerErrorEventName,
} from '../queue.types'
import { PinoLogger } from 'nestjs-pino'
import {
  FeedbackSynthesisCompleteEventSchema,
  PanelRepliesUploadedEventSchema,
} from '@goodparty_org/contracts'
import { JobsService } from '@/jobs/jobs.service'

@Injectable()
export class QueueConsumerService {
  constructor(
    private readonly logger: PinoLogger,
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
      case QueueType.AGENT_EXPERIMENT_RESULT: {
        const data = AgentExperimentResultSchema.parse(queueMessage.data)
        await this.jobs.sendMany('agentExperimentResult', [
          { data, key: message.MessageId!, group: data.runId },
        ])
        return true
      }

      default:
        this.logger.warn(
          { messageId: message.MessageId, body: message.Body },
          'unknown queue message type',
        )
        return true
    }
  }
}
