import * as http from 'http'
import * as https from 'https'
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import axios from 'axios'
import { MimeTypes } from 'http-constants-ts'
import sanitizeHtml from 'sanitize-html'
import TurndownService from 'turndown'
import { v7 as uuidv7 } from 'uuid'
import {
  ChatAttachmentSource,
  ChatAttachmentStatus,
  ChatScope,
  Prisma,
} from '../../generated/prisma'
import { addSeconds } from 'date-fns'
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_PAGES,
  CHAT_ATTACHMENTS_PER_CONVERSATION,
  type LinkAttachResponse,
  ChatAttachmentSchema,
  FinalizeRequest,
  PresignRequest,
  PresignResponse,
} from '@goodparty_org/contracts'
import type {
  ChatAttachment,
  ChatAttachmentDownloadResponse,
  ChatAttachmentListResponse,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { parsePdfText } from '@/ocr/extractors/pdf.extractor'
import {
  isPublicAddress,
  ssrfSafeLookup,
} from '@/websites/services/websites.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { MessageGroup, QueueType } from '@/queue/queue.types'
import { declaredZipUncompressedSize } from '@/ocr/util/zipInflationGuard.util'
import mammoth from 'mammoth'
import { z } from 'zod'

export const SERVE_CHAT_ATTACHMENTS_FLAG = 'serve-chat-attachments'
export const LINK_FETCH_HTTP = 'LINK_FETCH_HTTP'

const PDF_MAGIC = '%PDF'
const FETCH_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const MAX_HTML_CONVERT_BYTES = 1_500_000
const MAX_FETCH_CONTENT_CHARS = 24_000

const DOWNLOAD_EXPIRY_SECONDS = 60 * 15
const PRESIGN_EXPIRES_IN = 60 * 15
const OCR_TEXT_MAX_BYTES = 200_000
const MAGIC_BYTES_LEN = 8
const MAX_DOCX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024

export type FetchBytesResult =
  | {
      kind: 'ok'
      status: number
      contentType: string | null
      body: Buffer
    }
  | {
      kind: 'error'
      reason: 'timeout' | 'blocked_host' | 'network' | 'too_large'
    }

export interface LinkFetchHttp {
  getBytes(url: string): Promise<FetchBytesResult>
}

type ChatAttachmentDTO = z.infer<typeof ChatAttachmentSchema>

const MAGIC_PREFIX: Record<string, Buffer> = {
  'application/pdf': Buffer.from('%PDF-'),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    Buffer.from('PK'),
  'text/plain': Buffer.alloc(0),
}

// literalHostBlocked closes the redirect-to-literal-IP gap that
// ssrfSafeLookup on the HTTP agents can't cover (Node skips the agent lookup
// for IP-literal hosts entirely).
const literalHostBlocked = (hostname: string): boolean => {
  const bare = hostname.replace(/^\[|\]$/g, '')
  if (bare === 'localhost') return true
  const looksLikeIp = /^[\d.]+$/.test(bare) || bare.includes(':')
  return looksLikeIp && !isPublicAddress(bare)
}

const guardRedirect = (options: { hostname?: string }): void => {
  if (options.hostname && literalHostBlocked(options.hostname)) {
    throw new Error('Refusing to follow redirect to non-public IP')
  }
}

export const isPdfBody = (contentType: string | null, body: Buffer): boolean =>
  (contentType ?? '').toLowerCase().includes(MimeTypes.APPLICATION_PDF) ||
  body.subarray(0, PDF_MAGIC.length).toString('latin1') === PDF_MAGIC

const markdownFromHtml = (html: string): string => {
  const bounded =
    html.length > MAX_HTML_CONVERT_BYTES
      ? html.slice(0, MAX_HTML_CONVERT_BYTES)
      : html
  const cleaned = sanitizeHtml(bounded, {
    allowedTags: sanitizeHtml.defaults.allowedTags,
    allowedAttributes: { a: ['href'] },
  })
  return new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  }).turndown(cleaned)
}

const fileNameFromUrl = (url: string): string => {
  try {
    const { pathname } = new URL(url)
    const segments = pathname.split('/').filter(Boolean)
    return segments.at(-1) ?? 'link'
  } catch {
    return 'link'
  }
}

