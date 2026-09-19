import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChatAttachmentSource,
  ChatAttachmentStatus,
  ChatScope,
} from '../../generated/prisma'
import { FeaturesService } from '@/features/services/features.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { useTestService } from '@/test-service'
import {
  SERVE_CHAT_ATTACHMENTS_FLAG,
  ChatAttachmentsService,
} from './chatAttachments.service'

const service = useTestService()

const orgHeader = (slug: string) => ({
  headers: { 'x-organization-slug': slug },
})

const seedOrg = async () => {
  const slug = `att-${Math.random().toString(36).slice(2, 8)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return slug
}

const seedConversation = async (
  organizationSlug: string | null,
  scope: ChatScope = ChatScope.chief_of_staff,
  ownerUserId: number = service.user.id,
) =>
  service.prisma.chatConversation.create({
    data: { ownerUserId, scope, organizationSlug },
  })

const seedAttachment = async (
  conversationId: string,
  userId: number,
  overrides?: Partial<{
    fileName: string
    createdAt: Date
  }>,
) =>
  service.prisma.chatAttachment.create({
    data: {
      conversationId,
      ownerUserId: userId,
      source: ChatAttachmentSource.UPLOAD,
      storageKey: `uploads/${conversationId}/${Math.random().toString(36).slice(2)}`,
      fileName: overrides?.fileName ?? 'doc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      status: ChatAttachmentStatus.ready,
      createdAt: overrides?.createdAt,
    },
  })

const mockS3 = () => {
  const s3 = service.app.get(S3Service)
  return {
    view: vi
      .spyOn(s3, 'getSignedUrlForViewing')
      .mockResolvedValue('https://s3.example/signed-url'),
    del: vi.spyOn(s3, 'deleteObject').mockResolvedValue(undefined),
  }
}

describe('serve-chat-attachments flag gate', () => {
  let orgSlug: string
  let header: ReturnType<typeof orgHeader>

  beforeEach(async () => {
    orgSlug = await seedOrg()
    header = orgHeader(orgSlug)
  })

  const conversationId = 'conv-stub-123'

  const routes = [
    [
      'POST',
      `/v1/chats/${conversationId}/attachments/presign`,
      {
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    ],
    [
      'POST',
      `/v1/chats/${conversationId}/attachments`,
      { storageKey: 'chat-attachments/123/att-stub' },
    ],
    ['POST', `/v1/chats/${conversationId}/attachments/link`, {}],
  ] as const

  describe('flag off → 404', () => {
    let flagSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      flagSpy = vi
        .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
        .mockImplementation(
          async ({ feature }) => feature !== SERVE_CHAT_ATTACHMENTS_FLAG,
        )
    })

    afterEach(() => {
      flagSpy.mockRestore()
    })

    for (const [method, path, body] of routes) {
      it(`${method} ${path} → 404`, async () => {
        const res = await service.client.post(path, body, header)
        expect(res.status).toBe(404)
      })
    }
  })

  describe('flag on → validates link url', () => {
    it('POST .../attachments/link → 400 when url missing', async () => {
      const res = await service.client.post(
        `/v1/chats/${conversationId}/attachments/link`,
        {},
        header,
      )
      expect(res.status).toBe(400)
    })
  })
})

describe('presign endpoint', () => {
  let orgSlug: string
  let header: ReturnType<typeof orgHeader>
  let presignSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    orgSlug = await seedOrg()
    header = orgHeader(orgSlug)
    presignSpy = vi
      .spyOn(service.app.get(S3Service), 'createPresignedUpload')
      .mockResolvedValue({
        url: 'https://s3.example.com/upload',
        fields: { 'Content-Type': 'application/pdf' },
      })
  })

  afterEach(() => {
    presignSpy.mockRestore()
  })

  it('returns 404 when conversation does not belong to user', async () => {
    const res = await service.client.post(
      '/v1/chats/nonexistent-conv/attachments/presign',
      {
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
      header,
    )
    expect(res.status).toBe(404)
  })

  it('returns 400 attachment_limit_reached when at cap', async () => {
    const conv = await seedConversation(orgSlug)
    for (let i = 0; i < 10; i++) {
      await service.prisma.chatAttachment.create({
        data: {
          conversationId: conv.id,
          ownerUserId: service.user.id,
          source: ChatAttachmentSource.UPLOAD,
          storageKey: `key-${i}`,
          fileName: `file-${i}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          status: ChatAttachmentStatus.ready,
        },
      })
    }
    const res = await service.client.post(
      `/v1/chats/${conv.id}/attachments/presign`,
      {
        fileName: 'new.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
      header,
    )
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.data)).toContain('attachment_limit_reached')
  })

  it('returns presign response with uploadUrl, uploadFields, storageKey, attachmentId', async () => {
    const conv = await seedConversation(orgSlug)
    const res = await service.client.post(
      `/v1/chats/${conv.id}/attachments/presign`,
      {
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
      header,
    )
    expect(res.status).toBe(201)
    expect(res.data).toMatchObject({
      uploadUrl: 'https://s3.example.com/upload',
      uploadFields: expect.objectContaining({
        'Content-Type': 'application/pdf',
      }),
      storageKey: expect.stringMatching(/^chat-attachments\//),
      attachmentId: expect.any(String),
    })
  })
})

