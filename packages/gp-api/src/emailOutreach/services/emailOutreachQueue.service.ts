import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { JobsService } from '@/jobs/jobs.service'
import {
  EmailInboundMessage,
  EmailSendPrepareMessage,
} from '@/queue/queue.types'
import { resolveEnvVar } from '@/shared/env/env'

// emailSendPrepare and emailInbound run on pg-boss now. The queue consumer
// hands a message the previous release left in SQS to this, which sends the
// job; remove it once a release has shipped. A failed send throws, so the
// message is redelivered.
@Injectable()
export class EmailOutreachQueueService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly jobs: JobsService,
  ) {
    this.logger.setContext(EmailOutreachQueueService.name)
  }

  async forwardSendPrepare(message: EmailSendPrepareMessage): Promise<boolean> {
    await this.jobs.send(
      'emailSendPrepare',
      { outreachEmailId: message.outreachEmailId },
      { group: String(message.outreachEmailId) },
    )
    return true
  }

  // The SQS message names the reply's bucket and key; the job carries only
  // the key, which is SES's message id, and reads this environment's bucket.
  async forwardInbound(message: EmailInboundMessage): Promise<boolean> {
    const inboundBucket = resolveEnvVar('EMAIL_INBOUND_BUCKET')
    if (!inboundBucket.configured) {
      throw new Error('EMAIL_INBOUND_BUCKET is not set')
    }
    if (message.bucket !== inboundBucket.value) {
      this.logger.warn(
        { bucket: message.bucket, key: message.key },
        'inbound reply from an unknown bucket',
      )
      return true
    }
    await this.jobs.send('emailInbound', {
      sesMessageId: message.key,
      fromAuthenticated: message.fromAuthenticated,
    })
    return true
  }
}
