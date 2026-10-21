import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { CrmUsersService } from '@/users/services/crmUsers.service'
import { DEFAULT_SUBSCRIBE_FORM_ID } from './subscribeEmail.schema'

const service = useTestService()

// `trustProxy` is on, so an X-Forwarded-For header is what the rate-limit
// guard keys on. Each test uses its own address so one test's spend cannot
// exhaust another's budget.
const from = (ip: string) => ({ headers: { 'X-Forwarded-For': ip } })

const body = {
  email: 'subscriber@example.com',
  uri: 'https://goodparty.org/run-for-office',
}

describe('POST /v1/subscribe', () => {
  let submitCrmForm: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    submitCrmForm = vi
      .spyOn(service.app.get(CrmUsersService), 'submitCrmForm')
      .mockResolvedValue(undefined)
  })

  it('submits the default form when the caller names none', async () => {
    const result = await service.client.post(
      '/v1/subscribe',
      body,
      from('10.0.0.1'),
    )

    expect(result.status).toBe(HttpStatus.CREATED)
    expect(submitCrmForm).toHaveBeenCalledWith(
      DEFAULT_SUBSCRIBE_FORM_ID,
      expect.arrayContaining([
        { name: 'email', value: body.email, objectTypeId: '0-1' },
      ]),
      'homePage',
      body.uri,
    )
  })

  it('accepts an allow-listed formId', async () => {
    const result = await service.client.post(
      '/v1/subscribe',
      { ...body, formId: DEFAULT_SUBSCRIBE_FORM_ID },
      from('10.0.0.2'),
    )

    expect(result.status).toBe(HttpStatus.CREATED)
    expect(submitCrmForm).toHaveBeenCalledOnce()
  })

  it('rejects a formId outside the allow-list without calling HubSpot', async () => {
    const result = await service.client.post(
      '/v1/subscribe',
      { ...body, formId: '00000000-0000-0000-0000-000000000000' },
      from('10.0.0.3'),
    )

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
    expect(submitCrmForm).not.toHaveBeenCalled()
  })

  it('rejects additionalFields sent as a JSON string', async () => {
    const result = await service.client.post(
      '/v1/subscribe',
      {
        ...body,
        additionalFields: JSON.stringify([
          { name: 'candidate_interest', value: 'yes' },
        ]),
      },
      from('10.0.0.4'),
    )

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
    expect(submitCrmForm).not.toHaveBeenCalled()
  })

  it('rejects an additionalFields property outside the allow-list', async () => {
    const result = await service.client.post(
      '/v1/subscribe',
      {
        ...body,
        additionalFields: [{ name: 'hs_lead_status', value: 'NEW' }],
      },
      from('10.0.0.5'),
    )

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
    expect(submitCrmForm).not.toHaveBeenCalled()
  })

  it('rejects an oversized additionalFields value', async () => {
    const result = await service.client.post(
      '/v1/subscribe',
      {
        ...body,
        additionalFields: [
          { name: 'candidate_interest', value: 'y'.repeat(501) },
        ],
      },
      from('10.0.0.6'),
    )

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
    expect(submitCrmForm).not.toHaveBeenCalled()
  })

  it('rejects more additionalFields entries than the cap', async () => {
    const result = await service.client.post(
      '/v1/subscribe',
      {
        ...body,
        additionalFields: Array.from({ length: 21 }, () => ({
          name: 'candidate_interest',
          value: 'yes',
        })),
      },
      from('10.0.0.7'),
    )

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
    expect(submitCrmForm).not.toHaveBeenCalled()
  })

  it('carries an allow-listed additionalField through to HubSpot', async () => {
    const result = await service.client.post(
      '/v1/subscribe',
      {
        ...body,
        additionalFields: [{ name: 'candidate_interest', value: 'yes' }],
      },
      from('10.0.0.8'),
    )

    expect(result.status).toBe(HttpStatus.CREATED)
    expect(submitCrmForm).toHaveBeenCalledWith(
      DEFAULT_SUBSCRIBE_FORM_ID,
      expect.arrayContaining([
        { name: 'candidate_interest', value: 'yes', objectTypeId: '0-1' },
      ]),
      'homePage',
      body.uri,
    )
  })

  it('refuses the sixth submission from one address and submits nothing', async () => {
    for (let i = 0; i < 5; i++) {
      const allowed = await service.client.post(
        '/v1/subscribe',
        body,
        from('10.0.0.9'),
      )
      expect(allowed.status).toBe(HttpStatus.CREATED)
    }
    expect(submitCrmForm).toHaveBeenCalledTimes(5)

    const refused = await service.client.post(
      '/v1/subscribe',
      body,
      from('10.0.0.9'),
    )

    expect(refused.status).toBe(HttpStatus.TOO_MANY_REQUESTS)
    expect(submitCrmForm).toHaveBeenCalledTimes(5)
  })
})
