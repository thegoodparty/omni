import { HttpService } from '@nestjs/axios'
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios'
import { of, throwError } from 'rxjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { ScaleToWinCampaignService } from './scaleToWinCampaign.service'
import {
  ScaleToWinApiError,
  ScaleToWinHttpService,
} from './scaleToWinHttp.service'

const CAMPAIGN_ID = '0b9a3c1e-6d3f-4c8e-9a51-2f7e1d4b8c60'
const TEMPLATE_ID = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f'
const BASE = `/subaccounts/mock-subaccount/campaigns`

// Carries fields we don't read, as the live API does, to prove they're
// stripped rather than rejected.
const recordedCampaign = {
  id: CAMPAIGN_ID,
  name: '{Serve-Civic Panel} Panel wave #123 - Jane Doe',
  status: 'DRAFT',
  startedAt: null,
  textingHoursTimezone: 'America/Chicago',
  textingHoursStart: '08:00:00',
  textingHoursEnd: '21:00:00',
  contactCount: 0,
  initialSendProgress: null,
  sendingPhoneNumber: '+16122388359',
  scriptVariants: [{ id: 'v1', script: 'Hi {{first_name}}' }],
  adminUrl: 'https://app.scaletowin.com/campaigns/x',
  createdAt: '2026-11-24T16:00:00.000Z',
}

const ok = <T>(data: T): AxiosResponse<T> =>
  ({
    data,
    status: 200,
    statusText: 'ok',
    headers: {},
    config: {} as AxiosResponse['config'],
  }) as AxiosResponse<T>

const axiosError = (status: number, data: object): AxiosError => {
  const config = { url: '/x', headers: new AxiosHeaders() }
  return new AxiosError('failed', 'ERR', config as AxiosError['config'], {}, {
    data,
    status,
    statusText: 'err',
    headers: {},
    config: config as AxiosResponse['config'],
  } as AxiosResponse)
}

describe('ScaleToWinCampaignService', () => {
  let service: ScaleToWinCampaignService
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn() }
    service = new ScaleToWinCampaignService(
      new ScaleToWinHttpService(
        createMockLogger(),
        http as unknown as HttpService,
      ),
    )
  })

  it('copies a template with the name, script and sending number', async () => {
    http.post.mockReturnValue(of(ok(recordedCampaign)))

    const campaign = await service.copy(TEMPLATE_ID, {
      name: '{Serve-Civic Panel} Panel wave #123 - Jane Doe',
      script: 'Hi {{first_name}}',
      sendingPhoneNumber: '+16122388359',
    })

    const [path, body] = http.post.mock.calls[0] ?? []
    expect(path).toBe(`${BASE}/${TEMPLATE_ID}/copy`)
    expect(body).toEqual({
      name: '{Serve-Civic Panel} Panel wave #123 - Jane Doe',
      contactFields: [],
      scriptVariants: [{ script: 'Hi {{first_name}}' }],
      sendingPhoneNumber: '+16122388359',
    })
    expect(campaign).toEqual({
      id: CAMPAIGN_ID,
      name: '{Serve-Civic Panel} Panel wave #123 - Jane Doe',
      status: 'DRAFT',
      startedAt: null,
      textingHoursTimezone: 'America/Chicago',
      textingHoursStart: '08:00:00',
      textingHoursEnd: '21:00:00',
      contactCount: 0,
      sendingPhoneNumber: '+16122388359',
      scriptVariants: [{ script: 'Hi {{first_name}}' }],
      adminUrl: 'https://app.scaletowin.com/campaigns/x',
    })
  })

  it('rejects a sending number that is not +1 E.164 before calling', async () => {
    await expect(
      service.copy(TEMPLATE_ID, {
        name: 'Panel wave',
        script: 'Hi',
        sendingPhoneNumber: '6122388359',
      }),
    ).rejects.toBeInstanceOf(z.ZodError)
    expect(http.post).not.toHaveBeenCalled()
  })

  it('surfaces a copy 4xx with its Scale to Win code', async () => {
    http.post.mockReturnValue(
      throwError(() =>
        axiosError(404, {
          message: 'No campaign with that ID found in that subaccount',
          code: 'NOT_FOUND',
        }),
      ),
    )

    await expect(
      service.copy(TEMPLATE_ID, {
        name: 'Panel wave',
        script: 'Hi',
        sendingPhoneNumber: '+16122388359',
      }),
    ).rejects.toMatchObject({
      constructor: ScaleToWinApiError,
      vendorStatus: 404,
      code: 'NOT_FOUND',
    })
  })

  it('gets a campaign whose texting hours are not overridden', async () => {
    http.get.mockReturnValue(
      of(
        ok({
          ...recordedCampaign,
          textingHoursTimezone: null,
          textingHoursStart: null,
          textingHoursEnd: null,
        }),
      ),
    )

    const campaign = await service.get(CAMPAIGN_ID)

    expect(http.get.mock.calls[0]?.[0]).toBe(`${BASE}/${CAMPAIGN_ID}`)
    expect(campaign.textingHoursTimezone).toBeNull()
  })

  it('fails the parse when a field we read changes shape', async () => {
    http.get.mockReturnValue(
      of(ok({ ...recordedCampaign, status: 'SOMETHING_NEW' })),
    )

    await expect(service.get(CAMPAIGN_ID)).rejects.toBeInstanceOf(z.ZodError)
  })

  it('previews messages to a phone with sample contact data', async () => {
    http.post.mockReturnValue(
      of(
        ok({
          messages: [{ status: 'SENT', providerErrorCode: null }],
          errors: [],
        }),
      ),
    )

    const preview = await service.previewMessages(CAMPAIGN_ID, {
      phoneNumber: '+15555550100',
      sampleContactData: { first_name: 'Preview' },
    })

    const [path, body] = http.post.mock.calls[0] ?? []
    expect(path).toBe(`${BASE}/${CAMPAIGN_ID}/preview-messages`)
    expect(body).toEqual({
      phoneNumber: '+15555550100',
      sampleContactData: { first_name: 'Preview' },
    })
    expect(preview).toEqual({
      messages: [{ status: 'SENT', providerErrorCode: null }],
      errors: [],
    })
  })

  it('starts a campaign with an empty body', async () => {
    http.post.mockReturnValue(of(ok({ status: 'RUNNING' })))

    await service.start(CAMPAIGN_ID)

    const [path, body] = http.post.mock.calls[0] ?? []
    expect(path).toBe(`${BASE}/${CAMPAIGN_ID}/start`)
    expect(body).toEqual({})
  })

  it('reads the start job', async () => {
    http.get.mockReturnValue(of(ok({ status: 'FAILED', error: 'No contacts' })))

    const job = await service.getStartJob(CAMPAIGN_ID)

    expect(http.get.mock.calls[0]?.[0]).toBe(`${BASE}/${CAMPAIGN_ID}/start`)
    expect(job).toEqual({ status: 'FAILED', error: 'No contacts' })
  })

  it('sends the full campaign with an empty body and parses the campaign', async () => {
    http.post.mockReturnValue(
      of(ok({ ...recordedCampaign, status: 'INITIAL_SEND_RUNNING' })),
    )

    const campaign = await service.sendFull(CAMPAIGN_ID)

    const [path, body] = http.post.mock.calls[0] ?? []
    expect(path).toBe(`${BASE}/${CAMPAIGN_ID}/send-full`)
    expect(body).toEqual({})
    expect(campaign.status).toBe('INITIAL_SEND_RUNNING')
  })
})
