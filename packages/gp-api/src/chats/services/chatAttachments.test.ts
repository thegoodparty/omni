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

  const stubRoutes = [
    ['POST', `/v1/chats/${conversationId}/attachments/presign`],
    ['POST', `/v1/chats/${conversationId}/attachments`],
  ] as const

  const linkPath = `/v1/chats/${conversationId}/attachments/link`

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

    for (const [method, path] of [...stubRoutes, ['POST', linkPath] as const]) {
      it(`${method} ${path} → 404`, async () => {
        const res = await service.client.post(path, {}, header)
        expect(res.status).toBe(404)
      })
    }
  })

  describe('flag on → 501 (stub endpoints)', () => {
    for (const [method, path] of stubRoutes) {
      it(`${method} ${path} → 501`, async () => {
        // Placeholder key defaults to true in test env; no spy needed.
        const res = await service.client.post(path, {}, header)
        expect(res.status).toBe(501)
      })
    }
  })

  describe('POST /attachments/link — flag on', () => {
    it('rejects a body with no url field → 400', async () => {
      const res = await service.client.post(linkPath, {}, header)
      expect(res.status).toBe(400)
    })

    it('rejects unknown body fields → 400', async () => {
      const res = await service.client.post(
        linkPath,
        { url: 'https://example.com', storageKey: 'hacked' },
        header,
      )
      expect(res.status).toBe(400)
    })

    it('returns 404 when conversation does not exist', async () => {
      const res = await service.client.post(
        linkPath,
        { url: 'https://example.com' },
        header,
      )
      expect(res.status).toBe(404)
    })
  })
})
