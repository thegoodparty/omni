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
import { csvShape } from '@/shared/util/csv.util'
import { sleep } from '@/shared/util/sleep.util'
import { PeerlyErrorHandlingService } from './peerlyErrorHandling.service'
import { PeerlyHttpService } from './peerlyHttp.service'

const P2P_SUPPRESS_CELL_PHONES = '4'
// Peerly's "test list": the same phone list upload with a different
// suppression mode. At most 5 numbers, scoped to one identity, and the
// only place a number can live for Peerly to accept it as a test
// recipient. https://api-docs.peerly.com/reference/send-test-message
export const TEST_SUPPRESS_CELL_PHONES = 6
const MAX_FILE_SIZE = 104857600

// A phone list is minutes of upstream paging and a person waiting on it, so a
// single refused upload must not cost the whole build (INC-108): one candidate
// lost a 3,700-person list to one 400 from Peerly and had to build it again by
// hand. Three attempts over ~0.9s, which is nothing against the 6s the build
// behind it took.
const UPLOAD_MAX_ATTEMPTS = 3
const UPLOAD_RETRY_BASE_DELAY_MS = 300

// Retries are for a refusal that comes back fast, which is what INC-108's did
// (0.7s). They must never push the handler past the point where the person is
// still connected: the build before this upload may already have spent up to
// MAX_INTERACTIVE_RESOLUTION_MS (90s), the gateway hangs up at ~120s, and a
// single upload attempt can itself burn uploadTimeoutMs (60s). Three 60s
// timeouts in a row would be 3 minutes of uploading for a request nobody is
// waiting on, and an upload that then succeeds leaves a list the candidate
// never sees — which is INC-101's harm, not INC-108's. So once the attempts
// have spent this much wall clock, the failure is returned as it stands.
const UPLOAD_RETRY_WINDOW_MS = 15_000

// Peerly's wording when its own file handling failed, returned as a 400 with
// no reference to the file's contents. It is not a statement about the
// candidate's filter or our CSV, so it is worth another attempt — unlike a
// content rejection (banned word, column map), which fails identically every
// time and is surfaced to the candidate as a 400 by the error handler.
const VENDOR_UPLOAD_FAILURE = 'failed to upload the file'

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
    let lastError: unknown
    let attemptsMade = 0
    let outOfTime = false
    const startedAt = Date.now()

    for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt++) {
      attemptsMade = attempt
      try {
        return await this.attemptUpload({ formFields, csvBuffer, filename })
      } catch (error) {
        lastError = error
        if (
          attempt === UPLOAD_MAX_ATTEMPTS ||
          !this.isRetryableUploadFailure(error)
        ) {
          break
        }
        if (Date.now() - startedAt >= UPLOAD_RETRY_WINDOW_MS) {
          outOfTime = true
          break
        }
        this.logger.warn(
          {
            attempt,
            listName: formFields.list_name,
            ...csvShape(csvBuffer),
            peerlyMessage: this.peerlyMessage(error),
            code: isAxiosError(error) ? error.code : undefined,
            status: isAxiosError(error) ? error.response?.status : undefined,
          },
          'Peerly refused a phone list upload for reasons of its own; retrying the upload',
        )
        await sleep(UPLOAD_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
      }
    }

    // The file is other people's names and numbers and cannot be logged, but
    // without its shape a refusal like INC-108's is undiagnosable after the
    // fact: all we kept was Peerly's one-line message.
    this.logger.error(
      {
        attempts: attemptsMade,
        elapsedMs: Date.now() - startedAt,
        listName: formFields.list_name,
        ...csvShape(csvBuffer),
      },
      this.finalFailureMessage({ attemptsMade, outOfTime }),
    )

    return this.peerlyErrorHandling.handleApiError({
      error: lastError,
      logger: this.logger,
    })
  }

  private finalFailureMessage({
    attemptsMade,
    outOfTime,
  }: {
    attemptsMade: number
    outOfTime: boolean
  }): string {
    if (outOfTime) {
      return 'Peerly refused this phone list upload and there was no time left to try again'
    }
    return attemptsMade === UPLOAD_MAX_ATTEMPTS
      ? 'Peerly refused this phone list upload on every attempt'
      : 'Peerly rejected this phone list upload in a way not worth retrying'
  }

  // The multipart body is built here, inside the attempt, because a form-data
  // body is consumed as it is sent: a retry has to build its own or it posts
  // an empty file. For the same reason the HTTP client's own retry is off for
  // this call — it would re-send the spent body.
  private async attemptUpload({
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

    const response = await this.peerlyHttpService.post(
      '/phonelists',
      form,
      {
        headers: form.getHeaders(),
        timeout: this.uploadTimeoutMs,
        maxBodyLength: MAX_FILE_SIZE,
        maxContentLength: MAX_FILE_SIZE,
      },
      { retryTransportErrors: false },
    )

    const validated = this.peerlyHttpService.validateResponse(
      response.data,
      UploadPhoneListResponseDto,
      'upload',
    )
    return validated.Data.token
  }

  // Worth a second attempt with a freshly built body: anything that never
  // reached Peerly (aborted or reset connection), anything Peerly answered
  // from its own machinery (429, 5xx), and the one 400 that names its file
  // handling rather than our file. Everything else — a content rejection, a
  // bad column map, an unparseable response — fails the same way every time.
  private isRetryableUploadFailure(error: unknown): boolean {
    if (!isAxiosError(error)) return false
    const status = error.response?.status
    if (!error.response) return error.code !== 'ERR_CANCELED'
    if (status === 429 || (status ?? 0) >= 500) return true
    return (
      status === 400 &&
      (this.peerlyMessage(error) ?? '')
        .toLowerCase()
        .includes(VENDOR_UPLOAD_FAILURE)
    )
  }

  private peerlyMessage(error: unknown): string | undefined {
    if (!isAxiosError(error)) return undefined
    const data: unknown = error.response?.data
    if (!data || typeof data !== 'object') return undefined
    const message =
      ('error' in data && data.error) ||
      ('message' in data && data.message) ||
      ('Error' in data && data.Error) ||
      ''
    return typeof message === 'string' ? message : undefined
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
    return (this.peerlyMessage(error) ?? '')
      .toLowerCase()
      .includes('there may be an error with the phone list for context')
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
