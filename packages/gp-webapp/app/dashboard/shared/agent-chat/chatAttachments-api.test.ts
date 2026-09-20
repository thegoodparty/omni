import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resolveMimeType,
  linkErrorMessage,
  uploadChatAttachment,
  linkChatAttachment,
  listChatAttachments,
  deleteChatAttachment,
  downloadChatAttachment,
} from './chatAttachments-api'

// ---------------------------------------------------------------------------
// resolveMimeType
// ---------------------------------------------------------------------------

describe('resolveMimeType', () => {
  it('returns file.type when the browser populates it', () => {
    const file = new File([''], 'doc.pdf', { type: 'application/pdf' })
    expect(resolveMimeType(file)).toBe('application/pdf')
  })

  it('falls back to extension lookup when file.type is empty', () => {
    const file = new File([''], 'doc.pdf', { type: '' })
    expect(resolveMimeType(file)).toBe('application/pdf')
  })

  it('resolves .txt extension to text/plain', () => {
    const file = new File([''], 'notes.txt', { type: '' })
    expect(resolveMimeType(file)).toBe('text/plain')
  })

  it('resolves .docx extension to the correct MIME type', () => {
    const file = new File([''], 'report.docx', { type: '' })
    expect(resolveMimeType(file)).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
  })

  it('resolves .jpg and .jpeg to image/jpeg', () => {
    const jpg = new File([''], 'photo.jpg', { type: '' })
    const jpeg = new File([''], 'photo.jpeg', { type: '' })
    expect(resolveMimeType(jpg)).toBe('image/jpeg')
    expect(resolveMimeType(jpeg)).toBe('image/jpeg')
  })

  it('resolves .png to image/png', () => {
    const file = new File([''], 'image.png', { type: '' })
    expect(resolveMimeType(file)).toBe('image/png')
  })

  it('returns empty string for unknown extensions', () => {
    const file = new File([''], 'archive.zip', { type: '' })
    expect(resolveMimeType(file)).toBe('')
  })

  it('returns empty string when there is no extension and type is empty', () => {
    const file = new File([''], 'nodotfile', { type: '' })
    expect(resolveMimeType(file)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// linkErrorMessage
// ---------------------------------------------------------------------------

describe('linkErrorMessage', () => {
  it.each([
    ['unreachable', "Couldn't reach that URL. Check the link and try again."],
    ['blocked_url', "That URL isn't allowed. Try a different one."],
    ['too_large', 'That page is too large to read. Try a more specific URL.'],
    ['timeout', 'Reading that URL timed out. Try again.'],
    [
      'attachment_limit_reached',
      "You've reached the attachment limit for this conversation.",
    ],
    [
      'unsupported_content_type',
      "That link's content type isn't supported. Try a PDF or plain-text URL.",
    ],
  ])('maps %s to the correct message', (code, expected) => {
    expect(linkErrorMessage(code)).toBe(expected)
  })

  it('returns the generic fallback for unknown error codes', () => {
    expect(linkErrorMessage('some_future_error')).toBe(
      "Couldn't attach that link. Try again.",
    )
  })
})

// ---------------------------------------------------------------------------
// uploadChatAttachment
// ---------------------------------------------------------------------------

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('uploadChatAttachment', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('follows presign → S3 POST → finalize and returns the attachment', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        // presign
        jsonResponse({
          uploadUrl: 'https://s3.example.com/upload',
          uploadFields: { key: 'abc', policy: 'xyz' },
          storageKey: 's3-key-123',
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // S3 POST
      .mockResolvedValueOnce(
        // finalize
        jsonResponse({
          id: 'att-1',
          fileName: 'doc.pdf',
          status: 'processing',
          pageCount: null,
          failureReason: null,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const file = new File(['content'], 'doc.pdf', { type: 'application/pdf' })
    const result = await uploadChatAttachment('conv-1', file)

    expect(result).toEqual({
      id: 'att-1',
      fileName: 'doc.pdf',
      status: 'processing',
      pageCount: null,
      failureReason: null,
    })

    // S3 POST must be the second call, not routed through gp-api
    const [s3Url] = fetchMock.mock.calls[1] as [string]
    expect(s3Url).toBe('https://s3.example.com/upload')
  })

  it('throws an s3_upload_failed error when S3 returns a non-ok status', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            uploadUrl: 'https://s3.example.com/upload',
            uploadFields: {},
            storageKey: 's3-key',
          }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 403 })), // S3 rejects
    )

    const file = new File(['x'], 'bad.pdf', { type: 'application/pdf' })
    await expect(uploadChatAttachment('conv-1', file)).rejects.toThrow(
      's3_upload_failed:403',
    )
  })
})

// ---------------------------------------------------------------------------
// linkChatAttachment
// ---------------------------------------------------------------------------

describe('linkChatAttachment', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns ok:true with the attachment on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          ok: true,
          attachment: {
            id: 'att-2',
            fileName: 'page.pdf',
            status: 'pending',
            pageCount: null,
            failureReason: null,
          },
        }),
      ),
    )

    const result = await linkChatAttachment(
      'conv-1',
      'https://example.com/page.pdf',
    )
    expect(result).toEqual({
      ok: true,
      attachment: {
        id: 'att-2',
        fileName: 'page.pdf',
        status: 'pending',
        pageCount: null,
        failureReason: null,
      },
    })
  })

  it('returns ok:false with the error code on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ ok: false, error: 'unreachable' })),
    )

    const result = await linkChatAttachment(
      'conv-1',
      'https://gone.example.com',
    )
    expect(result).toEqual({ ok: false, error: 'unreachable' })
  })
})

