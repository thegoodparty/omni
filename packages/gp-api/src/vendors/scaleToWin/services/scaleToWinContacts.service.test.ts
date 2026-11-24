import { HttpService } from '@nestjs/axios'
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios'
import { of, throwError } from 'rxjs'
import { Readable } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { ScaleToWinContactsService } from './scaleToWinContacts.service'
import {
  ScaleToWinApiError,
  ScaleToWinHttpService,
} from './scaleToWinHttp.service'

const CAMPAIGN_ID = '0b9a3c1e-6d3f-4c8e-9a51-2f7e1d4b8c60'
const CONTACTS = `/subaccounts/mock-subaccount/campaigns/${CAMPAIGN_ID}/contacts`

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

describe('ScaleToWinContactsService', () => {
  let service: ScaleToWinContactsService
  let http: {
    get: ReturnType<typeof vi.fn>
    post: ReturnType<typeof vi.fn>
    put: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn(), put: vi.fn() }
    service = new ScaleToWinContactsService(
      new ScaleToWinHttpService(
        createMockLogger(),
        http as unknown as HttpService,
      ),
    )
  })

  it('asks for a presigned PUT at the top level, with the subaccount in the body', async () => {
    http.post.mockReturnValue(
      of(
        ok({
          signedPutUrl: 'https://uploads.example/abc',
          token: 'upload-token',
        }),
      ),
    )

    const upload = await service.presignedPut('123-1.csv')

    const [path, body] = http.post.mock.calls[0] ?? []
    expect(path).toBe('/uploads/presigned-put')
    expect(body).toEqual({
      subaccountId: 'mock-subaccount',
      type: 'CONTACT_CSV',
      contentType: 'text/csv',
      fileName: '123-1.csv',
    })
    expect(upload).toEqual({
      signedPutUrl: 'https://uploads.example/abc',
      token: 'upload-token',
    })
  })

  it('streams the CSV to the presigned URL', async () => {
    http.put.mockReturnValue(of(ok('')))
    const stream = Readable.from(['firstName,lastName,cellPhone\n'])

    await service.putCsv({
      signedPutUrl: 'https://uploads.example/abc',
      body: stream,
      contentLength: 29,
    })

    const [url, body] = http.put.mock.calls[0] ?? []
    expect(url).toBe('https://uploads.example/abc')
    expect(body).toBe(stream)
  })

  it('starts the CSV load with the phone column and field mapping', async () => {
    http.post.mockReturnValue(of(ok({ status: 'RUNNING' })))

    const result = await service.csvUpload(CAMPAIGN_ID, {
      uploadToken: 'upload-token',
      estimatedRowCount: 10000,
    })

    const [path, body] = http.post.mock.calls[0] ?? []
    expect(path).toBe(`${CONTACTS}/csv-upload`)
    expect(body).toEqual({
      uploadToken: 'upload-token',
      estimatedRowCount: 10000,
      phoneNumberColumn: 'cellPhone',
      contactFieldMapping: { first_name: 'firstName', last_name: 'lastName' },
    })
    expect(result).toEqual({ status: 'RUNNING' })
  })

  it('surfaces a 409 while a load is already running', async () => {
    http.post.mockReturnValue(
      throwError(() =>
        axiosError(409, { message: 'A job is running', code: 'CONFLICT' }),
      ),
    )

    await expect(
      service.csvUpload(CAMPAIGN_ID, {
        uploadToken: 'upload-token',
        estimatedRowCount: 10,
      }),
    ).rejects.toMatchObject({
      constructor: ScaleToWinApiError,
      vendorStatus: 409,
      code: 'CONFLICT',
    })
  })

  it('reads a finished load job with its counts', async () => {
    const recorded = {
      status: 'DONE',
      error: null,
      result: {
        nContacts: 9800,
        nInvalid: 50,
        nDuplicates: 20,
        nOptOuts: 30,
        nNotSubscribed: 0,
        nLandlines: 100,
        nFilteredOut: 0,
        importedFieldNames: ['first_name', 'last_name'],
      },
    }
    http.get.mockReturnValue(of(ok(recorded)))

    const job = await service.getLoadJob(CAMPAIGN_ID)

    expect(http.get.mock.calls[0]?.[0]).toBe(CONTACTS)
    expect(job).toEqual(recorded)
  })

  it('reads a load job that has not run yet', async () => {
    http.get.mockReturnValue(of(ok({ status: 'NOT_RUNNING' })))

    await expect(service.getLoadJob(CAMPAIGN_ID)).resolves.toEqual({
      status: 'NOT_RUNNING',
    })
  })
})
