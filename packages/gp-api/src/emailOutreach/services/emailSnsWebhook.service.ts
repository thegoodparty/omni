import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { QueueType } from '@/queue/queue.types'
import { resolveEnvVar } from '@/shared/env/env'
import {
  SnsMessage,
  SnsMessageSchema,
  isSigningCertUrl,
  isSnsUrl,
  verifySnsSignature,
} from '../util/snsSignature.util'

export const EMAIL_INBOUND_TOPIC_ENV = 'EMAIL_INBOUND_TOPIC_ARN'

const FETCH_TIMEOUT_MS = 5_000
const MAX_GROUP_KEY_CHARS = 100

// What SES sends for a received message when its receipt rule has an S3
// action that also notifies the topic.
const ReceivedSchema = z.object({
  notificationType: z.literal('Received'),
  receipt: z.object({
    dmarcVerdict: z.object({ status: z.string() }).optional(),
    action: z.object({
      type: z.literal('S3'),
      bucketName: z.string().min(1),
      objectKey: z.string().min(1),
    }),
  }),
})

const parseJson = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

@Injectable()
export class EmailSnsWebhookService {
  private readonly certificates = new Map<string, string>()

  constructor(
    private readonly queueProducer: QueueProducerService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EmailSnsWebhookService.name)
  }

  // Nothing is processed here. A verified notification is enqueued and the
  // request answers 200 only once that has succeeded, so SNS retries a
  // failed one.
  async handle(rawBody: unknown): Promise<void> {
    const parsed = SnsMessageSchema.safeParse(parseJson(rawBody))
    if (!parsed.success) {
      throw new BadRequestException('Not an SNS message')
    }
    const message = parsed.data
    await this.verify(message)

    if (message.Type === 'Notification') {
      await this.enqueueReceived(message)
    } else if (message.Type === 'SubscriptionConfirmation') {
      await this.confirmSubscription(message)
    }
  }

  async fetchCertificate(url: string): Promise<string> {
    const cached = this.certificates.get(url)
    if (cached) return cached
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (response.status >= 400 && response.status < 500) {
      throw new ForbiddenException()
    }
    if (!response.ok) {
      throw new Error(`Certificate fetch answered ${response.status}`)
    }
    const pem = await response.text()
    this.certificates.set(url, pem)
    return pem
  }

  async fetchSubscribeUrl(url: string): Promise<void> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`Subscription confirmation answered ${response.status}`)
    }
  }

  private async verify(message: SnsMessage): Promise<void> {
    if (!isSigningCertUrl(message.SigningCertURL)) {
      this.logger.warn('SNS message has an untrusted signing certificate URL')
      throw new ForbiddenException()
    }
    let certificate: string
    try {
      certificate = await this.fetchCertificate(message.SigningCertURL)
    } catch (err) {
      if (err instanceof ForbiddenException) throw err
      this.logger.error({ err }, 'could not fetch the SNS signing certificate')
      throw new ServiceUnavailableException()
    }
    if (!verifySnsSignature(message, certificate)) {
      this.logger.warn('SNS message failed its signature check')
      throw new ForbiddenException()
    }
    const topic = resolveEnvVar(EMAIL_INBOUND_TOPIC_ENV)
    if (!topic.configured) {
      this.logger.error(`${EMAIL_INBOUND_TOPIC_ENV} is not set`)
      throw new ServiceUnavailableException()
    }
    if (message.TopicArn !== topic.value) {
      this.logger.warn({ topic: message.TopicArn }, 'SNS topic not allowed')
      throw new ForbiddenException()
    }
  }

  private async enqueueReceived(
    message: Extract<SnsMessage, { Type: 'Notification' }>,
  ): Promise<void> {
    const received = ReceivedSchema.safeParse(parseJson(message.Message))
    if (!received.success) {
      this.logger.info(
        { messageId: message.MessageId },
        'ignoring an SNS notification that is not a received message',
      )
      return
    }
    const { action, dmarcVerdict } = received.data.receipt
    const { bucketName, objectKey } = action
    await this.queueProducer.sendMessage(
      {
        type: QueueType.EMAIL_INBOUND,
        data: {
          snsMessageId: message.MessageId,
          bucket: bucketName,
          key: objectKey,
          fromAuthenticated: dmarcVerdict?.status.toUpperCase() === 'PASS',
        },
      },
      `emailInbound-${objectKey.slice(0, MAX_GROUP_KEY_CHARS)}`,
      {
        throwOnError: true,
        deduplicationId: `emailInbound-${message.MessageId}`,
      },
    )
  }

  private async confirmSubscription(
    message: Extract<SnsMessage, { Type: 'SubscriptionConfirmation' }>,
  ): Promise<void> {
    if (!isSnsUrl(message.SubscribeURL, /^\/$/)) {
      throw new ForbiddenException()
    }
    try {
      await this.fetchSubscribeUrl(message.SubscribeURL)
    } catch (err) {
      this.logger.error({ err }, 'could not confirm the SNS subscription')
      throw new ServiceUnavailableException()
    }
  }
}
