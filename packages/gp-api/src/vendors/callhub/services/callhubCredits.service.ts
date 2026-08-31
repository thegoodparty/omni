import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import {
  CALLHUB_CAMPAIGN_TYPE_VOICE,
  VoiceCreditsUsage,
  VoiceCreditsUsageSchema,
} from '../schemas/callhubCredits.schema'
import { CallhubErrorHandlingService } from './callhubErrorHandling.service'
import { CallhubHttpService } from './callhubHttp.service'

// Trailing slash matters for the same DRF reason as the campaign paths.
const CREDITS_USAGE_PATH = '/v2/credits_usage/'

// Read-only credits/usage reporting for a voice broadcast. The one call here is
// a POST only because CallHub models the usage read that way — it creates
// nothing and dials nothing; it reports the completed run's billable figures.
// The response is parsed OUTSIDE the fetch try/catch, so a schema mismatch
// surfaces as a ZodError (a permanent bug) rather than the transient-looking
// BadGatewayException a usage poll would otherwise retry on.
@Injectable()
export class CallhubCreditsService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly http: CallhubHttpService,
    private readonly errorHandling: CallhubErrorHandlingService,
  ) {
    this.logger.setContext(CallhubCreditsService.name)
  }

  // pkStr, never a numeric id — CallHub ids can exceed JS's safe-integer range.
  async getVoiceCampaignUsage(pkStr: string): Promise<VoiceCreditsUsage> {
    const data = await this.fetchUsage(pkStr)
    return VoiceCreditsUsageSchema.parse(data)
  }

  private async fetchUsage(pkStr: string) {
    try {
      return await this.http.post(CREDITS_USAGE_PATH, {
        campaign_type: CALLHUB_CAMPAIGN_TYPE_VOICE,
        campaign_id: pkStr,
      })
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallHub voice credits usage lookup failed',
      })
    }
  }
}
