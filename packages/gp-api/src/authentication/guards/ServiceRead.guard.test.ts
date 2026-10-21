import axios from 'axios'
import jwt from 'jsonwebtoken'
import { describe, expect, it, vi } from 'vitest'
import { UserRole } from '../../generated/prisma'
import {
  AUTH_PROVIDER_TOKEN,
  AuthProvider,
} from '@/authentication/interfaces/auth-provider.interface'
import { signTestM2MJwt, useTestService } from '@/test-service'

const service = useTestService()

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
    'serves $path to a JWT-format M2M token',
    async ({ path, params }) => {
      await service.prisma.personProfileRemoval.create({
        data: { personId: PERSON_ID, appliedBy: 'ops@goodparty.org' },
      })
      const res = await service.client.get(path, {
        params,
        ...withBearer(signTestM2MJwt()),
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

  it('403s a JWT signed with the wrong key, even with an mch_ subject', async () => {
    const forged = jwt.sign({ sub: 'mch_forged' }, 'not-the-secret', {
      expiresIn: '1h',
    })
    const res = await service.client.get(
      '/v1/public-person-profiles/unlisted',
      {
        ...withBearer(forged),
      },
    )
    expect(res.status).toBe(403)
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

  it('does not let a JWT-format M2M token through AdminOrM2MGuard', async () => {
    // Any machine in the Clerk instance can mint a JWT that verifies, so it
    // must stay a read tier and never act as a full M2M caller.
    const res = await service.client.post(
      '/v1/person-profiles/removals',
      { personId: PERSON_ID, appliedBy: 'privacy@goodparty.org' },
      withBearer(signTestM2MJwt()),
    )

    expect(res.status).toBe(401)
    expect(
      await service.prisma.personProfileRemoval.count({
        where: { personId: PERSON_ID },
      }),
    ).toBe(0)
  })

  it('does not let a JWT-format M2M token onto a plain authenticated route', async () => {
    const res = await service.client.get(
      '/v1/person-profiles/mine',
      withBearer(signTestM2MJwt()),
    )

    expect(res.status).toBe(401)
  })
})
