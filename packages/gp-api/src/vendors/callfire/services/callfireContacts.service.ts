import { Injectable } from '@nestjs/common'
import FormData from 'form-data'
import { PinoLogger } from 'nestjs-pino'
import {
  CALLFIRE_CONTACT_LIST_STATUS,
  CALLFIRE_CONTACT_LIST_TERMINAL_FAILURES,
  ContactList,
  ContactListSchema,
  ResourceIdSchema,
} from '../schemas/callfireContacts.schema'
import { CallfireErrorHandlingService } from './callfireErrorHandling.service'
import { CallfireHttpService } from './callfireHttp.service'

const LISTS_PATH = '/contacts/lists'
const UPLOAD_PATH = '/contacts/lists/upload'
// A robocall recipient CSV is small (phone numbers, light attributes); this
// ceiling only guards against an absurd upload.
const MAX_FILE_SIZE = 25 * 1024 * 1024

interface CreateListFromCsvParams {
  name: string
  file: Buffer
  fileName: string
  mimeType: string
  // When true, CallFire treats unmapped CSV columns as custom contact fields
  // instead of dropping them. Off by default — a robocall only needs the phone
  // column.
  useCustomFields?: boolean
}

// The terminal state of a list's async validation, distilled for a poller.
export interface ContactListStatus {
  listId: string
  status: string | null
  size: number | null
  // The list has been validated and is safe to dial.
  isReady: boolean
  // Validation reached a terminal FAILED state — a poller stops and fails the
  // run rather than waiting forever.
  isFailed: boolean
}

// Creates and reads CallFire contact lists — the audience a voice broadcast
// dials. A list is created by uploading a CSV (multipart), which returns a list
// id immediately while CallFire validates the rows in the BACKGROUND. Because
// validation is async, a later slice gates the dial on getListStatus reaching
// ACTIVE (or on the ContactList `validationFinished` / `validationFailed`
// webhook), never on the upload call returning.
@Injectable()
export class CallfireContactsService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly http: CallfireHttpService,
    private readonly errorHandling: CallfireErrorHandlingService,
  ) {
    this.logger.setContext(CallfireContactsService.name)
  }

  async createListFromCsv(
    params: CreateListFromCsvParams,
  ): Promise<{ listId: string }> {
    if (params.file.length > MAX_FILE_SIZE) {
      throw new Error('Contact CSV is too large to upload')
    }

    const form = new FormData()
    form.append('name', params.name)
    form.append('file', params.file, {
      filename: params.fileName,
      contentType: params.mimeType,
      knownLength: params.file.length,
    })
    // CallFire reads the multipart field as a string; send the literal so a
    // false value is not silently coerced to truthy.
    if (params.useCustomFields !== undefined) {
      form.append('useCustomFields', String(params.useCustomFields))
    }

    try {
      const data = await this.http.post(UPLOAD_PATH, form, {
        headers: form.getHeaders(),
        maxBodyLength: MAX_FILE_SIZE,
        maxContentLength: MAX_FILE_SIZE,
      })
      // Read the numeric id off the wire and hand it back as a string handle —
      // the id is never used for arithmetic (string-id convention).
      const { id } = ResourceIdSchema.parse(data)
      return { listId: String(id) }
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallFire contact list upload failed',
      })
    }
  }

  async getList(listId: string): Promise<ContactList> {
    // Parse OUTSIDE the fetch try/catch so a response-shape mismatch surfaces
    // as a ZodError (permanent), not the retryable BadGatewayException a poll
    // would treat as a transient vendor blip.
    const data = await this.fetchList(listId)
    return ContactListSchema.parse(data)
  }

  // The distilled validation state a poll gates on. CallFire validates an
  // uploaded list asynchronously; the list is dial-safe only once its status
  // reads ACTIVE, and a poll gives up on a terminal FAILED status.
  async getListStatus(listId: string): Promise<ContactListStatus> {
    const list = await this.getList(listId)
    const status = list.status ?? null
    return {
      listId: String(list.id),
      status,
      size: list.size ?? null,
      isReady: status === CALLFIRE_CONTACT_LIST_STATUS.ACTIVE,
      isFailed:
        status !== null &&
        CALLFIRE_CONTACT_LIST_TERMINAL_FAILURES.includes(status),
    }
  }

  private async fetchList(listId: string) {
    try {
      return await this.http.get(`${LISTS_PATH}/${listId}`)
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallFire contact list lookup failed',
      })
    }
  }
}
