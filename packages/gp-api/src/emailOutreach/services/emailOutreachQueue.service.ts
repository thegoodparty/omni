import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import {
  EmailInboundMessage,
  EmailSendPrepareMessage,
} from '@/queue/queue.types'
import { OutreachEmailInboundService } from './outreachEmailInbound.service'
import { OutreachEmailPrepareService } from './outreachEmailPrepare.service'

// The queue consumer's entry points for email messages. A failure returns
// false, so the message is redelivered and ages to the DLQ; the due sweep
// re-enqueues a send whose prepare never landed.
@Injectable()
export class EmailOutreachQueueService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly prepares: OutreachEmailPrepareService,
    private readonly inbound: OutreachEmailInboundService,
  ) {
    this.logger.setContext(EmailOutreachQueueService.name)
  }

  async handleSendPrepare(message: EmailSendPrepareMessage): Promise<boolean> {
    try {
      await this.prepares.prepare(message.outreachEmailId)
      return true
    } catch (err) {
      this.logger.error({ err, message }, 'Preparing an email send failed')
      return false
    }
  }

  async handleInbound(message: EmailInboundMessage): Promise<boolean> {
    try {
      await this.inbound.process(message.bucket, message.key)
      return true
    } catch (err) {
      this.logger.error({ err, message }, 'Handling an email reply failed')
      return false
    }
  }
}
