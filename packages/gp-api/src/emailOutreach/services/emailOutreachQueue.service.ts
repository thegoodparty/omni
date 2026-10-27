import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import {
  EmailEventMessage,
  EmailInboundMessage,
  EmailListImportMessage,
  EmailSendPrepareMessage,
} from '@/queue/queue.types'

// The queue consumer's entry points for email messages. Each returns false
// until its workstream replaces it, so a stray message is redelivered and
// ages to the DLQ instead of being acked and silently dropped.
@Injectable()
export class EmailOutreachQueueService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(EmailOutreachQueueService.name)
  }

  async handleListImport(message: EmailListImportMessage): Promise<boolean> {
    this.logger.warn({ message }, 'emailListImport is not implemented yet')
    return false
  }

  async handleSendPrepare(message: EmailSendPrepareMessage): Promise<boolean> {
    this.logger.warn({ message }, 'emailSendPrepare is not implemented yet')
    return false
  }

  async handleEvent(message: EmailEventMessage): Promise<boolean> {
    this.logger.warn({ message }, 'emailEvent is not implemented yet')
    return false
  }

  async handleInbound(message: EmailInboundMessage): Promise<boolean> {
    this.logger.warn({ message }, 'emailInbound is not implemented yet')
    return false
  }
}
