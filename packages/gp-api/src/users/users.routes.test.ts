import { useTestService } from '@/test-service'
import { BadGatewayException, HttpStatus } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
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
