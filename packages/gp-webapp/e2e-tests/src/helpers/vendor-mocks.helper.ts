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

/**
 * Triggers a named robocall background job (staging/send/completion/capture)
 * via the session-auth test-user route.  Global — the job sweeps all eligible
 * rows, not only the caller's.
 */
export const runJob = (client: AxiosInstance, name: string) =>
  client.post<void>(`/v1/test-fixtures/vendor-mocks/jobs/${name}/run`)

/**
 * Shifts outreach timing so a sweep processes this specific robocall:
 * - `robocall.send_due_now`     → moves scheduledAt to now (send sweep picks it up)
 * - `robocall.dialed_48h_ago`   → moves the dialed timestamp back 48h (completion sweep picks it up)
 * - `sms.start_date_today`      → moves an SMS send's start date to today
 */
export const timeTravel = (
  client: AxiosInstance,
  outreachId: number,
  action:
    | 'robocall.send_due_now'
    | 'robocall.dialed_48h_ago'
    | 'sms.start_date_today',
) =>
  client.post<void>('/v1/test-fixtures/vendor-mocks/time-travel', {
    outreachId,
    action,
  })

/**
 * Fires a CallHub-specific vendor-mock action for a campaign.
 * Thin wrapper over mockAction scoped to the CallHub action space.
 */
export const callhubAction = (
  client: AxiosInstance,
  campaignId: number,
  action: MockAction['action'],
) => mockAction(client, campaignId, action)
