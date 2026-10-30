import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { signTestVercelOidcToken, useTestVercelOidc } from '@/test-vercel-oidc'
import {
  AUTH_PROVIDER_TOKEN,
  AuthProvider,
} from '@/authentication/interfaces/auth-provider.interface'
import { WebsiteStatus } from '../../generated/prisma'

const service = useTestService()
useTestVercelOidc()

const VANITY_PATH = 'jordan-for-council'
const DOMAIN = 'jordanforcouncil.com'

const READS = [
  { path: `/v1/websites/${VANITY_PATH}/view` },
  { path: `/v1/websites/by-domain/${DOMAIN}` },
]

const withBearer = (token: string) => ({
  headers: { Authorization: `Bearer ${token}` },
})

describe('public website reads', () => {
  beforeEach(async () => {
    await service.prisma.organization.create({
      data: { slug: 'org-public-reads', ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        id: 1,
        organizationSlug: 'org-public-reads',
        userId: service.user.id,
        slug: 'jordan-smith',
        isActive: true,
      },
    })
    const website = await service.prisma.website.create({
      data: {
        campaignId: 1,
        vanityPath: VANITY_PATH,
        status: WebsiteStatus.published,
        content: {},
      },
    })
    await service.prisma.domain.create({
      data: { name: DOMAIN, websiteId: website.id },
    })
  })

  it.each(READS)('403s $path with no token', async ({ path }) => {
    const res = await axios.get(path, {
      baseURL: service.client.defaults.baseURL,
      validateStatus: () => true,
    })

    expect(res.status).toBe(403)
  })

  it.each(READS)(
    '403s $path for a logged-in user who is not an admin',
    async ({ path }) => {
      const res = await service.client.get(path)

      expect(res.status).toBe(403)
    },
  )

  it.each(READS)('serves $path to a Vercel OIDC token', async ({ path }) => {
    const res = await service.client.get(
      path,
      withBearer(signTestVercelOidcToken()),
    )

    expect(res.status).toBe(200)
    expect(res.data.vanityPath).toBe(VANITY_PATH)
  })

  it.each(READS)(
    'serves $path to an opaque mt_ M2M token',
    async ({ path }) => {
      const verify = vi
        .spyOn(
          service.app.get<AuthProvider>(AUTH_PROVIDER_TOKEN),
          'verifyM2MToken',
        )
        .mockResolvedValue({ id: 'mt_test', subject: 'test-machine' })

      const res = await service.client.get(path, withBearer('mt_test'))

      expect(res.status).toBe(200)
      expect(res.data.vanityPath).toBe(VANITY_PATH)
      verify.mockRestore()
    },
  )
})