const fetchUrlBytes = async (url: string): Promise<FetchBytesResult> => {
  try {
    const res = await axios.get<Buffer>(url, {
      timeout: FETCH_TIMEOUT_MS,
      responseType: 'arraybuffer',
      validateStatus: () => true,
      maxRedirects: 5,
      beforeRedirect: guardRedirect,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: MAX_RESPONSE_BYTES,
      httpAgent: new http.Agent({ lookup: ssrfSafeLookup }),
      httpsAgent: new https.Agent({ lookup: ssrfSafeLookup }),
    })
    const rawType = res.headers['content-type']
    return {
      kind: 'ok',
      status: res.status,
      contentType: typeof rawType === 'string' ? rawType : null,
      body: Buffer.from(res.data),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (axios.isAxiosError(err) && err.code === 'ECONNABORTED') {
      return { kind: 'error', reason: 'timeout' }
    }
    if (message.includes('non-public IP')) {
      return { kind: 'error', reason: 'blocked_host' }
    }
    if (message.includes('maxContentLength size')) {
      return { kind: 'error', reason: 'too_large' }
    }
    return { kind: 'error', reason: 'network' }
  }
}

export const defaultLinkFetchHttp: LinkFetchHttp = {
  getBytes: fetchUrlBytes,
}

@Injectable()
export class ChatAttachmentsService extends createPrismaBase(
  MODELS.ChatAttachment,
) {
  constructor(
    private readonly s3: S3Service,
    private readonly queue: QueueProducerService,
    @Optional()
    @Inject(LINK_FETCH_HTTP)
    private readonly http: LinkFetchHttp = defaultLinkFetchHttp,
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

  // Mirrors GeneralChatStoreService.findOwnedConversation: organizationSlug
  // is part of the ownership check, so a user's org-A session can never
  // reach a conversation they hold under org-B.
  private async loadOwnedChiefOfStaffConversation(
    conversationId: string,
    userId: number,
    organizationSlug: string | null,
  ): Promise<void> {
    const conversation = await this.client.chatConversation.findFirst({
      where: {
        id: conversationId,
        ownerUserId: userId,
        organizationSlug,
        deletedAt: null,
      },
      select: { scope: true },
    })
    if (!conversation || conversation.scope !== ChatScope.chief_of_staff) {
      throw new NotFoundException('Conversation not found')
    }
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

  async attachLink(
    conversationId: string,
    userId: number,
    organizationSlug: string,
    url: string,
  ): Promise<LinkAttachResponse> {
    const conversation = await this.client.chatConversation.findFirst({
      where: {
        id: conversationId,
        ownerUserId: userId,
        organizationSlug,
        deletedAt: null,
      },
      select: { scope: true },
    })
    if (!conversation) throw new NotFoundException()

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { ok: false, error: 'unreachable' }
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, error: 'blocked_url' }
    }
    if (literalHostBlocked(parsed.hostname)) {
      return { ok: false, error: 'blocked_url' }
    }

    const fetched = await this.http.getBytes(url)
    if (fetched.kind === 'error') {
      if (fetched.reason === 'timeout') return { ok: false, error: 'timeout' }
      if (fetched.reason === 'blocked_host') {
        return { ok: false, error: 'blocked_url' }
      }
      if (fetched.reason === 'too_large') {
        return { ok: false, error: 'too_large' }
      }
      return { ok: false, error: 'unreachable' }
    }
    if (fetched.status < 200 || fetched.status >= 300) {
      return { ok: false, error: 'unreachable' }
    }

    const contentType = (fetched.contentType ?? '').toLowerCase()
    const pdfBody = isPdfBody(contentType, fetched.body)
    const isHtml =
      contentType.includes('text/html') ||
      contentType.includes('application/xhtml')
    const isPlainText = contentType.includes('text/plain')

    if (!pdfBody && !isHtml && !isPlainText) {
      return { ok: false, error: 'unsupported_content_type' }
    }

    const attachmentId = uuidv7()
    const storageKey = this.buildStorageKey(userId, attachmentId)
    const fileName = fileNameFromUrl(url)

    let extractedText: string | null = null
    let mimeType: string
    let sizeBytes: number
    let pageCount: number | null = null

    if (pdfBody) {
      let pages: number | null = null
      try {
        const result = await parsePdfText(new Uint8Array(fetched.body))
        pages = result.pages
      } catch {
        return { ok: false, error: 'unsupported_content_type' }
      }
      if (pages === null || pages > CHAT_ATTACHMENT_MAX_PAGES) {
        return { ok: false, error: 'too_large' }
      }
      pageCount = pages
      mimeType = MimeTypes.APPLICATION_PDF
      sizeBytes = fetched.body.byteLength
      await this.s3.uploadFile(this.bucket, fetched.body, storageKey, {
        contentType: MimeTypes.APPLICATION_PDF,
      })
    } else {
      const raw = fetched.body.toString('utf-8')
      const full = isHtml ? markdownFromHtml(raw) : raw
      extractedText =
        full.length > MAX_FETCH_CONTENT_CHARS
          ? full.slice(0, MAX_FETCH_CONTENT_CHARS)
          : full
      mimeType = 'text/markdown'
      sizeBytes = Buffer.byteLength(extractedText, 'utf-8')
      await this.s3.uploadFile(
        this.bucket,
        Buffer.from(extractedText, 'utf-8'),
        storageKey,
        { contentType: 'text/markdown' },
      )
    }

    // Serializable transaction closes the TOCTOU race: the re-count + create
    // are atomic, so two concurrent requests cannot both pass the cap check.
    let row: Awaited<ReturnType<typeof this.model.create>>
    try {
      row = await this.client.$transaction(
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
          return tx.chatAttachment.create({
            data: {
              id: attachmentId,
              conversationId,
              ownerUserId: userId,
              source: ChatAttachmentSource.URL,
              sourceUrl: url,
              storageKey,
              fileName,
              mimeType,
              sizeBytes,
              pageCount,
              extractedText,
              status: ChatAttachmentStatus.ready,
              readyAt: new Date(),
            },
          })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (err) {
      if (
        err instanceof BadRequestException &&
        err.message === 'attachment_limit_reached'
      ) {
        await this.s3
          .deleteObject(this.bucket, storageKey)
          .catch((rollbackErr: Error) =>
            this.logger.error(
              { err: rollbackErr, attachmentId, conversationId },
              's3 rollback failed',
            ),
          )
        return { ok: false, error: 'attachment_limit_reached' }
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2034'
      ) {
        await this.s3
          .deleteObject(this.bucket, storageKey)
          .catch((rollbackErr: Error) =>
            this.logger.error(
              { err: rollbackErr, attachmentId, conversationId },
              's3 rollback failed',
            ),
          )
        return { ok: false, error: 'attachment_limit_reached' }
      }
      await this.s3
        .deleteObject(this.bucket, storageKey)
        .catch((rollbackErr: Error) =>
          this.logger.error(
            { err: rollbackErr, attachmentId, conversationId },
            's3 rollback failed',
          ),
        )
      throw err
    }

    return {
      ok: true,
      attachment: {
        id: row.id,
        source: row.source,
        sourceUrl: row.sourceUrl ?? null,
        fileName: row.fileName,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        pageCount: row.pageCount ?? null,
        status: row.status,
        failureReason: row.failureReason ?? null,
        createdAt: row.createdAt,
      },
    }
  }

  async listAttachments(
    conversationId: string,
    userId: number,
    organizationSlug: string | null,
  ): Promise<ChatAttachmentListResponse> {
    await this.loadOwnedChiefOfStaffConversation(
      conversationId,
      userId,
      organizationSlug,
    )
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
    organizationSlug: string | null,
  ): Promise<ChatAttachmentDownloadResponse> {
    await this.loadOwnedChiefOfStaffConversation(
      conversationId,
      userId,
      organizationSlug,
    )
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
    organizationSlug: string | null,
  ): Promise<void> {
    await this.loadOwnedChiefOfStaffConversation(
      conversationId,
      userId,
      organizationSlug,
    )
    const attachment = await this.model.findFirst({
      where: { id: attachmentId, conversationId },
      select: { storageKey: true },
    })
    if (!attachment) throw new NotFoundException('Attachment not found')

    // DB-first, S3 best-effort (annotationAttachment.service.ts pattern): a
    // DB failure leaves both sides intact and retryable, while an S3 failure
    // after the row is gone leaves only an unreachable orphan — never a row
    // pointing at a deleted object.
    await this.model.delete({ where: { id: attachmentId } })
    try {
      await this.s3.deleteObject(this.bucket, attachment.storageKey)
    } catch (err) {
      this.logger.warn(
        { err, attachmentId, storageKey: attachment.storageKey },
        'best-effort S3 delete failed for attachment',
      )
    }
  }

  async presign(
    conversationId: string,
    userId: number,
    organizationSlug: string | null,
    body: PresignRequest,
  ): Promise<PresignResponse> {
    await this.loadOwnedChiefOfStaffConversation(
      conversationId,
      userId,
      organizationSlug,
    )

    const created = await this.client
      .$transaction(
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
      .catch((err: unknown) => {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2034'
        ) {
          throw new BadRequestException('attachment_limit_reached')
        }
        throw err
      })

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
      await this.markFailed(created.id, 'presign_failed').catch(
        (markErr: Error) =>
          this.logger.error(
            { err: markErr, attachmentId: created.id },
            'markFailed after presign error failed; attachment may remain pending',
          ),
      )
      throw err
    }
  }

  async finalize(
    conversationId: string,
    userId: number,
    organizationSlug: string | null,
    body: FinalizeRequest,
  ): Promise<ChatAttachmentDTO> {
    await this.loadOwnedChiefOfStaffConversation(
      conversationId,
      userId,
      organizationSlug,
    )
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
      if (pages === null || pages > CHAT_ATTACHMENT_MAX_PAGES) {
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
        MessageGroup.extractChatAttachment,
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
