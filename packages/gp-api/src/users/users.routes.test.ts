import { useTestService } from '@/test-service'
import { BadGatewayException, HttpStatus } from '@nestjs/common'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'
import { ClerkClient } from '@clerk/backend'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { AnalyticsService } from '@/analytics/analytics.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { CrmUsersService } from './services/crmUsers.service'
import { UserRole } from '../generated/prisma'

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

describe('GET /v1/users/:id', () => {
  const seedOtherUser = () =>
    service.prisma.user.create({
      data: {
        email: 'other@goodparty.org',
        firstName: 'Other',
        lastName: 'Person',
        password: 'other-hash',
        passwordResetToken: 'other-reset-token',
      },
    })

  it('returns the owner without the password or reset token', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { password: 'stored-hash', passwordResetToken: 'reset-token' },
    })

    const res = await service.client.get(`/v1/users/${service.user.id}`)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.id).toBe(service.user.id)
    expect(res.data).not.toHaveProperty('password')
    expect(res.data).not.toHaveProperty('passwordResetToken')
  })

  it("403s a non-admin reading another user's record", async () => {
    const other = await seedOtherUser()

    const res = await service.client.get(`/v1/users/${other.id}`)

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it("returns another user's record to an admin without the password or reset token", async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.admin] },
    })
    const other = await seedOtherUser()

    const res = await service.client.get(`/v1/users/${other.id}`)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.id).toBe(other.id)
    expect(res.data).not.toHaveProperty('password')
    expect(res.data).not.toHaveProperty('passwordResetToken')
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

describe("account deletion purges the owned orgs' contact upload files", () => {
  const seedOwnerWithUploads = async () => {
    const owner = await service.prisma.user.create({
      data: { email: `upload-owner-${randomUUID()}@goodparty.org` },
    })
    const slug = `eo-${randomUUID()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: owner.id },
    })
    const keys = [`${slug}/${randomUUID()}.csv`, `${slug}/${randomUUID()}.csv`]
    for (const fileKey of keys) {
      await service.prisma.contactUpload.create({
        data: {
          organizationSlug: slug,
          name: 'Newsletter',
          fileName: 'people.csv',
          fileKey,
          firstNameColumn: 'First',
          lastNameColumn: 'Last',
          consentAffirmedAt: new Date(),
        },
      })
    }
    return { owner, slug, keys }
  }

  const otherOrgUpload = async () => {
    const slug = `eo-${randomUUID()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    await service.prisma.contactUpload.create({
      data: {
        organizationSlug: slug,
        name: 'Other',
        fileName: 'other.csv',
        fileKey: `${slug}/${randomUUID()}.csv`,
        firstNameColumn: 'First',
        lastNameColumn: 'Last',
        consentAffirmedAt: new Date(),
      },
    })
  }

  const deleteAllObjectVersions = () =>
    vi.spyOn(service.app.get(S3Service), 'deleteAllObjectVersions')

  beforeEach(async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.admin] },
    })
    const analytics = service.app.get(AnalyticsService)
    vi.spyOn(analytics, 'track').mockResolvedValue(
      {} as Awaited<ReturnType<typeof analytics.track>>,
    )
  })

  it.each([
    ['DELETE /v1/users/:id', (id: number) => `/v1/users/${id}`],
    ['DELETE /v1/admin/users/:id', (id: number) => `/v1/admin/users/${id}`],
  ])('%s deletes every version of each upload file', async (_route, url) => {
    const { owner, keys } = await seedOwnerWithUploads()
    await otherOrgUpload()
    const purge = deleteAllObjectVersions().mockResolvedValue(3)

    const res = await service.client.delete(url(owner.id))

    expect(res.status).toBe(HttpStatus.NO_CONTENT)
    expect(purge).toHaveBeenCalledTimes(1)
    expect(purge).toHaveBeenCalledWith(
      process.env.CONTACT_UPLOADS_BUCKET,
      expect.arrayContaining(keys),
    )
    expect(purge.mock.calls[0]?.[1]).toHaveLength(keys.length)
    expect(
      await service.prisma.user.findUnique({ where: { id: owner.id } }),
    ).toBeNull()
  })

  it('keeps the account and its login when the purge fails, for a retry', async () => {
    const { owner, slug } = await seedOwnerWithUploads()
    await service.prisma.user.update({
      where: { id: owner.id },
      data: { clerkId: `clerk_${randomUUID()}` },
    })
    const clerkDelete = vi.spyOn(
      service.app.get<ClerkClient>(CLERK_CLIENT_PROVIDER_TOKEN).users,
      'deleteUser',
    )
    deleteAllObjectVersions().mockRejectedValue(
      new BadGatewayException('Error communicating with AWS service'),
    )

    const res = await service.client.delete(`/v1/users/${owner.id}`)

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
    expect(clerkDelete).not.toHaveBeenCalled()
    expect(
      await service.prisma.user.findUnique({ where: { id: owner.id } }),
    ).not.toBeNull()
    expect(
      await service.prisma.contactUpload.count({
        where: { organizationSlug: slug },
      }),
    ).toBe(2)
  })

  it('calls S3 not at all when the user owns no uploads', async () => {
    const owner = await service.prisma.user.create({
      data: { email: `no-uploads-${randomUUID()}@goodparty.org` },
    })
    const purge = deleteAllObjectVersions()

    const res = await service.client.delete(`/v1/users/${owner.id}`)

    expect(res.status).toBe(HttpStatus.NO_CONTENT)
    expect(purge).not.toHaveBeenCalled()
  })
})
