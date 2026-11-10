import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '../prisma/util/prisma.util'
import { ScheduledMessage } from '../generated/prisma'
import { EmailService } from '../email/email.service'
import { ScheduledMessageTypes } from '../email/email.types'

@Injectable()
export class ScheduledMessagingService extends createPrismaBase(
  MODELS.ScheduledMessage,
) {
  constructor(private readonly emails: EmailService) {
    super()
  }

  // The scheduledMessagesSend schedule's worker (src/jobs/jobs.registry.ts).
  async processScheduledMessages() {
    const messages: ScheduledMessage[] =
      await this.queryScheduledMessagesAndFlag()

    if (!messages?.length) {
      return []
    }

    this.logger.debug({ messages }, `Found ${messages.length} messages to send`)

    return this.sendMessagesAndUpdate(messages)
  }

  private async queryScheduledMessagesAndFlag() {
    let messages: ScheduledMessage[] = []
    await this.client.$transaction(async () => {
      messages = await this.model.findMany({
        where: {
          scheduledAt: {
            lte: new Date(),
          },
          processing: false,
          sentAt: {
            equals: null,
          },
          error: {
            equals: null,
          },
        },
      })

      await this.model.updateMany({
        where: {
          id: {
            in: messages.map((m) => m.id),
          },
        },
        data: {
          processing: true, // Ensure no other process is trying to send this message
        },
      })
    })
    return messages
  }

  private sendEmailMessage({ messageConfig: { message } }: ScheduledMessage) {
    if ('template' in message) {
      this.emails.sendTemplateEmail(message)
    } else {
      this.emails.sendEmail(message)
    }
  }

  private async sendMessagesAndUpdate(messages: ScheduledMessage[]) {
    const updatedMessages: ScheduledMessage[] = []
    this.logger.debug({ messages }, 'Sending messages:')
    await this.client.$transaction(async (tx) => {
      for (const m of messages) {
        let updatedScheduledMsg: ScheduledMessage

        try {
          switch (m.messageConfig.type) {
            case ScheduledMessageTypes.EMAIL:
              this.sendEmailMessage(m)
          }
        } catch (e) {
          this.logger.error({ e }, 'Error sending message')
          const errorMessage = e instanceof Error ? e.toString() : String(e)
          updatedScheduledMsg = (await tx.scheduledMessage.update({
            where: {
              id: m.id,
            },
            data: {
              error: errorMessage,
            },
          })) as ScheduledMessage
          continue
        }

        updatedScheduledMsg = (await tx.scheduledMessage.update({
          where: {
            id: m.id,
          },
          data: {
            sentAt: new Date(),
            processing: false,
          },
        })) as ScheduledMessage
        updatedMessages.push(updatedScheduledMsg)
      }
    })

    return updatedMessages
  }

  async scheduleMessage(
    campaignId: number,
    messageConfig: PrismaJson.ScheduledMessageConfig,
    sendDate: Date,
  ) {
    this.logger.debug(
      {
        campaignId,
        messageConfig,
        sendDate,
      },
      'Scheduling message: ',
    )
    return await this.model.create({
      data: {
        campaignId,
        messageConfig,
        scheduledAt: sendDate,
      },
    })
  }
}
