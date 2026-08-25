import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import {
  CallhubPhonebook,
  CallhubPhonebookSchema,
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
