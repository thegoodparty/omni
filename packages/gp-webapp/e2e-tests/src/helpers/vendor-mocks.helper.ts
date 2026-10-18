import type { AxiosInstance } from 'axios'
import type { MockAction, MockRecordsResponse } from '@goodparty_org/contracts'

/**
 * Triggers a vendor-mock action for a campaign (e.g. arm the Geoapify
 * route-failure flag before pressing "Build route").
 */
export const mockAction = (
  client: AxiosInstance,
  campaignId: number,
  action: MockAction['action'],
  params?: Record<string, unknown>,
) =>
  client.post<void>('/v1/test-fixtures/vendor-mocks/actions', {
    campaignId,
    action,
    params,
  })

/**
 * Returns all VendorMockRecord rows for a campaign.  The response schema is
 * MockRecordsResponse from @goodparty_org/contracts.
 */
export const mockRecords = async (
  client: AxiosInstance,
  campaignId: number,
): Promise<MockRecordsResponse> => {
  const { data } = await client.get<MockRecordsResponse>(
    '/v1/test-fixtures/vendor-mocks/records',
    { params: { campaignId } },
  )
  return data
}
