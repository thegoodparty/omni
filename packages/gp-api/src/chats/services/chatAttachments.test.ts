import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeaturesService } from '@/features/services/features.service'
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
