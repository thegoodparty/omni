import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NotFoundException } from '@nestjs/common'
import {
  ChatAttachmentsService,
  isPdfBody,
  type FetchBytesResult,
  type LinkFetchHttp,
} from './chatAttachments.service'
import { parsePdfText } from '@/ocr/extractors/pdf.extractor'

vi.mock('@/ocr/extractors/pdf.extractor', () => ({
  parsePdfText: vi.fn(),
}))

const PDF_HEADER = Buffer.from('%PDF-1.7 content here')
const HTML_BODY = Buffer.from(
  '<html><body><h1>Hello</h1><p>World</p></body></html>',
)
const TEXT_BODY = Buffer.from('Plain text document')

const okFetch = (
  overrides: Partial<Extract<FetchBytesResult, { kind: 'ok' }>> = {},
): FetchBytesResult => ({
  kind: 'ok',
  status: 200,
  contentType: 'text/html; charset=utf-8',
  body: HTML_BODY,
  ...overrides,
})

const errorFetch = (
  reason: Extract<FetchBytesResult, { kind: 'error' }>['reason'],
): FetchBytesResult => ({ kind: 'error', reason })

const fakeHttp = (result: FetchBytesResult): LinkFetchHttp => ({
  getBytes: () => Promise.resolve(result),
})

const CONV_ID = 'conv-test-123'
const USER_ID = 1

const mockConversation = {
  id: CONV_ID,
  ownerUserId: USER_ID,
  deletedAt: null,
  _count: { attachments: 0 },
}

const mockRow = {
  id: 'attachment-uuid-7',
  source: 'URL' as const,
  sourceUrl: 'https://example.com',
  storageKey: 'chat-attachments/1/attachment-uuid-7',
  fileName: '',
  mimeType: 'text/markdown',
  sizeBytes: 10,
  pageCount: null,
  extractedText: '## Hello\n\nWorld',
  failureReason: null,
  status: 'ready' as const,
  readyAt: new Date(),
  createdAt: new Date(),
  conversationId: CONV_ID,
  ownerUserId: USER_ID,
}

const makeMockPrisma = (
  conv: typeof mockConversation | null = mockConversation,
) => ({
  chatConversation: {
    findFirst: vi.fn().mockResolvedValue(conv),
  },
  chatAttachment: {
    create: vi.fn().mockResolvedValue(mockRow),
  },
})

const mockS3 = {
  uploadFile: vi.fn().mockResolvedValue('https://bucket.s3.amazonaws.com/key'),
}

const makeService = (
  fetchResult: FetchBytesResult,
  conv: typeof mockConversation | null = mockConversation,
): ChatAttachmentsService => {
  const svc = new ChatAttachmentsService(
    mockS3 as never,
    {} as never,
    fakeHttp(fetchResult),
  )
  const mockPrisma = makeMockPrisma(conv)
  Object.defineProperty(svc, '_prisma', {
    get: () => mockPrisma,
    configurable: true,
  })
  Object.defineProperty(svc, 'model', {
    get: () => mockPrisma.chatAttachment,
    configurable: true,
  })
  return svc
}

describe('isPdfBody', () => {
  it('detects PDF via magic bytes regardless of content-type', () => {
    expect(isPdfBody(null, PDF_HEADER)).toBe(true)
    expect(isPdfBody('text/html', PDF_HEADER)).toBe(true)
  })

  it('detects PDF via content-type header', () => {
    expect(isPdfBody('application/pdf', Buffer.from('not a pdf'))).toBe(true)
  })

  it('rejects non-PDF bodies without a PDF header', () => {
    expect(isPdfBody('text/html', HTML_BODY)).toBe(false)
    expect(isPdfBody(null, HTML_BODY)).toBe(false)
  })
})

