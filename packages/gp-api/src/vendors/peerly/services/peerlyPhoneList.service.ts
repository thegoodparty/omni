import { BadRequestException, Injectable } from '@nestjs/common'
import { isAxiosError } from 'axios'
import { PeerlyBaseConfig } from '../config/peerlyBaseConfig'
import FormData from 'form-data'
import {
  PhoneListDetailsResponseDto,
  PhoneListStatusResponseDto,
  PhoneListSummary,
  PhoneListSummaryListDto,
  UploadPhoneListResponseDto,
} from '../schemas/peerlyPhoneList.schema'
import {
  P2P_DNC_SCRUBBING,
  P2P_DNC_SUPPRESS_INITIALS,
  P2P_PHONE_LIST_MAP,
} from '../constants/p2pJob.constants'
import { PinoLogger } from 'nestjs-pino'
import { PeerlyErrorHandlingService } from './peerlyErrorHandling.service'
import { PeerlyHttpService } from './peerlyHttp.service'

const P2P_SUPPRESS_CELL_PHONES = '4'
// Peerly's "test list": the same phone list upload with a different
// suppression mode. At most 5 numbers, scoped to one identity, and the
// only place a number can live for Peerly to accept it as a test
// recipient. https://api-docs.peerly.com/reference/send-test-message
export const TEST_SUPPRESS_CELL_PHONES = 6
const MAX_FILE_SIZE = 104857600

interface UploadPhoneListParams {
  listName: string
  csvBuffer: Buffer
  identityId?: string
  fileSize?: number
}

interface UploadTestPhoneListParams {
  listName: string
  phone: string
  identityId: string
}

@Injectable()
export class PeerlyPhoneListService extends PeerlyBaseConfig {
  constructor(
    protected readonly logger: PinoLogger,
    private readonly peerlyHttpService: PeerlyHttpService,
    private readonly peerlyErrorHandling: PeerlyErrorHandlingService,
  ) {
    super(logger)
  }

