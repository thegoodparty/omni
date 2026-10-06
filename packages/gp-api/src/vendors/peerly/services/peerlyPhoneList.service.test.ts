import { BadGatewayException, BadRequestException } from '@nestjs/common'
import {
  AxiosError,
  AxiosHeaders,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios'
import FormData from 'form-data'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { PeerlyPhoneListService } from './peerlyPhoneList.service'
import { PeerlyErrorHandlingService } from './peerlyErrorHandling.service'
import { PeerlyHttpService } from './peerlyHttp.service'
import { PinoLogger } from 'nestjs-pino'

function createAxiosError(
  responseData: Record<string, unknown> | undefined,
  status = 400,
): AxiosError {
  const config: AxiosRequestConfig = {
    url: '/test-endpoint',
    method: 'GET',
    headers: new AxiosHeaders(),
  }
  const response: AxiosResponse = {
    data: responseData,
    status,
    statusText: 'Bad Request',
    headers: {},
    config: config as AxiosResponse['config'],
  }
  return new AxiosError(
    'Request failed',
    'ERR_BAD_REQUEST',
    config as AxiosError['config'],
    {},
    response,
  )
}

function createTransportError(code = 'ECONNABORTED'): AxiosError {
  const config: AxiosRequestConfig = {
    url: '/phonelists',
    method: 'POST',
    headers: new AxiosHeaders(),
  }
  return new AxiosError(
    'timeout of 60000ms exceeded',
    code,
    config as AxiosError['config'],
  )
}

describe('PeerlyPhoneListService', () => {
  let service: PeerlyPhoneListService
  let mockLogger: PinoLogger
  let mockHttpService: {
    get: ReturnType<typeof vi.fn>
    post: ReturnType<typeof vi.fn>
    validateResponse: ReturnType<typeof vi.fn>
  }
  let mockErrorHandling: {
    handleApiError: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mockLogger = createMockLogger()
    mockHttpService = {
      get: vi.fn(),
      post: vi.fn(),
      validateResponse: vi.fn(),
    }
    mockErrorHandling = {
      handleApiError: vi.fn(),
    }
    service = new PeerlyPhoneListService(
      mockLogger,
      mockHttpService as unknown as PeerlyHttpService,
      mockErrorHandling as unknown as PeerlyErrorHandlingService,
    )
  })

  describe('checkPhoneListStatus', () => {
    it('returns validated response on success', async () => {
      const mockResponse = { data: { list_state: 'ACTIVE', list_id: 123 } }
      const validated = { Data: { list_state: 'ACTIVE', list_id: 123 } }
      mockHttpService.get.mockResolvedValue(mockResponse)
      mockHttpService.validateResponse.mockReturnValue(validated)

      const result = await service.checkPhoneListStatus('test-token')

      expect(result).toBe(validated)
      expect(mockHttpService.get).toHaveBeenCalledWith(
        '/phonelists/test-token/checkstatus',
      )
    })

    it('returns null for transient Peerly 400 error', async () => {
      const error = createAxiosError(
        {
          error: 'There may be an error with the phone list for context',
        },
        400,
      )
      mockHttpService.get.mockRejectedValue(error)

      const result = await service.checkPhoneListStatus('test-token')

      expect(result).toBeNull()
      expect(mockLogger.warn).toHaveBeenCalled()
      expect(mockErrorHandling.handleApiError).not.toHaveBeenCalled()
    })

    it('delegates non-transient errors to handleApiError', async () => {
      const error = createAxiosError({ error: 'Some other error' }, 500)
      mockHttpService.get.mockRejectedValue(error)
      mockErrorHandling.handleApiError.mockRejectedValue(
        new BadGatewayException('Peerly API error: Some other error'),
      )

      await expect(service.checkPhoneListStatus('test-token')).rejects.toThrow(
        BadGatewayException,
      )
      expect(mockErrorHandling.handleApiError).toHaveBeenCalledWith({
        error,
        logger: mockLogger,
      })
    })

    it('delegates non-axios errors to handleApiError', async () => {
      const error = new Error('Network failure')
      mockHttpService.get.mockRejectedValue(error)
      mockErrorHandling.handleApiError.mockRejectedValue(
        new BadGatewayException('Peerly API ERROR'),
      )

      await expect(service.checkPhoneListStatus('test-token')).rejects.toThrow(
        BadGatewayException,
      )
      expect(mockErrorHandling.handleApiError).toHaveBeenCalled()
    })

    it('does not treat 400 without transient message as transient', async () => {
      const error = createAxiosError({ error: 'Invalid token format' }, 400)
      mockHttpService.get.mockRejectedValue(error)
      mockErrorHandling.handleApiError.mockRejectedValue(
        new BadGatewayException('Peerly API error: Invalid token format'),
      )

      await expect(service.checkPhoneListStatus('test-token')).rejects.toThrow(
        BadGatewayException,
      )
      expect(mockErrorHandling.handleApiError).toHaveBeenCalled()
    })
  })
  // INC-108: one candidate's 3,700-person list was thrown away because Peerly
  // answered a single upload with 400 "Failed to upload the file". The build
  // behind an upload costs seconds of upstream paging with a person waiting on
  // it, so a refusal that says nothing about the file gets another attempt.
  describe('uploadPhoneList', () => {
    const csvBuffer = Buffer.from(
      'lead_first_name,lead_last_name,lead_phone,lead_state,lead_city,lead_zip\n' +
        'Ada,Lovelace,5551230000,CA,Oakland,94601\n',
      'utf8',
    )
    const uploadParams = {
      listName: 'My Voters',
      csvBuffer,
      identityId: 'identity-1',
    }
    const vendorRefusal = () =>
      createAxiosError({ Error: 'Failed to upload the file' }, 400)

    it('retries a vendor-side upload failure, with the whole file on every attempt', async () => {
      mockHttpService.post
        .mockRejectedValueOnce(vendorRefusal())
        .mockResolvedValueOnce({ data: {} })
      mockHttpService.validateResponse.mockReturnValue({
        Data: { token: 'upload-token' },
      })

      const token = await service.uploadPhoneList(uploadParams)

      expect(token).toBe('upload-token')
      expect(mockHttpService.post).toHaveBeenCalledTimes(2)
      expect(mockErrorHandling.handleApiError).not.toHaveBeenCalled()
      // A form-data body is consumed as it is sent, so each attempt has to
      // build its own: the point of the retry is that the second POST still
      // carries the file, not an empty one.
      for (const call of mockHttpService.post.mock.calls) {
        const [path, form, , options] = call as [
          string,
          FormData,
          unknown,
          unknown,
        ]
        expect(path).toBe('/phonelists')
        const body = form.getBuffer().toString()
        expect(body).toContain('5551230000')
        expect(body).toContain('name="list_name"\r\n\r\nMy Voters')
        // The HTTP client's own retry would re-send the spent body.
        expect(options).toEqual({ retryTransportErrors: false })
      }
    })

    it('retries an upload that never reached Peerly', async () => {
      mockHttpService.post
        .mockRejectedValueOnce(createTransportError())
        .mockResolvedValueOnce({ data: {} })
      mockHttpService.validateResponse.mockReturnValue({
        Data: { token: 'upload-token' },
      })

      await expect(service.uploadPhoneList(uploadParams)).resolves.toBe(
        'upload-token',
      )
      expect(mockHttpService.post).toHaveBeenCalledTimes(2)
    })

    it('gives up after three attempts, logging the shape of the file it could not upload', async () => {
      const error = vendorRefusal()
      mockHttpService.post.mockRejectedValue(error)
      mockErrorHandling.handleApiError.mockRejectedValue(
        new BadGatewayException('Peerly API error: Failed to upload the file'),
      )

      await expect(service.uploadPhoneList(uploadParams)).rejects.toThrow(
        BadGatewayException,
      )
      expect(mockHttpService.post).toHaveBeenCalledTimes(3)
      expect(mockErrorHandling.handleApiError).toHaveBeenCalledWith({
        error,
        logger: mockLogger,
      })
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 3,
          listName: 'My Voters',
          bytes: csvBuffer.length,
          rows: 1,
          controlCharRows: 0,
        }),
        expect.stringContaining('every attempt'),
      )
    })

    it('does not retry a rejection that names what is wrong with the request', async () => {
      const error = createAxiosError({ error: 'Invalid list_map' }, 400)
      mockHttpService.post.mockRejectedValue(error)
      mockErrorHandling.handleApiError.mockRejectedValue(
        new BadGatewayException('Peerly API error: Invalid list_map'),
      )

      await expect(service.uploadPhoneList(uploadParams)).rejects.toThrow(
        BadGatewayException,
      )
      expect(mockHttpService.post).toHaveBeenCalledTimes(1)
      // The count on the failure line is what was actually attempted, so an
      // on-call reader is not sent looking for retries that never ran.
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ attempts: 1 }),
        expect.stringContaining('not worth retrying'),
      )
    })

    it('refuses a file over the vendor size limit without calling Peerly', async () => {
      await expect(
        service.uploadPhoneList({ ...uploadParams, fileSize: 104857601 }),
      ).rejects.toThrow(BadRequestException)
      expect(mockHttpService.post).not.toHaveBeenCalled()
    })
  })

  describe('uploadTestPhoneList', () => {
    // Peerly only texts a number that sits on a TEST list, and test mode is
    // the one upload field that makes a list one. A list uploaded in P2P
    // mode by mistake is accepted here and refused at send time.
    it('uploads the number in test mode, in the campaign identity', async () => {
      mockHttpService.post.mockResolvedValue({ data: {} })
      mockHttpService.validateResponse.mockReturnValue({
        Data: { token: 'upload-token' },
      })

      const token = await service.uploadTestPhoneList({
        listName: 'GoodParty test list identity-1',
        phone: '5551234567',
        identityId: 'identity-1',
      })

      expect(token).toBe('upload-token')
      const [path, form] = mockHttpService.post.mock.calls[0] as [
        string,
        FormData,
      ]
      expect(path).toBe('/phonelists')
      const body = form.getBuffer().toString()
      expect(body).toContain('name="suppress_cell_phones"\r\n\r\n6')
      expect(body).toContain('name="identity_id"\r\n\r\nidentity-1')
      expect(body).toContain('5551234567')
    })
  })
})
