import * as http from 'http'
import * as https from 'https'
import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common'
import axios from 'axios'
import { MimeTypes } from 'http-constants-ts'
import sanitizeHtml from 'sanitize-html'
import TurndownService from 'turndown'
import { v7 as uuidv7 } from 'uuid'
import {
  CHAT_ATTACHMENT_MAX_PAGES,
  CHAT_ATTACHMENTS_PER_CONVERSATION,
  type LinkAttachResponse,
} from '@goodparty_org/contracts'
import { ChatAttachmentSource, ChatAttachmentStatus } from '@/generated/prisma'
import { parsePdfText } from '@/ocr/extractors/pdf.extractor'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  isPublicAddress,
  ssrfSafeLookup,
} from '@/websites/services/websites.service'
import { S3Service } from '@/vendors/aws/services/s3.service'

export const SERVE_CHAT_ATTACHMENTS_FLAG = 'serve-chat-attachments'
export const LINK_FETCH_HTTP = 'LINK_FETCH_HTTP'

const PDF_MAGIC = '%PDF'
const FETCH_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const MAX_HTML_CONVERT_BYTES = 1_500_000
const MAX_FETCH_CONTENT_CHARS = 24_000

const { CHAT_ATTACHMENTS_BUCKET = '' } = process.env

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
    @Optional()
    @Inject(LINK_FETCH_HTTP)
    private readonly http: LinkFetchHttp = defaultLinkFetchHttp,
  ) {
    super()
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
      include: { _count: { select: { attachments: true } } },
    })
    if (!conversation) throw new NotFoundException()
    if (conversation._count.attachments >= CHAT_ATTACHMENTS_PER_CONVERSATION) {
      return { ok: false, error: 'too_large' }
    }

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
    const storageKey = `chat-attachments/${userId}/${attachmentId}`
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
        return { ok: false, error: 'too_large' }
      }
      if (pages !== null && pages > CHAT_ATTACHMENT_MAX_PAGES) {
        return { ok: false, error: 'too_large' }
      }
      pageCount = pages
      mimeType = MimeTypes.APPLICATION_PDF
      sizeBytes = fetched.body.byteLength
      await this.s3.uploadFile(
        CHAT_ATTACHMENTS_BUCKET,
        fetched.body,
        storageKey,
        { contentType: MimeTypes.APPLICATION_PDF },
      )
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
        CHAT_ATTACHMENTS_BUCKET,
        Buffer.from(extractedText, 'utf-8'),
        storageKey,
        { contentType: 'text/markdown' },
      )
    }

    const row = await this.model
      .create({
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
      .catch(async (err) => {
        await this.s3
          .deleteObject(CHAT_ATTACHMENTS_BUCKET, storageKey)
          .catch(() => {})
        throw err
      })

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
}
