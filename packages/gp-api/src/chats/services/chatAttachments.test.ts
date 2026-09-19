import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChatAttachmentSource,
  ChatAttachmentStatus,
  ChatScope,
} from '../../generated/prisma'
import { FeaturesService } from '@/features/services/features.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { useTestService } from '@/test-service'
import { SERVE_CHAT_ATTACHMENTS_FLAG } from './chatAttachments.service'

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
  userId: number,
  scope = ChatScope.chief_of_staff,
) =>
  service.prisma.chatConversation.create({
    data: { ownerUserId: userId, scope },
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
    ['POST', `/v1/chats/${conversationId}/attachments/presign`],
    ['POST', `/v1/chats/${conversationId}/attachments`],
    ['POST', `/v1/chats/${conversationId}/attachments/link`],
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

    for (const [method, path] of routes) {
      it(`${method} ${path} → 404`, async () => {
        const res = await service.client.post(path, {}, header)
        expect(res.status).toBe(404)
      })
    }
  })

  describe('flag on → 501', () => {
    for (const [method, path] of routes) {
      it(`${method} ${path} → 501`, async () => {
        // Placeholder key defaults to true in test env; no spy needed.
        const res = await service.client.post(path, {}, header)
        expect(res.status).toBe(501)
      })
    }
  })
})

describe('GET /v1/chats/:conversationId/attachments', () => {
  let header: ReturnType<typeof orgHeader>

  beforeEach(async () => {
    const slug = await seedOrg()
    header = orgHeader(slug)
  })

  it('returns attachments in createdAt order', async () => {
    const conv = await seedConversation(service.user.id)
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
    const conv = await seedConversation(service.user.id)
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
    const conv = await seedConversation(
      service.user.id,
      ChatScope.campaign_assistant,
    )

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
    const conv = await seedConversation(otherUser.id)

    const res = await service.client.get(
      `/v1/chats/${conv.id}/attachments`,
      header,
    )

    expect(res.status).toBe(404)
  })
})

describe('GET /v1/chats/:conversationId/attachments/:id/download', () => {
  let header: ReturnType<typeof orgHeader>

  beforeEach(async () => {
    const slug = await seedOrg()
    header = orgHeader(slug)
  })

  it('returns a presigned URL with expiry', async () => {
    const s3 = mockS3()
    const conv = await seedConversation(service.user.id)
    const att = await seedAttachment(conv.id, service.user.id)

    const res = await service.client.get(
      `/v1/chats/${conv.id}/attachments/${att.id}/download`,
      header,
    )

    expect(res.status).toBe(200)
    expect(res.data.url).toBe('https://s3.example/signed-url')
    expect(typeof res.data.expiresAt).toBe('string')
    expect(s3.view).toHaveBeenCalledWith(
      'chat-attachments-test',
      att.storageKey,
      { expiresIn: 900 },
    )
  })

  it('returns 404 for an unknown attachment', async () => {
    const conv = await seedConversation(service.user.id)

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
    const conv = await seedConversation(otherUser.id)
    const att = await seedAttachment(conv.id, otherUser.id)

    const res = await service.client.get(
      `/v1/chats/${conv.id}/attachments/${att.id}/download`,
      header,
    )

    expect(res.status).toBe(404)
  })
})

describe('DELETE /v1/chats/:conversationId/attachments/:id', () => {
  let header: ReturnType<typeof orgHeader>

  beforeEach(async () => {
    const slug = await seedOrg()
    header = orgHeader(slug)
  })

  it('deletes the S3 object and the row, returns 204', async () => {
    const s3 = mockS3()
    const conv = await seedConversation(service.user.id)
    const att = await seedAttachment(conv.id, service.user.id)

    const res = await service.client.delete(
      `/v1/chats/${conv.id}/attachments/${att.id}`,
      header,
    )

    expect(res.status).toBe(204)
    expect(s3.del).toHaveBeenCalledWith('chat-attachments-test', att.storageKey)
    const row = await service.prisma.chatAttachment.findUnique({
      where: { id: att.id },
    })
    expect(row).toBeNull()
  })

  it('returns 404 on a repeat delete', async () => {
    mockS3()
    const conv = await seedConversation(service.user.id)
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

  it('returns 502 and leaves the row intact when S3 delete fails', async () => {
    const s3 = service.app.get(S3Service)
    vi.spyOn(s3, 'deleteObject').mockRejectedValue(new Error('S3 failure'))
    const conv = await seedConversation(service.user.id)
    const att = await seedAttachment(conv.id, service.user.id)

    const res = await service.client.delete(
      `/v1/chats/${conv.id}/attachments/${att.id}`,
      header,
    )

    expect(res.status).toBe(502)
    const row = await service.prisma.chatAttachment.findUnique({
      where: { id: att.id },
    })
    expect(row).not.toBeNull()
  })

  it('returns 404 when conversation belongs to a different user', async () => {
    const otherUser = await service.prisma.user.create({
      data: {
        clerkId: `other-${Math.random().toString(36).slice(2)}`,
        email: 'other-del@test.com',
      },
    })
    const conv = await seedConversation(otherUser.id)
    const att = await seedAttachment(conv.id, otherUser.id)

    const res = await service.client.delete(
      `/v1/chats/${conv.id}/attachments/${att.id}`,
      header,
    )

    expect(res.status).toBe(404)
  })
})
