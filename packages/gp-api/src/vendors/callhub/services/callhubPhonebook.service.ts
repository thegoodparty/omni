import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import {
  CallhubPhonebook,
  CallhubPhonebookSchema,
  PhonebookNumbersCountSchema,
  PhonebookPageSchema,
} from '../schemas/callhubPhonebook.schema'
import { CallhubErrorHandlingService } from './callhubErrorHandling.service'
import { CallhubHttpService } from './callhubHttp.service'

const PHONEBOOKS_PATH = '/v1/phonebooks/'
const PAGE_SIZE = 1000

interface CreatePhonebookParams {
  name: string
  description?: string
}

// A phonebook is the audience container a voice broadcast dials. One is created
// per send, then filled via bulk import (see CallhubBulkImportService).
@Injectable()
export class CallhubPhonebookService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly http: CallhubHttpService,
    private readonly errorHandling: CallhubErrorHandlingService,
  ) {
    this.logger.setContext(CallhubPhonebookService.name)
  }

  async createPhonebook(
    params: CreatePhonebookParams,
  ): Promise<CallhubPhonebook> {
    try {
      const data = await this.http.post(PHONEBOOKS_PATH, {
        name: params.name,
        description: params.description,
      })
      return CallhubPhonebookSchema.parse(data)
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallHub phonebook creation failed',
      })
    }
  }

  // The phonebook's loaded calling-number count. Its hyperlinked `count`
  // field resolves to a `.../numbers_count` sub-resource (a URL, not an
  // integer), whose path is deterministic off the pk_str. A bulk import is
  // asynchronous with no job id, so callers poll this to know when the load
  // finished.
  async getContactCount(phonebookPkStr: string): Promise<number> {
    try {
      const data = await this.http.get(
        `${PHONEBOOKS_PATH}${phonebookPkStr}/numbers_count`,
      )
      return PhonebookNumbersCountSchema.parse(data).phonenumber_count
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallHub phonebook contact-count lookup failed',
      })
    }
  }

  async listPhonebooks(): Promise<CallhubPhonebook[]> {
    try {
      const data = await this.http.get(PHONEBOOKS_PATH, {
        params: { page_size: PAGE_SIZE },
      })
      return PhonebookPageSchema.parse(data).results
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallHub phonebook lookup failed',
      })
    }
  }
}
