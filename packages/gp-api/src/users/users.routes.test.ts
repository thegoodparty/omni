import { useTestService } from '@/test-service'
import { BadGatewayException, HttpStatus } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { ClerkClient } from '@clerk/backend'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'
import { TEST_CLERK_ID } from '@/test-service'
import { UsersService } from './services/users.service'
import { CrmUsersService } from './services/crmUsers.service'

// Route-level coverage lives in its own file: users.service.test.ts calls
// vi.restoreAllMocks(), which unwinds the test harness's verifySessionToken
// spy and 401s every HTTP request made after those suites.
const service = useTestService()

describe('GET /v1/users/me', () => {
  it('includes createdAt in the response', async () => {
    const res = await service.client.get('/v1/users/me')

    expect(res.status).toBe(HttpStatus.OK)
    expect(new Date(res.data.createdAt).getTime()).toBe(
      service.user.createdAt.getTime(),
    )
  })

  it('survives response validation with a single-character name', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { firstName: 'A', lastName: 'B' },
    })

    const res = await service.client.get('/v1/users/me')

    expect(res.status).toBe(HttpStatus.OK)
  })
})

describe('PUT /v1/users/me', () => {
  it('capitalizes an all-lowercase name and keeps mixed case as typed', async () => {
    const res = await service.client.put('/v1/users/me', {
      firstName: 'stewart',
      lastName: 'de La Cruz',
    })

    expect(res.status).toBe(HttpStatus.OK)
    const persisted = await service.prisma.user.findUniqueOrThrow({
      where: { id: service.user.id },
    })
    expect(persisted).toMatchObject({
      firstName: 'Stewart',
      lastName: 'de La Cruz',
    })
  })
})

describe('name changes', () => {
  const clerkUpdate = () => {
    const clerkClient = service.app.get<ClerkClient>(
      CLERK_CLIENT_PROVIDER_TOKEN,
    )
    return vi.spyOn(clerkClient.users, 'updateUser')
  }

  it('PUT /v1/users/me rebuilds name and copies it to Clerk', async () => {
    const updateUser = clerkUpdate().mockResolvedValue(
      {} as Awaited<ReturnType<ClerkClient['users']['updateUser']>>,
    )
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { firstName: 'Sumit', lastName: 'Garg', name: 'Sumit Garg' },
    })

    const res = await service.client.put('/v1/users/me', {
      firstName: 'Deepti',
    })

    expect(res.status).toBe(HttpStatus.OK)
    const persisted = await service.prisma.user.findUniqueOrThrow({
      where: { id: service.user.id },
    })
    expect(persisted).toMatchObject({
      firstName: 'Deepti',
      lastName: 'Garg',
      name: 'Deepti Garg',
    })
    expect(updateUser).toHaveBeenCalledWith(TEST_CLERK_ID, {
      firstName: 'Deepti',
      lastName: 'Garg',
    })
  })

  it('keeps an explicitly sent name', async () => {
    clerkUpdate().mockResolvedValue(
      {} as Awaited<ReturnType<ClerkClient['users']['updateUser']>>,
    )

    const res = await service.client.put('/v1/users/me', {
      firstName: 'Deepti',
      name: 'Dr Deepti',
    })

    expect(res.status).toBe(HttpStatus.OK)
    const persisted = await service.prisma.user.findUniqueOrThrow({
      where: { id: service.user.id },
    })
    expect(persisted.name).toBe('Dr Deepti')
  })

  it('does not fail the request when Clerk fails', async () => {
    clerkUpdate().mockRejectedValue(new Error('clerk down'))

    const res = await service.client.put('/v1/users/me', {
      firstName: 'Priya',
      lastName: 'Rao',
    })

    expect(res.status).toBe(HttpStatus.OK)
    const persisted = await service.prisma.user.findUniqueOrThrow({
      where: { id: service.user.id },
    })
    expect(persisted).toMatchObject({ firstName: 'Priya', name: 'Priya Rao' })
  })

  it('does not call Clerk when no name part changes', async () => {
    const updateUser = clerkUpdate()

    const res = await service.client.put('/v1/users/me', {
      phone: '+15555550123',
    })

    expect(res.status).toBe(HttpStatus.OK)
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('admin updates (PUT /v1/users/:id is M2M-only) share the same path', async () => {
    // The admin route sits behind M2MOnly, which the harness user token cannot
    // pass, so drive the service method the controller delegates to.
    const updateUser = clerkUpdate().mockResolvedValue(
      {} as Awaited<ReturnType<ClerkClient['users']['updateUser']>>,
    )

    const updated = await service.app
      .get(UsersService)
      .updateUser({ id: service.user.id }, { lastName: 'Newname' })

    expect(updated.name).toBe(`${updated.firstName} Newname`)
    expect(updateUser).toHaveBeenCalledWith(TEST_CLERK_ID, {
      firstName: updated.firstName,
      lastName: 'Newname',
    })
  })
})

describe('POST /v1/users/me/crm-registration', () => {
  const REGISTER_FORM_ID = '37d98f01-7062-405f-b0d1-c95179057db1'

  it('submits the registration CRM form with the visitor hutk', async () => {
    const crm = service.app.get(CrmUsersService)
    const submitCrmForm = vi
      .spyOn(crm, 'submitCrmForm')
      .mockResolvedValue(undefined)

    const res = await service.client.post('/v1/users/me/crm-registration', {
      hutk: 'visitor-hutk-value',
    })

    expect(res.status).toBe(HttpStatus.NO_CONTENT)
    expect(submitCrmForm).toHaveBeenCalledWith(
      REGISTER_FORM_ID,
      expect.arrayContaining([
        { name: 'email', value: service.user.email, objectTypeId: '0-1' },
      ]),
      'registerPage',
      expect.stringContaining('/sign-up'),
      'visitor-hutk-value',
    )
  })

  it('still submits the form without a hutk', async () => {
    const crm = service.app.get(CrmUsersService)
    const submitCrmForm = vi
      .spyOn(crm, 'submitCrmForm')
      .mockResolvedValue(undefined)

    const res = await service.client.post('/v1/users/me/crm-registration', {})

    expect(res.status).toBe(HttpStatus.NO_CONTENT)
    expect(submitCrmForm).toHaveBeenCalledWith(
      REGISTER_FORM_ID,
      expect.arrayContaining([
        { name: 'email', value: service.user.email, objectTypeId: '0-1' },
      ]),
      'registerPage',
      expect.stringContaining('/sign-up'),
      undefined,
    )
  })

  it('surfaces a HubSpot failure as 502', async () => {
    const crm = service.app.get(CrmUsersService)
    vi.spyOn(crm, 'submitCrmForm').mockRejectedValue(
      new BadGatewayException('Error submitting form to HubSpot'),
    )

    const res = await service.client.post('/v1/users/me/crm-registration', {
      hutk: 'visitor-hutk-value',
    })

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
  })

  it('rejects an anonymous request', async () => {
    const res = await service.client.post(
      '/v1/users/me/crm-registration',
      { hutk: 'visitor-hutk-value' },
      { headers: { Authorization: 'Bearer not-a-valid-token' } },
    )

    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
  })
})
