import { BadGatewayException } from '@nestjs/common'
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CallfireErrorHandlingService } from './callfireErrorHandling.service'
import { CallfireHttpService } from './callfireHttp.service'
import { CallfireResultsService } from './callfireResults.service'

const axiosError = (status: number): AxiosError => {
  const config = { url: '/x', headers: new AxiosHeaders() }
  const response = {
    data: { message: 'boom' },
    status,
    statusText: 'err',
    headers: {},
    config: config as AxiosResponse['config'],
  } as AxiosResponse
  return new AxiosError(
    'failed',
    'ERR',
    config as AxiosError['config'],
    {},
    response,
  )
}

describe('CallfireResultsService', () => {
  let service: CallfireResultsService
  let http: { get: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    http = { get: vi.fn() }
    service = new CallfireResultsService(
      createMockLogger(),
      http as unknown as CallfireHttpService,
      new CallfireErrorHandlingService(),
    )
  })

  it('reads broadcast stats from the stats endpoint', async () => {
    http.get.mockResolvedValue({
      totalOutboundCount: 100,
      callsLiveAnswer: 42,
      answeringMachineCount: 30,
      busyCount: 5,
      noAnswerCount: 15,
      errorCount: 8,
      billedAmount: 12.34,
      callsDuration: 3600,
    })

    const stats = await service.getBroadcastStats('7788')

    expect(http.get).toHaveBeenCalledWith('/calls/broadcasts/7788/stats')
    expect(stats.callsLiveAnswer).toBe(42)
    expect(stats.answeringMachineCount).toBe(30)
    expect(stats.billedAmount).toBe(12.34)
    expect(stats.callsDuration).toBe(3600)
  })

  it('derives connectedCount from callsLiveAnswer (live answers only)', async () => {
    http.get.mockResolvedValue({
      callsLiveAnswer: 42,
      answeringMachineCount: 30,
      callsDuration: 3600,
    })

    const count = await service.getCompletedCount('7788')

    // The money path: a machine answer is NOT counted as connected.
    expect(count.connectedCount).toBe(42)
    expect(count.billableSeconds).toBe(3600)
  })

  it('treats a genuine zero live-answer count as connectedCount 0', async () => {
    http.get.mockResolvedValue({
      callsLiveAnswer: 0,
      answeringMachineCount: 12,
      callsDuration: 480,
    })

    const count = await service.getCompletedCount('7788')

    expect(count.connectedCount).toBe(0)
    expect(count.billableSeconds).toBe(480)
  })

  it('carries billableSeconds as null when callsDuration is absent', async () => {
    http.get.mockResolvedValue({ callsLiveAnswer: 7 })

    const count = await service.getCompletedCount('7788')

    expect(count.connectedCount).toBe(7)
    expect(count.billableSeconds).toBeNull()
  })

  it('throws (never silently 0) when callsLiveAnswer is absent', async () => {
    http.get.mockResolvedValue({
      answeringMachineCount: 30,
      callsDuration: 3600,
    })

    const call = service.getCompletedCount('7788')
    await expect(call).rejects.toThrow(/callsLiveAnswer/)
    // A missing money-critical count is a permanent bug, not a transient 502
    // the caller should retry into a wrong charge.
    await expect(call).rejects.not.toBeInstanceOf(BadGatewayException)
  })

  it('throws (never silently 0) when callsLiveAnswer is null', async () => {
    http.get.mockResolvedValue({ callsLiveAnswer: null, callsDuration: 3600 })

    await expect(service.getCompletedCount('7788')).rejects.toThrow(
      /callsLiveAnswer/,
    )
  })

  it('lets a stats schema mismatch propagate as a ZodError (not a 502)', async () => {
    http.get.mockResolvedValue({ callsLiveAnswer: 'not-a-number' })

    const call = service.getBroadcastStats('7788')
    await expect(call).rejects.not.toBeInstanceOf(BadGatewayException)
    await expect(call).rejects.toThrow()
  })

  it('maps a stats HTTP failure to a 502', async () => {
    http.get.mockRejectedValue(axiosError(500))

    await expect(service.getBroadcastStats('7788')).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })

  it('pages through calls, returning finalCallResult per call', async () => {
    http.get
      .mockResolvedValueOnce({
        limit: 2,
        offset: 0,
        totalCount: 3,
        items: [
          { id: 1, toNumber: '18557492163', finalCallResult: 'LA' },
          { id: 2, toNumber: '15125550143', finalCallResult: 'AM' },
        ],
      })
      .mockResolvedValueOnce({
        limit: 2,
        offset: 2,
        totalCount: 3,
        items: [{ id: 3, toNumber: '15125550199', finalCallResult: 'NO_ANS' }],
      })

    const calls = await service.findCalls('7788')

    expect(calls.map((c) => c.finalCallResult)).toEqual(['LA', 'AM', 'NO_ANS'])
    expect(http.get).toHaveBeenNthCalledWith(
      1,
      '/calls?campaignId=7788&limit=1000&offset=0',
    )
  })

  it('maps a calls HTTP failure to a 502', async () => {
    http.get.mockRejectedValue(axiosError(500))

    await expect(service.findCalls('7788')).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })
})
