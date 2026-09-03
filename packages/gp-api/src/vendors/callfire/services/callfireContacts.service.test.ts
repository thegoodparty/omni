import { BadGatewayException } from '@nestjs/common'
import FormData from 'form-data'
import {
  AxiosError,
  AxiosHeaders,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CallfireContactsService } from './callfireContacts.service'
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

const uploadParams = {
  name: 'Robocall audience',
  file: Buffer.from('phone\n+18005550100\n'),
  fileName: 'audience.csv',
  mimeType: 'text/csv',
}

describe('CallfireContactsService', () => {
  let service: CallfireContactsService
  let http: {
    get: ReturnType<typeof vi.fn>
    post: ReturnType<typeof vi.fn>
    put: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn(), put: vi.fn() }
    service = new CallfireContactsService(
      createMockLogger(),
      http as unknown as CallfireHttpService,
      new CallfireErrorHandlingService(),
    )
  })

  describe('createListFromCsv', () => {
    it('uploads the CSV as multipart and returns the list id as a string', async () => {
      http.post.mockResolvedValue({ id: 987654 })

      const result = await service.createListFromCsv(uploadParams)

      const [path, body] = http.post.mock.calls[0] ?? []
      expect(path).toBe('/contacts/lists/upload')
      expect(body).toBeInstanceOf(FormData)
      // The int64 id is handed back as a string handle (never used for math).
      expect(result).toEqual({ listId: '987654' })
    })

    it('forwards useCustomFields as a string field when provided', async () => {
      http.post.mockResolvedValue({ id: 1 })

      await service.createListFromCsv({
        ...uploadParams,
        useCustomFields: true,
      })

      // FormData buffers the field; assert the literal was appended rather
      // than reaching into the stream.
      const [, body] = http.post.mock.calls[0] ?? []
      const rendered = (body as FormData).getBuffer().toString()
      expect(rendered).toContain('name="useCustomFields"')
      expect(rendered).toContain('true')
    })

    it('rejects an absurdly large file before calling CallFire', async () => {
      await expect(
        service.createListFromCsv({
          ...uploadParams,
          file: Buffer.alloc(26 * 1024 * 1024),
        }),
      ).rejects.toThrow()
      expect(http.post).not.toHaveBeenCalled()
    })

    it('maps a CallFire failure to a 502', async () => {
      http.post.mockRejectedValue(createAxiosError({ message: 'bad csv' }, 500))

      await expect(
        service.createListFromCsv(uploadParams),
      ).rejects.toBeInstanceOf(BadGatewayException)
    })
  })

  describe('getListStatus', () => {
    it('reports ACTIVE as ready (validation finished, safe to dial)', async () => {
      http.get.mockResolvedValue({ id: 987654, status: 'ACTIVE', size: 42 })

      const status = await service.getListStatus('987654')

      const [path] = http.get.mock.calls[0] ?? []
      expect(path).toBe('/contacts/lists/987654')
      expect(status).toEqual({
        listId: '987654',
        status: 'ACTIVE',
        size: 42,
        isReady: true,
        isFailed: false,
      })
    })

    it('reports VALIDATING as neither ready nor failed (still working)', async () => {
      http.get.mockResolvedValue({ id: 1, status: 'VALIDATING' })

      const status = await service.getListStatus('1')

      expect(status.isReady).toBe(false)
      expect(status.isFailed).toBe(false)
    })

    it('reports a terminal failure status as failed', async () => {
      http.get.mockResolvedValue({ id: 1, status: 'IMPORT_FAILED' })

      const status = await service.getListStatus('1')

      expect(status.isReady).toBe(false)
      expect(status.isFailed).toBe(true)
    })

    it('surfaces a malformed list response as a schema error, not a 502', async () => {
      http.get.mockResolvedValue({ name: 'no id here' })

      await expect(service.getListStatus('1')).rejects.not.toBeInstanceOf(
        BadGatewayException,
      )
    })
  })
})
