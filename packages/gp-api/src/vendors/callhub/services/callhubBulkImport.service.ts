import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import {
  BulkImportResponse,
  BulkImportResponseSchema,
} from '../schemas/callhubBulkImport.schema'
import { CallhubErrorHandlingService } from './callhubErrorHandling.service'
import { CallhubHttpService } from './callhubHttp.service'

const BULK_CREATE_PATH = '/v1/contacts/bulk_create/'

interface BulkImportParams {
  // The phonebook's pk_str (string), never the numeric id — CallHub ids exceed
  // JS's safe-integer range.
  phonebookPkStr: string
  // A hosted CSV URL (our presigned S3 GET works here, unlike media upload).
  csvUrl: string
  // field_id -> column_index; see CALLHUB_CONTACT_FIELD.
  mapping: Record<string, number>
  countryIso: string
}

// Loads an audience into a phonebook from a hosted CSV. Rate-limited to 1/min
// and asynchronous with no job id, so callers serialize these and poll the
// phonebook count to know when the load finished.
@Injectable()
export class CallhubBulkImportService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly http: CallhubHttpService,
    private readonly errorHandling: CallhubErrorHandlingService,
  ) {
    this.logger.setContext(CallhubBulkImportService.name)
  }

  async importContacts(params: BulkImportParams): Promise<BulkImportResponse> {
    try {
      const data = await this.http.post(BULK_CREATE_PATH, {
        phonebook_id: params.phonebookPkStr,
        csv_url: params.csvUrl,
        mapping: params.mapping,
        country_choice: 'custom',
        country_iso: params.countryIso,
      })
      return BulkImportResponseSchema.parse(data)
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallHub bulk contact import failed',
      })
    }
  }
}
