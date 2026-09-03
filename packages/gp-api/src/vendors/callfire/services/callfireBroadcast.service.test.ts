import { BadGatewayException, BadRequestException } from '@nestjs/common'
import { addDays } from 'date-fns'
import {
  AxiosError,
  AxiosHeaders,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CallfireBroadcastService } from './callfireBroadcast.service'
import { CallfireErrorHandlingService } from './callfireErrorHandling.service'
import { CallfireHttpService } from './callfireHttp.service'

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

const scheduledStart = addDays(new Date(), 21)
const params = {
  name: 'Robocall town-hall',
  fromNumber: '+18336320222',
  liveSoundId: 55501,
  machineSoundId: 55502,
  contactListId: '987654',
  scheduledStart,
}

describe('CallfireBroadcastService', () => {
  let service: CallfireBroadcastService
  let http: {
    get: ReturnType<typeof vi.fn>
    post: ReturnType<typeof vi.fn>
    put: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn(), put: vi.fn() }
    service = new CallfireBroadcastService(
      createMockLogger(),
      http as unknown as CallfireHttpService,
      new CallfireErrorHandlingService(),
    )
  })

  describe('createBroadcast', () => {
    it('creates a NON-DIALING broadcast (start=false) and attaches the list', async () => {
      // First POST = create -> ResourceId; second POST = batches attach.
      http.post
        .mockResolvedValueOnce({ id: 44001 })
        .mockResolvedValueOnce({ id: 90001 })

      const result = await service.createBroadcast(params)

      const [createPath, createBody, createConfig] =
        http.post.mock.calls[0] ?? []
      expect(createPath).toBe('/calls/broadcasts')
      // start=false is the load-bearing NON-DIALING flag.
      expect(createConfig?.params).toEqual({ start: false })
      // Caller ID is stripped to digits; audio is the uploaded sound ids.
      expect(createBody.fromNumber).toBe('18336320222')
      expect(createBody.sounds).toEqual({
        liveSoundId: 55501,
        machineSoundId: 55502,
      })
      // Compliance window: enabled 9am-9pm local, all 7 days, Central fallback.
      expect(createBody.localTimeRestriction.enabled).toBe(true)
      expect(createBody.localTimeRestriction.beginHour).toBe(9)
      expect(createBody.localTimeRestriction.endHour).toBe(21)
      expect(createBody.schedules[0].timeZone).toBe('America/Chicago')
      expect(createBody.schedules[0].daysOfWeek).toHaveLength(7)
      // No inline recipients — the audience is the attached contact list.
      expect(createBody.recipients).toBeUndefined()

      // Second call attaches the validated contact list as a batch.
      const [batchPath, batchBody] = http.post.mock.calls[1] ?? []
      expect(batchPath).toBe('/calls/broadcasts/44001/batches')
      expect(batchBody).toEqual({
        name: 'Robocall town-hall',
        contactListId: 987654,
      })

      expect(result.campaignRef).toBe('44001')
      expect(result.startingDate).toEqual(scheduledStart)
      expect(result.expirationDate).toEqual(addDays(scheduledStart, 7))
      // The dial trigger is never sent from create.
      const startCalls = http.post.mock.calls.filter(([p]) =>
        String(p).endsWith('/start'),
      )
      expect(startCalls).toHaveLength(0)
    })

    it('skips the batch attach when no contact list is given', async () => {
      http.post.mockResolvedValueOnce({ id: 44002 })

      const result = await service.createBroadcast({
        ...params,
        contactListId: undefined,
      })

      expect(http.post).toHaveBeenCalledTimes(1)
      expect(result.campaignRef).toBe('44002')
    })

    it('refuses to schedule a broadcast in the past (never dials now)', async () => {
      await expect(
        service.createBroadcast({
          ...params,
          scheduledStart: addDays(new Date(), -1),
        }),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(http.post).not.toHaveBeenCalled()
    })

    it('maps a CallFire create failure to a 502', async () => {
      http.post.mockRejectedValue(
        createAxiosError({ message: 'invalid from number' }, 500),
      )

      await expect(service.createBroadcast(params)).rejects.toBeInstanceOf(
        BadGatewayException,
      )
    })

    it('surfaces a malformed create response as a schema error, not a 502', async () => {
      http.post.mockResolvedValueOnce({ notAnId: true })

      await expect(service.createBroadcast(params)).rejects.not.toBeInstanceOf(
        BadGatewayException,
      )
    })
  })

  describe('abortBroadcast', () => {
    it('stops the broadcast at the /stop path (opposite of the dialer)', async () => {
      http.post.mockResolvedValue({})

      await service.abortBroadcast('44001')

      const [path] = http.post.mock.calls[0] ?? []
      expect(path).toBe('/calls/broadcasts/44001/stop')
    })

    it('maps a CallFire abort failure to a 502', async () => {
      http.post.mockRejectedValue(createAxiosError({ message: 'boom' }, 500))

      await expect(service.abortBroadcast('44001')).rejects.toBeInstanceOf(
        BadGatewayException,
      )
    })
  })

  describe('getBroadcastStatus', () => {
    it.each([
      ['RUNNING', 'dialing'],
      ['FINISHED', 'completed'],
      ['PAUSED', 'paused'],
      ['SCHEDULED', 'pending'],
      ['STOPPED', 'aborted'],
    ])('maps CallFire %s to the neutral %s status', async (native, neutral) => {
      http.get.mockResolvedValue({ id: 44001, status: native })

      const status = await service.getBroadcastStatus('44001')

      const [path] = http.get.mock.calls[0] ?? []
      expect(path).toBe('/calls/broadcasts/44001')
      expect(status).toBe(neutral)
    })

    it('maps an unrecognized status to unknown (not yet resolved)', async () => {
      http.get.mockResolvedValue({ id: 44001, status: 'SOME_NEW_STATE' })

      expect(await service.getBroadcastStatus('44001')).toBe('unknown')
    })

    it('maps a missing status to unknown', async () => {
      http.get.mockResolvedValue({ id: 44001 })

      expect(await service.getBroadcastStatus('44001')).toBe('unknown')
    })

    it('maps a CallFire status-read failure to a 502', async () => {
      http.get.mockRejectedValue(createAxiosError({ message: 'boom' }, 500))

      await expect(service.getBroadcastStatus('44001')).rejects.toBeInstanceOf(
        BadGatewayException,
      )
    })
  })
})
