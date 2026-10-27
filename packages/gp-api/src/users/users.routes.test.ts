import { useTestService } from '@/test-service'
import { BadGatewayException, HttpStatus } from '@nestjs/common'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'
import { ClerkClient } from '@clerk/backend'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  const clerkUpdateUser = () =>
    vi.spyOn(
      service.app.get<ClerkClient>(CLERK_CLIENT_PROVIDER_TOKEN).users,
      'updateUser',
    )

  beforeEach(() => {
    clerkUpdateUser().mockResolvedValue({} as never)
  })

  it('rebuilds the full name and copies the change to Clerk', async () => {
    const updateUser = clerkUpdateUser().mockResolvedValue({} as never)

    const res = await service.client.put('/v1/users/me', {
      firstName: 'Deepti',
      lastName: 'Garg',
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
    expect(updateUser).toHaveBeenCalledWith(service.user.clerkId, {
      firstName: 'Deepti',
      lastName: 'Garg',
    })
  })

  it('rebuilds the full name from the stored last name when only the first name changes', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { firstName: 'Sumit', lastName: 'Garg', name: 'Sumit Garg' },
    })
    const updateUser = clerkUpdateUser().mockResolvedValue({} as never)

    const res = await service.client.put('/v1/users/me', {
      firstName: 'Deepti',
    })

    expect(res.status).toBe(HttpStatus.OK)
    const persisted = await service.prisma.user.findUniqueOrThrow({
      where: { id: service.user.id },
    })
    expect(persisted.name).toBe('Deepti Garg')
    expect(updateUser).toHaveBeenCalledWith(service.user.clerkId, {
      firstName: 'Deepti',
      lastName: 'Garg',
    })
  })

  it('keeps the saved name when the Clerk copy fails', async () => {
    clerkUpdateUser().mockRejectedValue(new Error('clerk down'))

    const res = await service.client.put('/v1/users/me', {
      firstName: 'Deepti',
      lastName: 'Garg',
    })

    expect(res.status).toBe(HttpStatus.OK)
    const persisted = await service.prisma.user.findUniqueOrThrow({
      where: { id: service.user.id },
    })
    expect(persisted.firstName).toBe('Deepti')
  })

  it('does not touch Clerk or the full name when the name is unchanged', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { firstName: 'Deepti', lastName: 'Garg', name: 'Dr. Deepti Garg' },
    })
    const updateUser = clerkUpdateUser().mockResolvedValue({} as never)

    const res = await service.client.put('/v1/users/me', {
      firstName: 'Deepti',
      zip: '94587',
    })

    expect(res.status).toBe(HttpStatus.OK)
    const persisted = await service.prisma.user.findUniqueOrThrow({
      where: { id: service.user.id },
    })
    expect(persisted.name).toBe('Dr. Deepti Garg')
    expect(updateUser).not.toHaveBeenCalled()
  })

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

describe('PUT /v1/users/me email', () => {
  beforeEach(() => {
    vi.spyOn(
      service.app.get<ClerkClient>(CLERK_CLIENT_PROVIDER_TOKEN).users,
      'updateUser',
    ).mockResolvedValue({} as never)
  })

  it('ignores an email in the body and saves the other fields', async () => {
    const before = service.user.email

    const res = await service.client.put('/v1/users/me', {
      email: 'someone@goodparty.org',
      zip: '94587',
    })

    expect(res.status).toBe(HttpStatus.OK)
    const persisted = await service.prisma.user.findUniqueOrThrow({
      where: { id: service.user.id },
    })
    expect(persisted.email).toBe(before)
    expect(persisted.zip).toBe('94587')
  })
})

describe('POST /v1/users/me/sync-email', () => {
  const clerkGetUser = (
    primary: { emailAddress: string; status: string } | null,
  ) =>
    vi
      .spyOn(
        service.app.get<ClerkClient>(CLERK_CLIENT_PROVIDER_TOKEN).users,
        'getUser',
      )
      .mockResolvedValue({
        primaryEmailAddress: primary && {
          emailAddress: primary.emailAddress,
          verification: { status: primary.status },
        },
        emailAddresses: primary
          ? [
              {
                emailAddress: primary.emailAddress,
                verification: { status: primary.status },
              },
            ]
          : [],
      } as never)

  it('copies the verified Clerk primary email onto the user', async () => {
    const getUser = clerkGetUser({
      emailAddress: ' New.Address@Example.com ',
      status: 'verified',
    })

    const res = await service.client.post('/v1/users/me/sync-email')

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.email).toBe('new.address@example.com')
    expect(getUser).toHaveBeenCalledWith(service.user.clerkId)
    const persisted = await service.prisma.user.findUniqueOrThrow({
      where: { id: service.user.id },
    })
    expect(persisted.email).toBe('new.address@example.com')
  })

  it('leaves the email alone when Clerk has no verified address', async () => {
    const before = service.user.email
    clerkGetUser({ emailAddress: 'staff@goodparty.org', status: 'unverified' })

    const res = await service.client.post('/v1/users/me/sync-email')

    expect(res.status).toBe(HttpStatus.OK)
    const persisted = await service.prisma.user.findUniqueOrThrow({
      where: { id: service.user.id },
    })
    expect(persisted.email).toBe(before)
  })

  it('refuses an email another account already holds', async () => {
    const before = service.user.email
    await service.prisma.user.create({
      data: { email: 'taken@example.com', firstName: 'Ta', lastName: 'Ken' },
    })
    clerkGetUser({ emailAddress: 'Taken@example.com', status: 'verified' })

    const res = await service.client.post('/v1/users/me/sync-email')

    expect(res.status).toBe(HttpStatus.CONFLICT)
    const persisted = await service.prisma.user.findUniqueOrThrow({
      where: { id: service.user.id },
    })
    expect(persisted.email).toBe(before)
  })

  it('rejects an anonymous request', async () => {
    const res = await service.client.post('/v1/users/me/sync-email', null, {
      headers: { Authorization: 'Bearer not-a-valid-token' },
    })

    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
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