describe('ChatAttachmentsService.attachLink', () => {
  it('throws NotFoundException when conversation does not exist', async () => {
    const svc = makeService(okFetch(), null)
    await expect(
      svc.attachLink(CONV_ID, USER_ID, 'org-slug-stub', 'https://example.com'),
    ).rejects.toThrow(NotFoundException)
  })

  it('returns blocked_url for literal private-IP URLs (pre-fetch guard)', async () => {
    const svc = makeService(okFetch())
    const result = await svc.attachLink(
      CONV_ID,
      USER_ID,
      'org-slug-stub',
      'http://192.168.1.1/admin',
    )
    expect(result).toEqual({ ok: false, error: 'blocked_url' })
  })

  it('returns blocked_url for loopback URL (pre-fetch guard)', async () => {
    const svc = makeService(okFetch())
    const result = await svc.attachLink(
      CONV_ID,
      USER_ID,
      'org-slug-stub',
      'http://127.0.0.1/secret',
    )
    expect(result).toEqual({ ok: false, error: 'blocked_url' })
  })

  it('returns blocked_url when HTTP layer reports blocked_host', async () => {
    const svc = makeService(errorFetch('blocked_host'))
    const result = await svc.attachLink(
      CONV_ID,
      USER_ID,
      'org-slug-stub',
      'https://rebind.example.com/x',
    )
    expect(result).toEqual({ ok: false, error: 'blocked_url' })
  })

  it('returns timeout when HTTP layer reports timeout', async () => {
    const svc = makeService(errorFetch('timeout'))
    const result = await svc.attachLink(
      CONV_ID,
      USER_ID,
      'org-slug-stub',
      'https://slow.example.com',
    )
    expect(result).toEqual({ ok: false, error: 'timeout' })
  })

  it('returns too_large when HTTP layer reports too_large', async () => {
    const svc = makeService(errorFetch('too_large'))
    const result = await svc.attachLink(
      CONV_ID,
      USER_ID,
      'org-slug-stub',
      'https://big.example.com/file',
    )
    expect(result).toEqual({ ok: false, error: 'too_large' })
  })

  it('returns unreachable when HTTP layer reports network error', async () => {
    const svc = makeService(errorFetch('network'))
    const result = await svc.attachLink(
      CONV_ID,
      USER_ID,
      'org-slug-stub',
      'https://down.example.com',
    )
    expect(result).toEqual({ ok: false, error: 'unreachable' })
  })

  it('returns unreachable for non-2xx HTTP status', async () => {
    const svc = makeService(okFetch({ status: 404 }))
    const result = await svc.attachLink(
      CONV_ID,
      USER_ID,
      'org-slug-stub',
      'https://example.com/missing',
    )
    expect(result).toEqual({ ok: false, error: 'unreachable' })
  })

  it('returns unsupported_content_type for non-HTML/PDF/text content', async () => {
    const svc = makeService(
      okFetch({
        contentType: 'application/octet-stream',
        body: Buffer.from('binary data'),
      }),
    )
    const result = await svc.attachLink(
      CONV_ID,
      USER_ID,
      'org-slug-stub',
      'https://example.com/file.bin',
    )
    expect(result).toEqual({ ok: false, error: 'unsupported_content_type' })
  })

  it('converts HTML to markdown and returns ok result', async () => {
    const svc = makeService(okFetch())
    const result = await svc.attachLink(
      CONV_ID,
      USER_ID,
      'org-slug-stub',
      'https://example.com/page',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.attachment.mimeType).toBe('text/markdown')
    expect(result.attachment.status).toBe('ready')
    expect(result.attachment.source).toBe('URL')
  })

  it('passes plain text through unchanged', async () => {
    const svc = makeService(
      okFetch({ contentType: 'text/plain', body: TEXT_BODY }),
    )
    const result = await svc.attachLink(
      CONV_ID,
      USER_ID,
      'org-slug-stub',
      'https://example.com/doc.txt',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.attachment.mimeType).toBe('text/markdown')
  })

  it('returns too_large when cap is reached', async () => {
    const fullConv = { ...mockConversation, _count: { attachments: 10 } }
    const svc = makeService(okFetch(), fullConv)
    const result = await svc.attachLink(
      CONV_ID,
      USER_ID,
      'org-slug-stub',
      'https://example.com/page',
    )
    expect(result).toEqual({ ok: false, error: 'too_large' })
  })

  describe('PDF branch', () => {
    const pdfFetch = (): FetchBytesResult =>
      okFetch({ contentType: 'application/pdf', body: PDF_HEADER })

    beforeEach(() => {
      vi.mocked(parsePdfText).mockReset()
    })

    it('returns unsupported_content_type when parsePdfText throws', async () => {
      vi.mocked(parsePdfText).mockRejectedValue(new Error('corrupt PDF'))
      const svc = makeService(pdfFetch())
      const result = await svc.attachLink(
        CONV_ID,
        USER_ID,
        'org-slug-stub',
        'https://example.com/doc.pdf',
      )
      expect(result).toEqual({ ok: false, error: 'unsupported_content_type' })
    })

    it('returns too_large when page count exceeds CHAT_ATTACHMENT_MAX_PAGES', async () => {
      vi.mocked(parsePdfText).mockResolvedValue({ text: '', pages: 101 })
      const svc = makeService(pdfFetch())
      const result = await svc.attachLink(
        CONV_ID,
        USER_ID,
        'org-slug-stub',
        'https://example.com/big.pdf',
      )
      expect(result).toEqual({ ok: false, error: 'too_large' })
    })

    it('returns ok with mimeType application/pdf on happy path', async () => {
      const pdfRow = {
        ...mockRow,
        mimeType: 'application/pdf',
        pageCount: 5,
        extractedText: null,
      }
      vi.mocked(parsePdfText).mockResolvedValue({
        text: 'pdf content',
        pages: 5,
      })
      const svc = makeService(pdfFetch())
      Object.defineProperty(svc, 'model', {
        get: () => ({
          create: vi.fn().mockResolvedValue(pdfRow),
        }),
        configurable: true,
      })
      const result = await svc.attachLink(
        CONV_ID,
        USER_ID,
        'org-slug-stub',
        'https://example.com/doc.pdf',
      )
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok')
      expect(result.attachment.mimeType).toBe('application/pdf')
      expect(result.attachment.pageCount).toBe(5)
      expect(result.attachment.status).toBe('ready')
    })
  })
})
