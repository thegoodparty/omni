import { BadGatewayException } from '@nestjs/common'
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CALLHUB_CONTACT_FIELD } from '../schemas/callhubBulkImport.schema'
import { CallhubBulkImportService } from './callhubBulkImport.service'
import { CallhubErrorHandlingService } from './callhubErrorHandling.service'
import { CallhubHttpService } from './callhubHttp.service'

const axiosError = (status: number): AxiosError => {
  const config = { url: '/x', headers: new AxiosHeaders() }
  const response = {
    data: { detail: 'throttled' },
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

describe('CallhubBulkImportService', () => {
  let service: CallhubBulkImportService
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn() }
    service = new CallhubBulkImportService(
      createMockLogger(),
      http as unknown as CallhubHttpService,
      new CallhubErrorHandlingService(),
    )
  })

  const params = {
    phonebookPkStr: '3966566468442653936',
    csvUrl: 'https://s3.example/audience.csv',
    mapping: { [CALLHUB_CONTACT_FIELD.CONTACT]: 0 },
    countryIso: 'US',
  }

  it('imports contacts using the string phonebook id and hosted CSV', async () => {
    http.post.mockResolvedValue({ message: 'Import queued' })

    const result = await service.importContacts(params)

    expect(http.post).toHaveBeenCalledWith('/v1/contacts/bulk_create/', {
      phonebook_id: '3966566468442653936',
      csv_url: 'https://s3.example/audience.csv',
      mapping: '{"0":"0"}',
      country_choice: 'custom',
      country_iso: 'US',
    })
    expect(result.message).toBe('Import queued')
  })

  it('maps a CallHub failure to a 502', async () => {
    http.post.mockRejectedValue(axiosError(429))

    await expect(service.importContacts(params)).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })
})
