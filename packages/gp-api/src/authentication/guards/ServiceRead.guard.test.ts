import axios from 'axios'
import { describe, expect, it, vi } from 'vitest'
import { UserRole } from '../../generated/prisma'
import {
  AUTH_PROVIDER_TOKEN,
  AuthProvider,
} from '@/authentication/interfaces/auth-provider.interface'
import { useTestService } from '@/test-service'
import { signTestVercelOidcToken, useTestVercelOidc } from '@/test-vercel-oidc'

const service = useTestService()
useTestVercelOidc()

const PERSON_ID = '33333333-3333-4333-8333-333333333333'

const READS = [
  { path: '/v1/public-person-profiles', params: { personId: PERSON_ID } },
  { path: '/v1/public-person-profiles/published', params: {} },
  { path: '/v1/public-person-profiles/unlisted', params: {} },
]

const withBearer = (token: string) => ({
  headers: { Authorization: `Bearer ${token}` },
})

describe('ServiceReadGuard and ServiceReadOrOwnerGuard on the public person-profile reads', () => {
  it.each(READS)('403s $path with no token', async ({ path, params }) => {
    const res = await axios.get(path, {
      baseURL: service.client.defaults.baseURL,
      params,
      validateStatus: () => true,
    })
    expect(res.status).toBe(403)
  })

  it.each(READS)(
    '403s $path for a logged-in user who is not the owner',
    async ({ path, params }) => {
      const res = await service.client.get(path, { params })
      expect(res.status).toBe(403)
    },
  )

  it.each(READS)(
    'serves $path to a Vercel OIDC token',
    async ({ path, params }) => {
      await service.prisma.personProfileRemoval.create({
        data: { personId: PERSON_ID, appliedBy: 'ops@goodparty.org' },
      })
      const res = await service.client.get(path, {
        params,
        ...withBearer(signTestVercelOidcToken()),
      })
      expect(res.status).toBe(200)
    },
  )

  it.each(READS)(
    'serves $path to an opaque mt_ M2M token',
    async ({ path, params }) => {
      vi.spyOn(
        service.app.get<AuthProvider>(AUTH_PROVIDER_TOKEN),
        'verifyM2MToken',
      ).mockResolvedValue({ id: 'mt_test', subject: 'test-machine' })
      await service.prisma.personProfileRemoval.create({
        data: { personId: PERSON_ID, appliedBy: 'ops@goodparty.org' },
      })
      const res = await service.client.get(path, {
        params,
        ...withBearer('mt_test'),
      })
      expect(res.status).toBe(200)
    },
  )

  it.each(READS)('serves $path to an admin', async ({ path, params }) => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.admin] },
    })
    await service.prisma.personProfileRemoval.create({
      data: { personId: PERSON_ID, appliedBy: 'ops@goodparty.org' },
    })
    const res = await service.client.get(path, { params })
    expect(res.status).toBe(200)
  })

  it('serves the render gate to the owner of the requested personId', async () => {
    // The release-train e2e reads its own minted personId as a plain user.
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { personId: PERSON_ID },
    })
    await service.prisma.personProfileRemoval.create({
      data: { personId: PERSON_ID, appliedBy: 'ops@goodparty.org' },
    })

    const res = await service.client.get('/v1/public-person-profiles', {
      params: { personId: PERSON_ID.toUpperCase() },
    })

    expect(res.status).toBe(200)
    expect(res.data.removed).toBe(true)
  })

  it.each([
    '/v1/public-person-profiles/published',
    '/v1/public-person-profiles/unlisted',
  ])('403s %s for a user who passes their own personId', async (path) => {
    // The owner clause belongs to the render gate alone; on a list route the
    // query param names nothing, so honouring it would self-authorize.
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { personId: PERSON_ID },
    })

    const res = await service.client.get(path, {
      params: { personId: PERSON_ID },
    })

    expect(res.status).toBe(403)
  })

  it("403s the render gate for someone else's personId", async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { personId: '44444444-4444-4444-8444-444444444444' },
    })

    const res = await service.client.get('/v1/public-person-profiles', {
      params: { personId: PERSON_ID },
    })

    expect(res.status).toBe(403)
  })
})