// ---------------------------------------------------------------------------
// listChatAttachments
// ---------------------------------------------------------------------------

describe('listChatAttachments', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls the list endpoint and maps returned attachments', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        attachments: [
          {
            id: 'att-3',
            fileName: 'brief.pdf',
            status: 'ready',
            pageCount: 5,
            failureReason: null,
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await listChatAttachments('conv-1')

    expect(result).toEqual([
      {
        id: 'att-3',
        fileName: 'brief.pdf',
        status: 'ready',
        pageCount: 5,
        failureReason: null,
      },
    ])
    const [target] = fetchMock.mock.calls[0] as [string | Request]
    const calledUrl = typeof target === 'string' ? target : target.url
    expect(calledUrl).toContain('/v1/chats/conv-1/attachments')
  })

  it('returns an empty array when no attachments exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ attachments: [] })),
    )

    const result = await listChatAttachments('conv-1')
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// deleteChatAttachment
// ---------------------------------------------------------------------------

describe('deleteChatAttachment', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls the delete endpoint with the correct conversation and attachment ids', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await deleteChatAttachment('conv-1', 'att-4')

    const [target] = fetchMock.mock.calls[0] as [string | Request]
    const calledUrl = typeof target === 'string' ? target : target.url
    expect(calledUrl).toContain('/v1/chats/conv-1/attachments/att-4')
  })
})

// ---------------------------------------------------------------------------
// downloadChatAttachment
// ---------------------------------------------------------------------------

describe('downloadChatAttachment', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns { url, expiresAt } on a successful download response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          url: 'https://s3.example.com/signed/doc.pdf?token=abc',
          expiresAt: '2026-09-20T12:00:00Z',
        }),
      ),
    )

    const result = await downloadChatAttachment('conv-1', 'att-5')
    expect(result).toEqual({
      url: 'https://s3.example.com/signed/doc.pdf?token=abc',
      expiresAt: '2026-09-20T12:00:00Z',
    })
  })

  it('returns null when the server returns a non-2xx status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    )

    const result = await downloadChatAttachment('conv-1', 'att-missing')
    expect(result).toBeNull()
  })

  it('returns null when the request throws (network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network failure')),
    )

    const result = await downloadChatAttachment('conv-1', 'att-5')
    expect(result).toBeNull()
  })

  it('hits the correct endpoint path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        url: 'https://s3.example.com/signed/doc.pdf',
        expiresAt: '2026-09-20T12:00:00Z',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await downloadChatAttachment('conv-1', 'att-5')

    const [target] = fetchMock.mock.calls[0] as [string | Request]
    const calledUrl = typeof target === 'string' ? target : target.url
    expect(calledUrl).toContain('/v1/chats/conv-1/attachments/att-5/download')
  })
})
