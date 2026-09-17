import { BadGatewayException } from '@nestjs/common'
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CallhubCampaignReportService } from './callhubCampaignReport.service'
import { CallhubErrorHandlingService } from './callhubErrorHandling.service'
import { CallhubHttpService } from './callhubHttp.service'

const axiosError = (status: number): AxiosError => {
  const config = { url: '/x', headers: new AxiosHeaders() }
  const response = {
    data: { detail: 'boom' },
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

describe('CallhubCampaignReportService', () => {
  let service: CallhubCampaignReportService
  let http: { get: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    http = { get: vi.fn() }
    service = new CallhubCampaignReportService(
      createMockLogger(),
      http as unknown as CallhubHttpService,
      new CallhubErrorHandlingService(),
    )
  })

  it('reads a completed campaign status and maps the lifecycle label', async () => {
    http.get.mockResolvedValue({
      url: 'https://api-na1.callhub.io/v1/voice_broadcasts/23204/',
      owner: 'goodparty',
      name: 'Rent Due Reminder',
      frequency: 60,
      status: 4,
      phonebook: ['https://api-na1.callhub.io/v1/phonebooks/1332/'],
    })

    const result = await service.getCampaignStatus('23204')

    expect(http.get).toHaveBeenCalledWith('/v1/voice_broadcasts/23204/')
    expect(result.status).toBe(4)
    expect(result.statusLabel).toBe('END')
  })

  it('falls back to UNKNOWN for an unmapped status code', async () => {
    http.get.mockResolvedValue({
      url: 'https://api-na1.callhub.io/v1/voice_broadcasts/1/',
      name: 'Draft',
      status: 9,
    })

    const result = await service.getCampaignStatus('1')

    expect(result.statusLabel).toBe('UNKNOWN')
  })

  it('maps a campaign-status HTTP failure to a 502', async () => {
    http.get.mockRejectedValue(axiosError(500))

    await expect(service.getCampaignStatus('23204')).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })

  it('lets a campaign-status schema mismatch propagate (not a 502)', async () => {
    http.get.mockResolvedValue({ unexpected: 'shape' })

    const call = service.getCampaignStatus('23204')
    await expect(call).rejects.not.toBeInstanceOf(BadGatewayException)
    await expect(call).rejects.toThrow()
  })

  it('reads a ready report export with its CDR download url', async () => {
    http.get.mockResolvedValue({
      state: 'SUCCESS',
      data: {
        url: 'https://api-na1.callhub.io/v1/exports/api/abc==/results.csv',
        code: 200,
      },
    })

    const result = await service.getCampaignReport('4271')

    expect(http.get).toHaveBeenCalledWith('/v1/export_data/export_4271/')
    expect(result.state).toBe('SUCCESS')
    expect(result.data?.url).toContain('results.csv')
    expect(result.data?.code).toBe(200)
  })

  it('reads a not-yet-ready report export (no data payload)', async () => {
    http.get.mockResolvedValue({ state: 'PENDING' })

    const result = await service.getCampaignReport('4271')

    expect(result.state).toBe('PENDING')
    expect(result.data).toBeUndefined()
  })

  it('maps a report-export HTTP failure to a 502', async () => {
    http.get.mockRejectedValue(axiosError(500))

    await expect(service.getCampaignReport('4271')).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })
})
