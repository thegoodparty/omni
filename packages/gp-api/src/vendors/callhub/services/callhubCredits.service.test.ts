import { BadGatewayException } from '@nestjs/common'
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CALLHUB_CAMPAIGN_TYPE_VOICE } from '../schemas/callhubCredits.schema'
import { CallhubCreditsService } from './callhubCredits.service'
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

describe('CallhubCreditsService', () => {
  let service: CallhubCreditsService
  let http: { post: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    http = { post: vi.fn() }
    service = new CallhubCreditsService(
      createMockLogger(),
      http as unknown as CallhubHttpService,
      new CallhubErrorHandlingService(),
    )
  })

  // Drives the real VoiceCreditsUsageSchema.parse for the documented shape. The
  // live response shape (e.g. a possible DRF results[] wrapper) is the
  // release-gate live-test item, deliberately NOT guessed here.
  it('reads voice usage for a campaign and extracts the billable figures', async () => {
    http.post.mockResolvedValue({ voice_calls: 100, voice_billsec: 4200 })

    const result = await service.getVoiceCampaignUsage('23204')

    // pk_str crosses the wire as a STRING under campaign_id, never coerced.
    expect(http.post).toHaveBeenCalledWith('/v2/credits_usage/', {
      campaign_type: CALLHUB_CAMPAIGN_TYPE_VOICE,
      campaign_id: '23204',
    })
    const body = http.post.mock.calls[0]?.[1]
    expect(typeof body.campaign_id).toBe('string')
    expect(result.voice_calls).toBe(100)
    expect(result.voice_billsec).toBe(4200)
  })

  it('parses a not-yet-reported payload with voice_calls absent', async () => {
    http.post.mockResolvedValue({ voice_billsec: 0 })

    const result = await service.getVoiceCampaignUsage('23204')

    // Absent voice_calls parses as nullish — the caller reads that as "not
    // reported yet", never as a real 0.
    expect(result.voice_calls == null).toBe(true)
  })

  it('maps a credits-usage HTTP failure to a 502', async () => {
    http.post.mockRejectedValue(axiosError(500))

    await expect(service.getVoiceCampaignUsage('23204')).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })

  it('lets a credits-usage schema mismatch propagate (not a 502)', async () => {
    http.post.mockResolvedValue({ voice_calls: 'not-a-number' })

    const call = service.getVoiceCampaignUsage('23204')
    await expect(call).rejects.not.toBeInstanceOf(BadGatewayException)
    await expect(call).rejects.toThrow()
  })
})
