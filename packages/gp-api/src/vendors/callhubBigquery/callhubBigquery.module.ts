import { Module } from '@nestjs/common'
import { BigqueryErrorHandlingService } from './services/bigqueryErrorHandling.service'
import { CallhubBigqueryClientService } from './services/callhubBigqueryClient.service'
import { CallhubBigqueryResultsService } from './services/callhubBigqueryResults.service'

// Read-only BigQuery foundation for pulling CallHub voice-broadcast results
// from CallHub's BigQuery export ourselves. Standalone on purpose: NOT imported
// by OutreachModule or any billing/completion path yet, and its config is
// asserted at use, so it ships inert until we confirm access + schema. Wiring
// it into the send/settle flow is a later, separate change.
@Module({
  providers: [
    BigqueryErrorHandlingService,
    CallhubBigqueryClientService,
    CallhubBigqueryResultsService,
  ],
  exports: [CallhubBigqueryClientService, CallhubBigqueryResultsService],
})
export class CallhubBigqueryModule {}