describe('concurrent presign (serializable transaction)', () => {
  it('only one of two concurrent presigns at count=9 succeeds', async () => {
    const orgSlug = await seedOrg()
    const header = orgHeader(orgSlug)
    const conv = await seedConversation(orgSlug)
    const s3 = service.app.get(S3Service)
    const presignSpy = vi
      .spyOn(s3, 'createPresignedUpload')
      .mockResolvedValue({ url: 'https://s3.example.com/upload', fields: {} })

    for (let i = 0; i < 9; i++) {
      await service.prisma.chatAttachment.create({
        data: {
          conversationId: conv.id,
          ownerUserId: service.user.id,
          source: ChatAttachmentSource.UPLOAD,
          storageKey: `key-${i}`,
          fileName: `file-${i}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          status: ChatAttachmentStatus.ready,
        },
      })
    }

    const body = {
      fileName: 'race.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    }

    const [r1, r2] = await Promise.all([
      service.client.post(
        `/v1/chats/${conv.id}/attachments/presign`,
        body,
        header,
      ),
      service.client.post(
        `/v1/chats/${conv.id}/attachments/presign`,
        body,
        header,
      ),
    ])

    const statuses = [r1.status, r2.status].sort()
    expect(statuses).toEqual([201, 400])

    presignSpy.mockRestore()
  })
})

describe('finalize endpoint', () => {
  let orgSlug: string
  let header: ReturnType<typeof orgHeader>
  let s3: S3Service
  let headSpy: ReturnType<typeof vi.spyOn>
  let rangeBytesSpy: ReturnType<typeof vi.spyOn>
  let fileBytesSpy: ReturnType<typeof vi.spyOn>
  let queueSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    orgSlug = await seedOrg()
    header = orgHeader(orgSlug)
    s3 = service.app.get(S3Service)
    headSpy = vi
      .spyOn(s3, 'headObject')
      .mockResolvedValue({ contentLength: 1024 })
    rangeBytesSpy = vi
      .spyOn(s3, 'getRangeBytes')
      .mockResolvedValue(Buffer.from('%PDF-'))
    fileBytesSpy = vi
      .spyOn(s3, 'getFileBytes')
      .mockResolvedValue(Buffer.from('%PDF-'))
    const q = service.app.get(QueueProducerService)
    queueSpy = vi.spyOn(q, 'sendMessage').mockResolvedValue(undefined as never)
  })

  afterEach(() => {
    headSpy.mockRestore()
    rangeBytesSpy.mockRestore()
    fileBytesSpy.mockRestore()
    queueSpy.mockRestore()
  })

  it('returns 404 when storageKey not found', async () => {
    const conv = await seedConversation(orgSlug)
    const res = await service.client.post(
      `/v1/chats/${conv.id}/attachments`,
      { storageKey: 'nonexistent-key' },
      header,
    )
    expect(res.status).toBe(404)
  })

  it('returns 400 upload_not_received when head returns null', async () => {
    const conv = await seedConversation(orgSlug)
    const key = `chat-attachments/${service.user.id}/att-no-upload`
    await service.prisma.chatAttachment.create({
      data: {
        conversationId: conv.id,
        ownerUserId: service.user.id,
        source: ChatAttachmentSource.UPLOAD,
        storageKey: key,
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        status: ChatAttachmentStatus.pending,
      },
    })
    headSpy.mockResolvedValue(null)
    const res = await service.client.post(
      `/v1/chats/${conv.id}/attachments`,
      { storageKey: key },
      header,
    )
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.data)).toContain('upload_not_received')
  })

  it('returns 400 content_type_mismatch when magic bytes mismatch', async () => {
    const conv = await seedConversation(orgSlug)
    const key = `chat-attachments/${service.user.id}/att-mismatch`
    await service.prisma.chatAttachment.create({
      data: {
        conversationId: conv.id,
        ownerUserId: service.user.id,
        source: ChatAttachmentSource.UPLOAD,
        storageKey: key,
        fileName: 'fake.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        status: ChatAttachmentStatus.pending,
      },
    })
    rangeBytesSpy.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]))

    const res = await service.client.post(
      `/v1/chats/${conv.id}/attachments`,
      { storageKey: key },
      header,
    )
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.data)).toContain('content_type_mismatch')

    const row = await service.prisma.chatAttachment.findFirst({
      where: { storageKey: key },
    })
    expect(row?.status).toBe(ChatAttachmentStatus.failed)
    expect(row?.failureReason).toBe('content_type_mismatch')
  })

  it('sets status ready for JPEG with matching magic bytes', async () => {
    const conv = await seedConversation(orgSlug)
    const key = `chat-attachments/${service.user.id}/att-jpeg`
    await service.prisma.chatAttachment.create({
      data: {
        conversationId: conv.id,
        ownerUserId: service.user.id,
        source: ChatAttachmentSource.UPLOAD,
        storageKey: key,
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        status: ChatAttachmentStatus.pending,
      },
    })
    rangeBytesSpy.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]))

    const res = await service.client.post(
      `/v1/chats/${conv.id}/attachments`,
      { storageKey: key },
      header,
    )
    expect(res.status).toBe(201)
    expect(res.data.status).toBe(ChatAttachmentStatus.ready)
  })

  it('enqueues extraction and sets status processing for DOCX', async () => {
    const conv = await seedConversation(orgSlug)
    const key = `chat-attachments/${service.user.id}/att-docx`
    await service.prisma.chatAttachment.create({
      data: {
        conversationId: conv.id,
        ownerUserId: service.user.id,
        source: ChatAttachmentSource.UPLOAD,
        storageKey: key,
        fileName: 'doc.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: 1024,
        status: ChatAttachmentStatus.pending,
      },
    })
    rangeBytesSpy.mockResolvedValue(Buffer.from('PK'))

    const res = await service.client.post(
      `/v1/chats/${conv.id}/attachments`,
      { storageKey: key },
      header,
    )
    expect(res.status).toBe(201)
    expect(res.data.status).toBe(ChatAttachmentStatus.processing)
    expect(queueSpy).toHaveBeenCalledOnce()
  })

  it('enqueues extraction and sets status processing for plaintext', async () => {
    const conv = await seedConversation(orgSlug)
    const key = `chat-attachments/${service.user.id}/att-txt`
    await service.prisma.chatAttachment.create({
      data: {
        conversationId: conv.id,
        ownerUserId: service.user.id,
        source: ChatAttachmentSource.UPLOAD,
        storageKey: key,
        fileName: 'notes.txt',
        mimeType: 'text/plain',
        sizeBytes: 12,
        status: ChatAttachmentStatus.pending,
      },
    })
    rangeBytesSpy.mockResolvedValue(Buffer.from('hello world!'))

    const res = await service.client.post(
      `/v1/chats/${conv.id}/attachments`,
      { storageKey: key },
      header,
    )
    expect(res.status).toBe(201)
    expect(res.data.status).toBe(ChatAttachmentStatus.processing)
    expect(queueSpy).toHaveBeenCalledOnce()
  })
})

describe('runExtraction', () => {
  let s3: S3Service
  let fileBytesSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    s3 = service.app.get(S3Service)
    fileBytesSpy = vi.spyOn(s3, 'getFileBytes')
  })

  afterEach(() => {
    fileBytesSpy.mockRestore()
  })

  const seedProcessingAttachment = async (mimeType: string) => {
    const conv = await seedConversation(null)
    const id = `att-extraction-${Math.random().toString(36).slice(2, 8)}`
    const key = `chat-attachments/${service.user.id}/${id}`
    await service.prisma.chatAttachment.create({
      data: {
        id,
        conversationId: conv.id,
        ownerUserId: service.user.id,
        source: ChatAttachmentSource.UPLOAD,
        storageKey: key,
        fileName: 'test',
        mimeType,
        sizeBytes: 100,
        status: ChatAttachmentStatus.processing,
      },
    })
    return { id, key }
  }

  it('sets status ready and stores extractedText for plaintext', async () => {
    const { id } = await seedProcessingAttachment('text/plain')
    fileBytesSpy.mockResolvedValue(Buffer.from('hello world', 'utf-8'))

    const svc = service.app.get(ChatAttachmentsService)
    await svc.runExtraction(id)

    const row = await service.prisma.chatAttachment.findUnique({
      where: { id },
    })
    expect(row?.status).toBe(ChatAttachmentStatus.ready)
    expect(row?.extractedText).toBe('hello world')
  })

  it('truncates extractedText at 200_000 bytes', async () => {
    const { id } = await seedProcessingAttachment('text/plain')
    const big = 'a'.repeat(210_000)
    fileBytesSpy.mockResolvedValue(Buffer.from(big, 'utf-8'))

    const svc = service.app.get(ChatAttachmentsService)
    await svc.runExtraction(id)

    const row = await service.prisma.chatAttachment.findUnique({
      where: { id },
    })
    expect(row?.status).toBe(ChatAttachmentStatus.ready)
    expect(
      Buffer.byteLength(row?.extractedText ?? '', 'utf-8'),
    ).toBeLessThanOrEqual(200_000)
  })

  it('marks failed when object is missing', async () => {
    const { id } = await seedProcessingAttachment('text/plain')
    fileBytesSpy.mockResolvedValue(undefined)

    const svc = service.app.get(ChatAttachmentsService)
    await svc.runExtraction(id)

    const row = await service.prisma.chatAttachment.findUnique({
      where: { id },
    })
    expect(row?.status).toBe(ChatAttachmentStatus.failed)
    expect(row?.failureReason).toBe('object_missing')
  })

  it('marks failed with extraction_failed on unexpected error', async () => {
    const { id } = await seedProcessingAttachment('text/plain')
    fileBytesSpy.mockRejectedValue(new Error('network error'))

    const svc = service.app.get(ChatAttachmentsService)
    await svc.runExtraction(id)

    const row = await service.prisma.chatAttachment.findUnique({
      where: { id },
    })
    expect(row?.status).toBe(ChatAttachmentStatus.failed)
    expect(row?.failureReason).toBe('extraction_failed')
  })

  it('skips if attachment is not in processing state', async () => {
    const conv = await seedConversation(null)
    const id = `att-skip-${Math.random().toString(36).slice(2, 8)}`
    const key = `chat-attachments/${service.user.id}/${id}`
    await service.prisma.chatAttachment.create({
      data: {
        id,
        conversationId: conv.id,
        ownerUserId: service.user.id,
        source: ChatAttachmentSource.UPLOAD,
        storageKey: key,
        fileName: 'test.txt',
        mimeType: 'text/plain',
        sizeBytes: 10,
        status: ChatAttachmentStatus.ready,
      },
    })

    const svc = service.app.get(ChatAttachmentsService)
    await svc.runExtraction(id)

    expect(fileBytesSpy).not.toHaveBeenCalled()
  })
})

describe('GET /v1/chats/:conversationId/attachments', () => {
  let orgSlug: string
  let header: ReturnType<typeof orgHeader>

  beforeEach(async () => {
    orgSlug = await seedOrg()
    header = orgHeader(orgSlug)
  })

  it('returns attachments in createdAt order', async () => {
    const conv = await seedConversation(orgSlug)
    const t1 = new Date('2024-01-01T00:00:00Z')
    const t2 = new Date('2024-01-02T00:00:00Z')
    await seedAttachment(conv.id, service.user.id, {
      fileName: 'second.pdf',
      createdAt: t2,
    })
    await seedAttachment(conv.id, service.user.id, {
      fileName: 'first.pdf',
      createdAt: t1,
    })

    const res = await service.client.get(
      `/v1/chats/${conv.id}/attachments`,
      header,
    )

    expect(res.status).toBe(200)
    expect(res.data.attachments).toHaveLength(2)
    expect(res.data.attachments[0].fileName).toBe('first.pdf')
    expect(res.data.attachments[1].fileName).toBe('second.pdf')
  })

  it('never exposes storageKey or extractedText', async () => {
    const conv = await seedConversation(orgSlug)
    await seedAttachment(conv.id, service.user.id)

    const res = await service.client.get(
      `/v1/chats/${conv.id}/attachments`,
      header,
    )

    expect(res.status).toBe(200)
    const att = res.data.attachments[0]
    expect(att).not.toHaveProperty('storageKey')
    expect(att).not.toHaveProperty('extractedText')
  })

  it('returns 404 for a non-chief_of_staff conversation', async () => {
    const conv = await seedConversation(orgSlug, ChatScope.campaign_assistant)

    const res = await service.client.get(
      `/v1/chats/${conv.id}/attachments`,
      header,
    )

    expect(res.status).toBe(404)
  })

  it('returns 404 when the conversation belongs to a different user', async () => {
    const otherUser = await service.prisma.user.create({
      data: {
        clerkId: `other-${Math.random().toString(36).slice(2)}`,
        email: 'other-list@test.com',
      },
    })
    const conv = await seedConversation(
      orgSlug,
      ChatScope.chief_of_staff,
      otherUser.id,
    )

    const res = await service.client.get(
      `/v1/chats/${conv.id}/attachments`,
      header,
    )

    expect(res.status).toBe(404)
  })

  it('returns 404 when the conversation belongs to a different org', async () => {
    const otherOrgSlug = await seedOrg()
    const conv = await seedConversation(otherOrgSlug)
    await seedAttachment(conv.id, service.user.id)

    const res = await service.client.get(
      `/v1/chats/${conv.id}/attachments`,
      header,
    )

    expect(res.status).toBe(404)
  })
})

describe('GET /v1/chats/:conversationId/attachments/:id/download', () => {
  let orgSlug: string
  let header: ReturnType<typeof orgHeader>

  beforeEach(async () => {
    orgSlug = await seedOrg()
    header = orgHeader(orgSlug)
  })

  it('returns a presigned URL with expiry', async () => {
    const s3 = mockS3()
    const conv = await seedConversation(orgSlug)
    const att = await seedAttachment(conv.id, service.user.id)

    const res = await service.client.get(
      `/v1/chats/${conv.id}/attachments/${att.id}/download`,
      header,
    )

    expect(res.status).toBe(200)
    expect(res.data.url).toBe('https://s3.example/signed-url')
    expect(typeof res.data.expiresAt).toBe('string')
    expect(s3.view).toHaveBeenCalledWith(
      'goodparty-chat-attachments-test',
      att.storageKey,
      { expiresIn: 900 },
    )
  })

  it('returns 404 for an unknown attachment', async () => {
    const conv = await seedConversation(orgSlug)

    const res = await service.client.get(
      `/v1/chats/${conv.id}/attachments/no-such-id/download`,
      header,
    )

    expect(res.status).toBe(404)
  })

  it('returns 404 when conversation belongs to a different user', async () => {
    const otherUser = await service.prisma.user.create({
      data: {
        clerkId: `other-${Math.random().toString(36).slice(2)}`,
        email: 'other-dl@test.com',
      },
    })
    const conv = await seedConversation(
      orgSlug,
      ChatScope.chief_of_staff,
      otherUser.id,
    )
    const att = await seedAttachment(conv.id, otherUser.id)

    const res = await service.client.get(
      `/v1/chats/${conv.id}/attachments/${att.id}/download`,
      header,
    )

    expect(res.status).toBe(404)
  })
})

describe('DELETE /v1/chats/:conversationId/attachments/:id', () => {
  let orgSlug: string
  let header: ReturnType<typeof orgHeader>

  beforeEach(async () => {
    orgSlug = await seedOrg()
    header = orgHeader(orgSlug)
  })

  it('deletes the S3 object and the row, returns 204', async () => {
    const s3 = mockS3()
    const conv = await seedConversation(orgSlug)
    const att = await seedAttachment(conv.id, service.user.id)

    const res = await service.client.delete(
      `/v1/chats/${conv.id}/attachments/${att.id}`,
      header,
    )

    expect(res.status).toBe(204)
    expect(s3.del).toHaveBeenCalledWith(
      'goodparty-chat-attachments-test',
      att.storageKey,
    )
    const row = await service.prisma.chatAttachment.findUnique({
      where: { id: att.id },
    })
    expect(row).toBeNull()
  })

  it('returns 404 on a repeat delete', async () => {
    mockS3()
    const conv = await seedConversation(orgSlug)
    const att = await seedAttachment(conv.id, service.user.id)

    await service.client.delete(
      `/v1/chats/${conv.id}/attachments/${att.id}`,
      header,
    )
    const second = await service.client.delete(
      `/v1/chats/${conv.id}/attachments/${att.id}`,
      header,
    )

    expect(second.status).toBe(404)
  })

  it('still deletes the row (204) when the best-effort S3 delete fails', async () => {
    const s3 = service.app.get(S3Service)
    vi.spyOn(s3, 'deleteObject').mockRejectedValue(new Error('S3 failure'))
    const conv = await seedConversation(orgSlug)
    const att = await seedAttachment(conv.id, service.user.id)

    const res = await service.client.delete(
      `/v1/chats/${conv.id}/attachments/${att.id}`,
      header,
    )

    expect(res.status).toBe(204)
    const row = await service.prisma.chatAttachment.findUnique({
      where: { id: att.id },
    })
    expect(row).toBeNull()
  })

  it('returns 404 when conversation belongs to a different user', async () => {
    const otherUser = await service.prisma.user.create({
      data: {
        clerkId: `other-${Math.random().toString(36).slice(2)}`,
        email: 'other-del@test.com',
      },
    })
    const conv = await seedConversation(
      orgSlug,
      ChatScope.chief_of_staff,
      otherUser.id,
    )
    const att = await seedAttachment(conv.id, otherUser.id)

    const res = await service.client.delete(
      `/v1/chats/${conv.id}/attachments/${att.id}`,
      header,
    )

    expect(res.status).toBe(404)
  })
})
