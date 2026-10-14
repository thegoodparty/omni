import {
  AUTH_PROVIDER_TOKEN,
  AuthProvider,
} from '@/authentication/interfaces/auth-provider.interface'
import { TEST_CLERK_ID, useTestService } from '@/test-service'
import { HttpStatus } from '@nestjs/common'
import { User, UserRole } from '../../generated/prisma'
import { UsersService } from 'src/users/services/users.service'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = useTestService()

const STAFF_EMAIL = 'staff@goodparty.org'
const STAFF_CLERK_ID = 'user_staff_clerk_id'
const CANDIDATE_EMAIL = 'candidate@example.com'
const M2M_HEADERS = { Authorization: 'Bearer mt_test' }

const ROUTES = [
  { name: 'impersonate', path: 'impersonate' },
  { name: 'sign-in-link', path: 'sign-in-link' },
] as const

describe('M2M admin user actions require a staff actor', () => {
  let target: User
  let usersService: UsersService

  beforeEach(async () => {
    target = await service.prisma.user.create({
      data: {
        email: 'target@example.com',
        firstName: 'Target',
        lastName: 'User',
        clerkId: 'user_target_clerk_id',
        roles: [UserRole.candidate],
      },
    })
    await service.prisma.user.create({
      data: {
        email: STAFF_EMAIL,
        firstName: 'Staff',
        lastName: 'Member',
        clerkId: STAFF_CLERK_ID,
        roles: [UserRole.admin],
      },
    })
    await service.prisma.user.create({
      data: {
        email: CANDIDATE_EMAIL,
        firstName: 'Not',
        lastName: 'Staff',
        clerkId: 'user_candidate_clerk_id',
        roles: [UserRole.candidate],
      },
    })

    vi.spyOn(
      service.app.get<AuthProvider>(AUTH_PROVIDER_TOKEN),
      'verifyM2MToken',
    ).mockResolvedValue({ id: 'mt_test', subject: 'gp-admin' })

    usersService = service.app.get(UsersService)
    vi.spyOn(usersService, 'impersonateUser').mockResolvedValue({
      token: 'actor_token',
    })
    vi.spyOn(usersService, 'createSignInLink').mockResolvedValue({
      token: 'signin_token',
      clerkId: target.clerkId!,
      expiresAt: '2026-01-01T01:00:00.000Z',
    })
  })

  describe('POST /v1/admin/users/impersonate/:id', () => {
    it('impersonates as the staff actor named by an M2M caller', async () => {
      const result = await service.client.post(
        `/v1/admin/users/impersonate/${target.id}`,
        { actorEmail: 'STAFF@goodparty.org' },
        { headers: M2M_HEADERS },
      )

      expect(result.status).toBe(HttpStatus.CREATED)
      expect(result.data).toEqual({ token: 'actor_token' })
      expect(usersService.impersonateUser).toHaveBeenCalledWith(
        target.id,
        STAFF_CLERK_ID,
      )
    })

    it('still impersonates as the session user for a staff session', async () => {
      await service.prisma.user.update({
        where: { id: service.user.id },
        data: { roles: [UserRole.admin] },
      })

      const result = await service.client.post(
        `/v1/admin/users/impersonate/${target.id}`,
        {},
      )

      expect(result.status).toBe(HttpStatus.CREATED)
      expect(usersService.impersonateUser).toHaveBeenCalledWith(
        target.id,
        TEST_CLERK_ID,
      )
    })
  })

  describe('POST /v1/admin/users/sign-in-link/:id', () => {
    it('mints a link for an M2M caller naming a staff actor', async () => {
      const result = await service.client.post(
        `/v1/admin/users/sign-in-link/${target.id}`,
        { actorEmail: STAFF_EMAIL },
        { headers: M2M_HEADERS },
      )

      expect(result.status).toBe(HttpStatus.OK)
      expect(result.data.url).toContain('__clerk_ticket=signin_token')
      expect(usersService.createSignInLink).toHaveBeenCalledWith(target.id)
    })

    it('still mints a link for a staff session with no actorEmail', async () => {
      await service.prisma.user.update({
        where: { id: service.user.id },
        data: { roles: [UserRole.admin] },
      })

      const result = await service.client.post(
        `/v1/admin/users/sign-in-link/${target.id}`,
        {},
      )

      expect(result.status).toBe(HttpStatus.OK)
      expect(usersService.createSignInLink).toHaveBeenCalledWith(target.id)
    })
  })

  describe.each(ROUTES)('$name rejects an M2M caller', ({ path }) => {
    const post = (body: { actorEmail?: string }) =>
      service.client.post(`/v1/admin/users/${path}/${target.id}`, body, {
        headers: M2M_HEADERS,
      })

    const expectNothingIssued = () => {
      expect(usersService.impersonateUser).not.toHaveBeenCalled()
      expect(usersService.createSignInLink).not.toHaveBeenCalled()
    }

    it('that names no actor', async () => {
      const result = await post({})

      expect(result.status).toBe(HttpStatus.BAD_REQUEST)
      expectNothingIssued()
    })

    it('whose actor has no gp-api account', async () => {
      const result = await post({ actorEmail: 'nobody@goodparty.org' })

      expect(result.status).toBe(HttpStatus.FORBIDDEN)
      expectNothingIssued()
    })

    it('whose actor is not an admin', async () => {
      const result = await post({ actorEmail: CANDIDATE_EMAIL })

      expect(result.status).toBe(HttpStatus.FORBIDDEN)
      expectNothingIssued()
    })
  })
})
