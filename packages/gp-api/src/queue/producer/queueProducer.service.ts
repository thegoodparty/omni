import { Injectable } from '@nestjs/common'
import { SQSClient } from '@aws-sdk/client-sqs'
import { Producer } from 'sqs-producer'
import { Message } from '@ssut/nestjs-sqs/dist/sqs.types'
import { queueConfig } from '../queue.config'
import { MessageGroup, QueueMessage } from '../queue.types'
import { PinoLogger } from 'nestjs-pino'

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || '' })

// create simple producer. the producer in nest-sqs does not work.
// so we use the underlying sqs-producer package
const producer = Producer.create({
  ...queueConfig,
  sqs: sqsClient,
})

@Injectable()
export class QueueProducerService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(QueueProducerService.name)
  }
  async sendMessage(
    msg: QueueMessage,
    group: MessageGroup | string = MessageGroup.default,
    options: { throwOnError?: boolean; deduplicationId?: string } = {},
  ) {
    const body = JSON.stringify(msg)

    const uuid = Math.random().toString(36).substring(2, 12)
    const deduplicationId = options.deduplicationId ?? uuid

    const message: Message = {
      id: uuid,
      body,
      deduplicationId,
      groupId: `gp-queue-${group}`,
    }

    try {
      await producer.send(message)
    } catch (error) {
      this.logger.error({ error }, 'error queueing message')
      if (options.throwOnError) {
        throw error
      }
    }
  }
}