  async uploadPhoneList(params: UploadPhoneListParams): Promise<string> {
    const { listName, csvBuffer, identityId, fileSize } = params

    const actualFileSize = fileSize || csvBuffer.length
    if (actualFileSize > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File size exceeds maximum allowed size of ${MAX_FILE_SIZE} bytes`,
      )
    }

    const formFields = {
      account: this.accountNumber,
      ...(identityId && { identity_id: identityId }),
      list_name: listName,
      suppress_cell_phones: P2P_SUPPRESS_CELL_PHONES,
      list_map: JSON.stringify(P2P_PHONE_LIST_MAP),
      use_nat_dnc: P2P_DNC_SCRUBBING,
      dnc_suppress_initials: P2P_DNC_SUPPRESS_INITIALS,
    }

    return this.postPhoneList({ formFields, csvBuffer, filename: 'voters.csv' })
  }

  private async postPhoneList({
    formFields,
    csvBuffer,
    filename,
  }: {
    formFields: Record<string, string | number>
    csvBuffer: Buffer
    filename: string
  }): Promise<string> {
    const form = new FormData()
    Object.entries(formFields).forEach(([key, value]) => {
      form.append(key, value)
    })

    form.append('file', csvBuffer, {
      filename,
      contentType: 'text/csv',
    })

    try {
      const response = await this.peerlyHttpService.post('/phonelists', form, {
        headers: form.getHeaders(),
        timeout: this.uploadTimeoutMs,
        maxBodyLength: MAX_FILE_SIZE,
        maxContentLength: MAX_FILE_SIZE,
      })

      const validated = this.peerlyHttpService.validateResponse(
        response.data,
        UploadPhoneListResponseDto,
        'upload',
      )
      return validated.Data.token
    } catch (error) {
      return this.peerlyErrorHandling.handleApiError({
        error,
        logger: this.logger,
      })
    }
  }

  // A one-number test list for the CAS test send: the same upload in
  // Peerly's test mode. The CSV carries the phone alone — a staff handset
  // has no voter record, and inventing an address to fill the voter column
  // map would put made-up data in the vendor. DNC scrubbing matches the
  // P2P upload, so a staff number on the national list still receives its
  // own test.
  async uploadTestPhoneList(
    params: UploadTestPhoneListParams,
  ): Promise<string> {
    const { listName, phone, identityId } = params
    return this.postPhoneList({
      formFields: {
        account: this.accountNumber,
        identity_id: identityId,
        list_name: listName,
        suppress_cell_phones: String(TEST_SUPPRESS_CELL_PHONES),
        list_map: JSON.stringify({ lead_phone: 1 }),
        use_nat_dnc: P2P_DNC_SCRUBBING,
        dnc_suppress_initials: P2P_DNC_SUPPRESS_INITIALS,
      },
      // Header row then the number, the shape the voter upload's column
      // map already assumes.
      csvBuffer: Buffer.from(`lead_phone\n${phone}\n`, 'utf8'),
      filename: 'test-list.csv',
    })
  }

  // Every list in one identity, with the columns that say which are test
  // lists and which are usable. Peerly caps test lists per identity, so a
  // caller has to look before it creates one.
  async listPhoneLists(identityId: string): Promise<PhoneListSummary[]> {
    try {
      const response = await this.peerlyHttpService.get(
        '/phonelists/listByAccount',
        { params: { account: this.accountNumber, identity_id: identityId } },
      )

      return this.peerlyHttpService.validateResponse(
        response.data,
        PhoneListSummaryListDto,
        'list phone lists',
      )
    } catch (error) {
      return this.peerlyErrorHandling.handleApiError({
        error,
        logger: this.logger,
      })
    }
  }

  // Adds one number to a list that already exists, which is how a second
  // reviewer's handset joins a test list without uploading another one.
  // Throws Peerly's own message through — the caller decides whether a
  // rejection (already present, list full) is fatal.
  async addContactToPhoneList(listId: number, phone: string): Promise<void> {
    try {
      await this.peerlyHttpService.post(`/phonelists/${listId}/addcontact`, {
        contact: { contact_phone: phone },
      })
    } catch (error) {
      return this.peerlyErrorHandling.handleApiError({
        error,
        logger: this.logger,
      })
    }
  }

  // Returns null if status is not available yet (e.g. still processing), otherwise returns the status response.
  async checkPhoneListStatus(
    token: string,
  ): Promise<PhoneListStatusResponseDto | null> {
    try {
      const response = await this.peerlyHttpService.get(
        `/phonelists/${token}/checkstatus`,
      )

      return this.peerlyHttpService.validateResponse(
        response.data,
        PhoneListStatusResponseDto,
        'status',
      )
    } catch (error) {
      if (this.isTransientPhoneListError(error)) {
        this.logger.warn(
          { token },
          'Peerly returned a transient error during phone list status check. This is expected during processing and will likely resolve on retry.',
        )
        return null
      }
      return this.peerlyErrorHandling.handleApiError({
        error,
        logger: this.logger,
      })
    }
  }

  private isTransientPhoneListError(error: unknown): boolean {
    if (!isAxiosError(error)) return false
    if (error.response?.status !== 400) return false
    const data: unknown = error.response?.data
    if (!data || typeof data !== 'object') return false
    const message =
      ('error' in data && data.error) ||
      ('message' in data && data.message) ||
      ('Error' in data && data.Error) ||
      ''
    return (
      typeof message === 'string' &&
      message
        .toLowerCase()
        .includes('there may be an error with the phone list for context')
    )
  }

  async getPhoneListDetails(
    listId: number,
  ): Promise<PhoneListDetailsResponseDto> {
    try {
      const response = await this.peerlyHttpService.get(`/phonelists/${listId}`)

      return this.peerlyHttpService.validateResponse(
        response.data,
        PhoneListDetailsResponseDto,
        'details',
      )
    } catch (error) {
      return this.peerlyErrorHandling.handleApiError({
        error,
        logger: this.logger,
      })
    }
  }
}
