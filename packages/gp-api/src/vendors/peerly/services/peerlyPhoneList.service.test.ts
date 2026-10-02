import { BadGatewayException } from '@nestjs/common'
import {
  AxiosError,
  AxiosHeaders,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios'
import FormData from 'form-data'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { PhoneListSummaryListDto } from '../schemas/peerlyPhoneList.schema'
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

  // The two calls that find an identity's existing test list and put
  // another reviewer's handset on it. Neither has ever run against the
  // real vendor, so what they send is pinned here against Peerly's
  // documented shape: the account and identity on the lookup, the
  // contact-wrapped phone on the add.
  describe('listPhoneLists', () => {
    it("asks for one identity's lists and returns them validated", async () => {
      const lists = [
        { list_id: 169614, list_state: 'ACTIVE', suppress_cell_phones: 6 },
      ]
      mockHttpService.get.mockResolvedValue({ data: lists })
      mockHttpService.validateResponse.mockReturnValue(lists)

      const result = await service.listPhoneLists('identity-1')

      expect(result).toBe(lists)
      expect(mockHttpService.get).toHaveBeenCalledWith(
        '/phonelists/listByAccount',
        {
          params: {
            account: service.accountNumber,
            identity_id: 'identity-1',
          },
        },
      )
      expect(mockHttpService.validateResponse).toHaveBeenCalledWith(
        lists,
        PhoneListSummaryListDto,
        'list phone lists',
      )
    })

    // listByAccount answers with a bare array and many more columns than
    // we read. Parsing the documented shape here is the only check that
    // the schema matches the vendor, since every other test mocks it.
    it('parses the vendor shape it is validated against', () => {
      const parsed = PhoneListSummaryListDto.schema.parse([
        {
          list_id: 169614,
          list_name: 'GoodParty test list identity-1',
          list_state: 'ACTIVE',
          suppress_cell_phones: '6',
          leads_loaded: 1,
          upload_by: 'api',
        },
      ])

      expect(parsed).toEqual([
        {
          list_id: 169614,
          list_name: 'GoodParty test list identity-1',
          list_state: 'ACTIVE',
          suppress_cell_phones: 6,
        },
      ])
    })

    it('delegates a vendor failure to handleApiError', async () => {
      const error = createAxiosError({ error: 'Unknown identity' }, 400)
      mockHttpService.get.mockRejectedValue(error)
      mockErrorHandling.handleApiError.mockRejectedValue(
        new BadGatewayException('Peerly API error: Unknown identity'),
      )

      await expect(service.listPhoneLists('identity-1')).rejects.toThrow(
        BadGatewayException,
      )
      expect(mockErrorHandling.handleApiError).toHaveBeenCalledWith({
        error,
        logger: mockLogger,
      })
    })
  })

  describe('addContactToPhoneList', () => {
    it('posts the number to that list, wrapped as a contact', async () => {
      mockHttpService.post.mockResolvedValue({ data: {} })

      await service.addContactToPhoneList(169614, '5551234567')

      expect(mockHttpService.post).toHaveBeenCalledWith(
        '/phonelists/169614/addcontact',
        { contact: { contact_phone: '5551234567' } },
      )
    })

    // The caller decides what a rejection means — a number already on the
    // list is not fatal — so the error has to reach it rather than being
    // swallowed here.
    it('delegates a vendor rejection to handleApiError', async () => {
      const error = createAxiosError({ error: 'Contact already exists' }, 400)
      mockHttpService.post.mockRejectedValue(error)
      mockErrorHandling.handleApiError.mockRejectedValue(
        new BadGatewayException('Peerly API error: Contact already exists'),
      )

      await expect(
        service.addContactToPhoneList(169614, '5551234567'),
      ).rejects.toThrow(BadGatewayException)
      expect(mockErrorHandling.handleApiError).toHaveBeenCalledWith({
        error,
        logger: mockLogger,
      })
    })
  })
})
