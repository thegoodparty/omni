import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  ChatAttachmentSource,
  ChatAttachmentStatus,
  ChatScope,
  Prisma,
} from '../../generated/prisma'
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_PAGES,
  CHAT_ATTACHMENTS_PER_CONVERSATION,
  ChatAttachmentSchema,
  FinalizeRequest,
  PresignRequest,
  PresignResponse,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { MessageGroup, QueueType } from '@/queue/queue.types'
import { parsePdfText } from '@/ocr/extractors/pdf.extractor'
import { declaredZipUncompressedSize } from '@/ocr/util/zipInflationGuard.util'
import mammoth from 'mammoth'
import { z } from 'zod'

export const SERVE_CHAT_ATTACHMENTS_FLAG = 'serve-chat-attachments'

const PRESIGN_EXPIRES_IN = 60 * 15
const OCR_TEXT_MAX_BYTES = 200_000
const MAGIC_BYTES_LEN = 8
const MAX_DOCX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024

type ChatAttachmentDTO = z.infer<typeof ChatAttachmentSchema>

const MAGIC_PREFIX: Record<string, Buffer> = {
  'application/pdf': Buffer.from('%PDF-'),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    Buffer.from('PK'),
  'text/plain': Buffer.alloc(0),
}

@Injectable()
export class ChatAttachmentsService extends createPrismaBase(
  MODELS.ChatAttachment,
) {
  constructor(
    private readonly s3: S3Service,
    private readonly queue: QueueProducerService,
  ) {
    super()
  }

  private get bucket(): string {
    const bucket = process.env.CHAT_ATTACHMENTS_BUCKET
    if (!bucket) throw new Error('CHAT_ATTACHMENTS_BUCKET is not configured')
    return bucket
  }

  private buildStorageKey(userId: number, attachmentId: string): string {
    return `chat-attachments/${userId}/${attachmentId}`
  }

  private async markFailed(
    attachmentId: string,
    failureReason: string,
  ): Promise<void> {
    await this.client.chatAttachment.update({
      where: { id: attachmentId },
      data: { status: ChatAttachmentStatus.failed, failureReason },
    })
  }

  private rowToDto(row: {
    id: string
    source: ChatAttachmentSource
    sourceUrl: string | null
    fileName: string
    mimeType: string
    sizeBytes: number
    pageCount: number | null
    status: ChatAttachmentStatus
    failureReason: string | null
    createdAt: Date
  }): ChatAttachmentDTO {
    return {
      id: row.id,
      source: row.source,
      sourceUrl: row.sourceUrl,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      pageCount: row.pageCount,
      status: row.status,
      failureReason: row.failureReason,
      createdAt: row.createdAt,
    }
  }

  async presign(
    conversationId: string,
    userId: number,
    body: PresignRequest,
  ): Promise<PresignResponse> {
    const conversation = await this.client.chatConversation.findFirst({
      where: { id: conversationId, ownerUserId: userId, deletedAt: null },
    })
    if (!conversation || conversation.scope !== ChatScope.chief_of_staff) {
      throw new NotFoundException()
    }

    const created = await this.client.$transaction(
      async (tx) => {
        const count = await tx.chatAttachment.count({
          where: {
            conversationId,
            status: { not: ChatAttachmentStatus.failed },
          },
        })
        if (count >= CHAT_ATTACHMENTS_PER_CONVERSATION) {
          throw new BadRequestException('attachment_limit_reached')
        }
        const row = await tx.chatAttachment.create({
          data: {
            conversationId,
            ownerUserId: userId,
            source: ChatAttachmentSource.UPLOAD,
            storageKey: '',
            fileName: body.fileName,
            mimeType: body.mimeType,
            sizeBytes: body.sizeBytes,
            status: ChatAttachmentStatus.pending,
          },
          select: { id: true },
        })
        const storageKey = this.buildStorageKey(userId, row.id)
        await tx.chatAttachment.update({
          where: { id: row.id },
          data: { storageKey },
        })
        return { id: row.id, storageKey }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )

    try {
      const { url: uploadUrl, fields: uploadFields } =
        await this.s3.createPresignedUpload(this.bucket, created.storageKey, {
          maxBytes: body.sizeBytes,
          contentType: body.mimeType,
          expiresIn: PRESIGN_EXPIRES_IN,
        })

      return {
        attachmentId: created.id,
        uploadUrl,
        uploadFields,
        storageKey: created.storageKey,
      }
    } catch (err) {
      await this.markFailed(created.id, 'presign_failed')
      throw err
    }
  }

  async finalize(
    conversationId: string,
    userId: number,
    body: FinalizeRequest,
  ): Promise<ChatAttachmentDTO> {
    const attachment = await this.client.chatAttachment.findFirst({
      where: { storageKey: body.storageKey, conversationId },
    })
    if (!attachment || attachment.ownerUserId !== userId) {
      throw new NotFoundException()
    }
    if (attachment.status !== ChatAttachmentStatus.pending) {
      throw new BadRequestException('attachment_already_processed')
    }

    const head = await this.s3.headObject(this.bucket, attachment.storageKey)
    if (!head) throw new BadRequestException('upload_not_received')
    if (
      head.contentLength === null ||
      head.contentLength > CHAT_ATTACHMENT_MAX_BYTES
    ) {
      await this.markFailed(attachment.id, 'upload_too_large')
      throw new BadRequestException('upload_too_large')
    }
    const actualSizeBytes = head.contentLength

    const leadingBytes = await this.s3.getRangeBytes(
      this.bucket,
      attachment.storageKey,
      0,
      MAGIC_BYTES_LEN - 1,
    )
    const magic = MAGIC_PREFIX[attachment.mimeType] ?? Buffer.alloc(0)
    if (
      magic.length > 0 &&
      (!leadingBytes || !leadingBytes.subarray(0, magic.length).equals(magic))
    ) {
      await this.markFailed(attachment.id, 'content_type_mismatch')
      throw new BadRequestException('content_type_mismatch')
    }

    if (attachment.mimeType === 'application/pdf') {
      const bytes = await this.s3.getFileBytes(
        this.bucket,
        attachment.storageKey,
      )
      if (!bytes) {
        await this.markFailed(attachment.id, 'object_missing')
        throw new BadRequestException('object_missing')
      }
      const { pages } = await parsePdfText(new Uint8Array(bytes))
      if (pages !== null && pages > CHAT_ATTACHMENT_MAX_PAGES) {
        await this.markFailed(attachment.id, 'too_many_pages')
        throw new BadRequestException('too_many_pages')
      }
      const row = await this.client.chatAttachment.update({
        where: { id: attachment.id },
        data: {
          status: ChatAttachmentStatus.ready,
          sizeBytes: actualSizeBytes,
          pageCount: pages,
          readyAt: new Date(),
        },
      })
      return this.rowToDto(row)
    }

    if (
      attachment.mimeType === 'image/jpeg' ||
      attachment.mimeType === 'image/png'
    ) {
      const row = await this.client.chatAttachment.update({
        where: { id: attachment.id },
        data: {
          status: ChatAttachmentStatus.ready,
          sizeBytes: actualSizeBytes,
          readyAt: new Date(),
        },
      })
      return this.rowToDto(row)
    }

    await this.client.chatAttachment.update({
      where: { id: attachment.id },
      data: {
        status: ChatAttachmentStatus.processing,
        sizeBytes: actualSizeBytes,
      },
    })

    try {
      await this.queue.sendMessage(
        {
          type: QueueType.EXTRACT_CHAT_ATTACHMENT,
          data: { attachmentId: attachment.id },
        },
        MessageGroup.default,
        {
          deduplicationId: `extract-${attachment.id}`,
          throwOnError: true,
        },
      )
    } catch (err) {
      await this.markFailed(attachment.id, 'enqueue_failed')
      throw err
    }

    const row = await this.client.chatAttachment.findUniqueOrThrow({
      where: { id: attachment.id },
    })
    return this.rowToDto(row)
  }

  async runExtraction(attachmentId: string): Promise<void> {
    const attachment = await this.client.chatAttachment.findUnique({
      where: { id: attachmentId },
    })
    if (!attachment) {
      this.logger.error({ attachmentId }, 'attachment not found for extraction')
      return
    }
    if (attachment.status !== ChatAttachmentStatus.processing) {
      this.logger.info(
        { attachmentId, status: attachment.status },
        'attachment not in processing state, skipping',
      )
      return
    }

    try {
      const bytes = await this.s3.getFileBytes(
        this.bucket,
        attachment.storageKey,
      )
      if (!bytes) {
        await this.markFailed(attachmentId, 'object_missing')
        return
      }

      let extractedText: string
      const pageCount: number | null = null

      const DOCX_MIME =
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

      if (attachment.mimeType === DOCX_MIME) {
        const declared = declaredZipUncompressedSize(bytes)
        if (declared === null || declared > MAX_DOCX_UNCOMPRESSED_BYTES) {
          await this.markFailed(
            attachmentId,
            declared === null
              ? 'docx_invalid_zip_structure'
              : 'docx_decompression_limit_exceeded',
          )
          return
        }
        const result = await mammoth.extractRawText({ buffer: bytes })
        extractedText = (result.value ?? '').trim()
      } else {
        extractedText = bytes.toString('utf-8').trim()
      }

      if (Buffer.byteLength(extractedText, 'utf-8') > OCR_TEXT_MAX_BYTES) {
        extractedText = Buffer.from(extractedText, 'utf-8')
          .subarray(0, OCR_TEXT_MAX_BYTES)
          .toString('utf-8')
      }

      await this.client.chatAttachment.update({
        where: { id: attachmentId },
        data: {
          status: ChatAttachmentStatus.ready,
          extractedText,
          pageCount,
          readyAt: new Date(),
        },
      })
    } catch (err) {
      this.logger.error({ err, attachmentId }, 'extraction failed')
      await this.client.chatAttachment.update({
        where: { id: attachmentId },
        data: {
          status: ChatAttachmentStatus.failed,
          failureReason: 'extraction_failed',
        },
      })
    }
  }
}
