import { BadGatewayException, BadRequestException } from '@nestjs/common'
import { addDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import {
  AxiosError,
  AxiosHeaders,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CallhubCampaignService } from './callhubCampaign.service'
import { CallhubErrorHandlingService } from './callhubErrorHandling.service'
import { CallhubHttpService } from './callhubHttp.service'

const createAxiosError = (
  data: Record<string, unknown> | undefined,
  status = 500,
): AxiosError => {
  const config: AxiosRequestConfig = { url: '/x', headers: new AxiosHeaders() }
  const response: AxiosResponse = {
    data,
    status,
    statusText: 'err',
    headers: {},
    config: config as AxiosResponse['config'],
  }
  return new AxiosError(
    'Request failed',
    'ERR_BAD_RESPONSE',
    config as AxiosError['config'],
    {},
    response,
  )
}

// 21 days out — past the 14-day live-verification safeguard the human required.
const scheduledStart = addDays(new Date(), 21)
const params = {
  name: 'Robocall town-hall',
  phonebookPkStr: '3972680349405677061',
  callerId: '+18336320222',
  mediaFileId: '3972681326913389747',
  scheduledStart,
}

describe('CallhubCampaignService', () => {
  let service: CallhubCampaignService
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn() }
    service = new CallhubCampaignService(
      createMockLogger(),
      http as unknown as CallhubHttpService,
      new CallhubErrorHandlingService(),
    )
  })

  describe('createVoiceBroadcast', () => {
    it('creates a scheduled, non-launched voice broadcast', async () => {
      http.post.mockResolvedValue({
        pk_str: '3972682680557897335',
        name: 'Robocall town-hall',
        // Extra fields CallHub returns are stripped by the schema.
        id: 3972682680557897000,
        schedule: { startingdate: '2026-09-16 08:18:21' },
      })

      const result = await service.createVoiceBroadcast(params)

      const [path, body] = http.post.mock.calls[0] ?? []
      // Trailing slash is load-bearing — the slashless path lists instead of
      // creating.
      expect(path).toBe('/v1/vb_campaign/')
      // Phonebook + media travel as strings (safe-integer caveat), the caller
      // ID is stripped to digits, and the audio is the uploaded file id.
      expect(body.phonebooks).toEqual(['3972680349405677061'])
      expect(body.callerid_options).toEqual({ callerid: '18336320222' })
      expect(body.script.live_message).toEqual({
        audiofile: '3972681326913389747',
      })
      expect(body.script.label).toBe('Robocall town-hall')
      // Schedule + contact options are nested objects (flat fields are ignored
      // by CallHub) and the start carries the 21-day-out time verbatim.
      expect(body.schedule.startingdate).toBe(
        formatInTimeZone(scheduledStart, 'UTC', 'yyyy-MM-dd HH:mm:ss'),
      )
      expect(body.schedule.expirationdate).toBe(
        formatInTimeZone(
          addDays(scheduledStart, 7),
          'UTC',
          'yyyy-MM-dd HH:mm:ss',
        ),
      )
      expect(body.schedule.monday).toBe(true)
      expect(body.contact_options).toEqual({
        use_contact_tz: true,
        dont_call_dnc: true,
        dont_call_litigator: true,
        block_cellphone_numbers: true,
      })
      // The launch status is never sent from this service.
      expect(body).not.toHaveProperty('status')
      expect(result.pk_str).toBe('3972682680557897335')
    })

    it('refuses to schedule a broadcast in the past (never dials now)', async () => {
      await expect(
        service.createVoiceBroadcast({
          ...params,
          scheduledStart: addDays(new Date(), -1),
        }),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(http.post).not.toHaveBeenCalled()
    })

    it('maps a CallHub failure to a 502', async () => {
      http.post.mockRejectedValue(
        createAxiosError({ detail: 'invalid caller id' }, 400),
      )

      await expect(service.createVoiceBroadcast(params)).rejects.toBeInstanceOf(
        BadGatewayException,
      )
    })
  })
})
