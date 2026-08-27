import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import {
  CampaignReportExport,
  CampaignReportExportSchema,
  VoiceBroadcastCampaignSchema,
  VoiceBroadcastCampaignStatus,
  VOICE_BROADCAST_STATUS_LABELS,
  VOICE_BROADCAST_STATUS_UNKNOWN,
} from '../schemas/callhubCampaignReport.schema'
import { CallhubErrorHandlingService } from './callhubErrorHandling.service'
import { CallhubHttpService } from './callhubHttp.service'

const VB_CAMPAIGN_PATH = '/v1/voice_broadcasts'
const EXPORT_DATA_PATH = '/v1/export_data'

// Read-only lifecycle + post-run results for a voice broadcast campaign. Every
// call here is a GET: this reads status and reports, it never creates,
// launches, schedules, or dials.
//
// Both reads parse OUTSIDE the fetch's try/catch, so a schema mismatch surfaces
// as a ZodError (a permanent bug) rather than the transient-looking
// BadGatewayException a status/report poll would otherwise retry on.
@Injectable()
export class CallhubCampaignReportService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly http: CallhubHttpService,
    private readonly errorHandling: CallhubErrorHandlingService,
  ) {
    this.logger.setContext(CallhubCampaignReportService.name)
  }

  // pkStr, never a numeric id — CallHub ids can exceed JS's safe-integer range.
  async getCampaignStatus(
    pkStr: string,
  ): Promise<VoiceBroadcastCampaignStatus> {
    const data = await this.fetchCampaign(pkStr)
    const campaign = VoiceBroadcastCampaignSchema.parse(data)
    return {
      ...campaign,
      statusLabel:
        VOICE_BROADCAST_STATUS_LABELS[campaign.status] ??
        VOICE_BROADCAST_STATUS_UNKNOWN,
    }
  }

  private async fetchCampaign(pkStr: string) {
    try {
      return await this.http.get(`${VB_CAMPAIGN_PATH}/${pkStr}/`)
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallHub campaign status lookup failed',
      })
    }
  }

  // Polls a results export by its job id. CallHub delivers VB call-detail
  // results as an async export (create returns a job id, the poll returns the
  // CSV), so the report is keyed by that job id, not the campaign pk_str.
  async getCampaignReport(exportJobId: string): Promise<CampaignReportExport> {
    const data = await this.fetchReportExport(exportJobId)
    return CampaignReportExportSchema.parse(data)
  }

  private async fetchReportExport(exportJobId: string) {
    try {
      return await this.http.get(`${EXPORT_DATA_PATH}/export_${exportJobId}/`)
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallHub campaign report lookup failed',
      })
    }
  }
}
