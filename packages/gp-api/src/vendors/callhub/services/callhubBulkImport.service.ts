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

// CallHub wants `mapping` as a JSON *string* whose values are the column
// indices as strings (e.g. `{"0":"0"}` — calling-number field ← column 0);
// an object body 400s "Invalid Json [mapping]" and integer values are
// ignored, 400ing "No column is set as Phone Number". Verified live.
const encodeMapping = (mapping: Record<string, number>): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(mapping).map(([field, column]) => [field, String(column)]),
    ),
  )

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
        mapping: encodeMapping(params.mapping),
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
