import type { AxiosInstance } from 'axios'
import type {
  AdminOutreachActionRequest,
  AdminOutreachActionResponse,
  DeliverStripeEventResponse,
  MockAction,
  MockRecordsResponse,
} from '@goodparty_org/contracts'

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
 * Launches ONE robocall by id, bypassing the send sweep's global serial gate.
 * The preview shares the dev DB, so the sweep (one dial at a time account-wide)
 * stalls whenever any dev robocall is mid-dial; this drives only the caller's
 * run so the robocall spec is isolated from that shared queue.
 */
export const launchRobocall = (client: AxiosInstance, outreachId: number) =>
  client.post<void>(
    `/v1/test-fixtures/vendor-mocks/robocall/${outreachId}/launch`,
  )

/**
 * Shifts outreach timing so a sweep processes this specific robocall:
 * - `robocall.send_due_now`     → sets Outreach.date to now - 1 min (staging and send pick it up)
 * - `robocall.dialed_48h_ago`   → backdates dialedAt 49h (completion sweep settles it)
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

/**
 * Fires a Peerly-specific vendor-mock action for a campaign.
 * Thin wrapper over mockAction scoped to the Peerly action space.
 */
export const peerlyAction = (
  client: AxiosInstance,
  campaignId: number,
  action: MockAction['action'],
) => mockAction(client, campaignId, action)

/**
 * Fires a Vercel-specific vendor-mock action for a campaign.
 * Thin wrapper over mockAction scoped to the Vercel action space.
 */
export const vercelAction = (
  client: AxiosInstance,
  campaignId: number,
  action: MockAction['action'],
) => mockAction(client, campaignId, action)

/**
 * Delivers a signed Stripe checkout.session.completed event to the payments
 * handler in-process, using a real test-mode Stripe session.
 */
export const deliverStripeEvent = async (
  client: AxiosInstance,
  sessionId: string,
): Promise<DeliverStripeEventResponse> => {
  const { data } = await client.post<DeliverStripeEventResponse>(
    '/v1/test-fixtures/vendor-mocks/stripe/events',
    { type: 'checkout.session.completed', sessionId },
  )
  return data
}

/**
 * Applies an admin action to an outreach row using a test-user session,
 * bypassing the AdminOrM2MGuard. `cas.approve` books canvassers; `results.upload`
 * ingests a CSV payload.
 */
export const adminAction = async (
  client: AxiosInstance,
  outreachId: number,
  action: AdminOutreachActionRequest['action'],
  payload?: unknown,
): Promise<AdminOutreachActionResponse> => {
  const { data } = await client.post<AdminOutreachActionResponse>(
    `/v1/test-fixtures/vendor-mocks/outreach/${outreachId}/admin-actions`,
    { action, payload },
  )
  return data
}
