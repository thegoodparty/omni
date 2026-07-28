import type {
  ComplianceStateOutput,
  ListCampaignsPagination,
  PaginatedList,
  ReadCampaignOutput,
  SetDistrictOutput,
  UpdateCampaignM2MInput,
} from '@goodparty_org/contracts'
import type {
  CampaignWithLiveContext,
  CampaignWithPositionName,
} from '../types/campaign'
import type { UpdateDistrictInput } from '../types/district'
import { BaseResource } from './BaseResource'

export class CampaignsResource extends BaseResource {
  protected readonly resourceBasePath = '/campaigns'

  get = (id: number): Promise<CampaignWithLiveContext> =>
    this.getRequest<CampaignWithLiveContext>(`${this.resourceBasePath}/${id}`)

  list = (
    options?: ListCampaignsPagination,
  ): Promise<PaginatedList<CampaignWithPositionName>> =>
    this.getRequest<PaginatedList<CampaignWithPositionName>>(
      `${this.resourceBasePath}/list`,
      options,
    )

  update = (
    id: number,
    input: UpdateCampaignM2MInput,
  ): Promise<ReadCampaignOutput> =>
    this.putRequest<ReadCampaignOutput>(`${this.resourceBasePath}/${id}`, input)

  updateDistrict = (
    id: number,
    input: UpdateDistrictInput,
  ): Promise<SetDistrictOutput> =>
    this.putRequest<SetDistrictOutput>(
      `${this.resourceBasePath}/${id}/district`,
      input,
    )

  getComplianceState = (campaignId: number): Promise<ComplianceStateOutput> =>
    this.getRequest<ComplianceStateOutput>(
      `${this.resourceBasePath}/tcr-compliance/admin/${campaignId}` +
        '/compliance-state',
    )

  resendCvPin = (campaignId: number): Promise<void> =>
    this.postRequest<void>(
      `${this.resourceBasePath}/tcr-compliance/admin/${campaignId}` +
        '/resend-cv-pin',
      {},
    )

  grantInternalTestingApproval = (campaignId: number): Promise<void> =>
    this.postRequest<void>(
      `${this.resourceBasePath}/tcr-compliance/admin/${campaignId}` +
        '/internal-testing-approval',
      {},
    )

  revokeInternalTestingApproval = (campaignId: number): Promise<void> =>
    this.deleteRequest<void>(
      `${this.resourceBasePath}/tcr-compliance/admin/${campaignId}` +
        '/internal-testing-approval',
    )
}
