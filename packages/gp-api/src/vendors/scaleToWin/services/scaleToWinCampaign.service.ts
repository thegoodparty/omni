import { Injectable } from '@nestjs/common'
import {
  CopyCampaignBodySchema,
  PreviewMessagesBody,
  PreviewMessagesBodySchema,
  PreviewMessagesResponse,
  PreviewMessagesResponseSchema,
  ScaleToWinCampaign,
  ScaleToWinCampaignSchema,
  ScaleToWinJob,
  ScaleToWinJobSchema,
  StartCampaignResponseSchema,
} from '../schemas/scaleToWinCampaign.schema'
import { ScaleToWinHttpService } from './scaleToWinHttp.service'

const CAMPAIGN_ENDPOINT = '/subaccounts/:subaccountId/campaigns/:id'

const campaignPath = (id: string) => `/campaigns/${encodeURIComponent(id)}`

export type CopyCampaignInput = {
  name: string
  script: string
  sendingPhoneNumber: string
  // Custom fields the template's response scripts use. The built-ins
  // first_name and last_name need not be listed.
  contactFields?: string[]
}

@Injectable()
export class ScaleToWinCampaignService {
  constructor(private readonly http: ScaleToWinHttpService) {}

  async copy(
    templateId: string,
    input: CopyCampaignInput,
  ): Promise<ScaleToWinCampaign> {
    const body = CopyCampaignBodySchema.parse({
      name: input.name,
      contactFields: input.contactFields ?? [],
      scriptVariants: [{ script: input.script }],
      sendingPhoneNumber: input.sendingPhoneNumber,
    })
    const endpoint = `${CAMPAIGN_ENDPOINT}/copy`
    return this.http.parse(
      ScaleToWinCampaignSchema,
      await this.http.post(
        this.http.subaccountPath(`${campaignPath(templateId)}/copy`),
        endpoint,
        body,
      ),
      endpoint,
    )
  }

  async get(id: string): Promise<ScaleToWinCampaign> {
    return this.http.parse(
      ScaleToWinCampaignSchema,
      await this.http.get(
        this.http.subaccountPath(campaignPath(id)),
        CAMPAIGN_ENDPOINT,
      ),
      CAMPAIGN_ENDPOINT,
    )
  }

  async previewMessages(
    id: string,
    input: PreviewMessagesBody,
  ): Promise<PreviewMessagesResponse> {
    const endpoint = `${CAMPAIGN_ENDPOINT}/preview-messages`
    return this.http.parse(
      PreviewMessagesResponseSchema,
      await this.http.post(
        this.http.subaccountPath(`${campaignPath(id)}/preview-messages`),
        endpoint,
        PreviewMessagesBodySchema.parse(input),
      ),
      endpoint,
    )
  }

  async start(id: string): Promise<void> {
    const endpoint = `${CAMPAIGN_ENDPOINT}/start`
    this.http.parse(
      StartCampaignResponseSchema,
      await this.http.post(
        this.http.subaccountPath(`${campaignPath(id)}/start`),
        endpoint,
      ),
      endpoint,
    )
  }

  async getStartJob(id: string): Promise<ScaleToWinJob> {
    const endpoint = `${CAMPAIGN_ENDPOINT}/start`
    return this.http.parse(
      ScaleToWinJobSchema,
      await this.http.get(
        this.http.subaccountPath(`${campaignPath(id)}/start`),
        endpoint,
      ),
      endpoint,
    )
  }

  // Sends the campaign to every loaded contact. Scale to Win accepts it only
  // from INITIAL_SEND_READY and returns at once; the send runs in the
  // background.
  async sendFull(id: string): Promise<ScaleToWinCampaign> {
    const endpoint = `${CAMPAIGN_ENDPOINT}/send-full`
    return this.http.parse(
      ScaleToWinCampaignSchema,
      await this.http.post(
        this.http.subaccountPath(`${campaignPath(id)}/send-full`),
        endpoint,
      ),
      endpoint,
    )
  }
}
