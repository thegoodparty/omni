import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ChatScope } from '../../generated/prisma'
import { addSeconds } from 'date-fns'
import type {
  ChatAttachment,
  ChatAttachmentDownloadResponse,
  ChatAttachmentListResponse,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { S3Service } from '@/vendors/aws/services/s3.service'

export const SERVE_CHAT_ATTACHMENTS_FLAG = 'serve-chat-attachments'

const DOWNLOAD_EXPIRY_SECONDS = 60 * 15

@Injectable()
export class ChatAttachmentsService extends createPrismaBase(
  MODELS.ChatAttachment,
) {
  constructor(private readonly s3: S3Service) {
    super()
  }

  private get bucket(): string {
    const bucket = process.env.CHAT_ATTACHMENTS_BUCKET
    if (!bucket) {
      throw new Error('CHAT_ATTACHMENTS_BUCKET is not configured')
    }
    return bucket
  }

  private async loadOwnedChiefOfStaffConversation(
    conversationId: string,
    userId: number,
  ): Promise<void> {
    const conversation = await this.client.chatConversation.findFirst({
      where: {
        id: conversationId,
        ownerUserId: userId,
        deletedAt: null,
      },
      select: { scope: true },
    })
    if (!conversation || conversation.scope !== ChatScope.chief_of_staff) {
      throw new NotFoundException('Conversation not found')
    }
  }

  async listAttachments(
    conversationId: string,
    userId: number,
  ): Promise<ChatAttachmentListResponse> {
    await this.loadOwnedChiefOfStaffConversation(conversationId, userId)
    const rows = await this.model.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        source: true,
        sourceUrl: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        pageCount: true,
        status: true,
        failureReason: true,
        createdAt: true,
      },
    })
    return { attachments: rows as ChatAttachment[] }
  }

  async getDownloadUrl(
    conversationId: string,
    attachmentId: string,
    userId: number,
  ): Promise<ChatAttachmentDownloadResponse> {
    await this.loadOwnedChiefOfStaffConversation(conversationId, userId)
    const attachment = await this.model.findFirst({
      where: { id: attachmentId, conversationId },
      select: { storageKey: true },
    })
    if (!attachment) throw new NotFoundException('Attachment not found')

    const url = await this.s3.getSignedUrlForViewing(
      this.bucket,
      attachment.storageKey,
      { expiresIn: DOWNLOAD_EXPIRY_SECONDS },
    )
    return { url, expiresAt: addSeconds(new Date(), DOWNLOAD_EXPIRY_SECONDS) }
  }

  async deleteAttachment(
    conversationId: string,
    attachmentId: string,
    userId: number,
  ): Promise<void> {
    await this.loadOwnedChiefOfStaffConversation(conversationId, userId)
    const attachment = await this.model.findFirst({
      where: { id: attachmentId, conversationId },
      select: { storageKey: true },
    })
    if (!attachment) throw new NotFoundException('Attachment not found')

    try {
      await this.s3.deleteObject(this.bucket, attachment.storageKey)
    } catch {
      throw new BadGatewayException('Failed to delete attachment from storage')
    }

    await this.model.delete({ where: { id: attachmentId } })
  }
}
