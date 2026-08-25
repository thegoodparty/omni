import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { CallhubBulkImportService } from './services/callhubBulkImport.service'
import { CallhubDncService } from './services/callhubDnc.service'
import { CallhubErrorHandlingService } from './services/callhubErrorHandling.service'
import { CallhubHttpService } from './services/callhubHttp.service'
import { CallhubMediaService } from './services/callhubMedia.service'
import { CallhubNumbersService } from './services/callhubNumbers.service'
import { CallhubPhonebookService } from './services/callhubPhonebook.service'

// Vendor wrapper for CallHub (robocall / voice broadcast): the HTTP/auth
// foundation plus the API surface a send needs — caller-ID number rental,
// media upload, phonebook, and bulk contact import. Campaign create/lifecycle
// and results export land in a follow-up once their live response shapes are
// confirmed against a billable account. Consumed by the compliance/send slices.
@Module({
  imports: [HttpModule],
  providers: [
    CallhubErrorHandlingService,
    CallhubHttpService,
    CallhubNumbersService,
    CallhubMediaService,
    CallhubPhonebookService,
    CallhubBulkImportService,
    CallhubDncService,
  ],
  exports: [
    CallhubNumbersService,
    CallhubMediaService,
    CallhubPhonebookService,
    CallhubBulkImportService,
    CallhubDncService,
  ],
})
export class CallhubModule {}
