import type { AxiosInstance } from 'axios'
import type {
  AdminOutreachActionRequest,
  AdminOutreachActionResponse,
  DeliverStripeEventResponse,
  EmailAudienceFixtureRequest,
  EmailAudienceFixtureResponse,
  MockAction,
  MockRecordsResponse,
  TestFixtureStateResponse,
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
 * Serve counterpart of mockRecords: Serve has no campaign, so the Geoapify
 * mock stamps the org slug on its records and they are read back by that slug.
 */
export const mockRecordsForOrganization = async (
  client: AxiosInstance,
  organizationSlug: string,
): Promise<MockRecordsResponse> => {
  const { data } = await client.get<MockRecordsResponse>(
    '/v1/test-fixtures/vendor-mocks/records',
    { params: { organizationSlug } },
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
 * - `robocall.send_due_now`     → sets Outreach.date to now - 1 min (staging and send pick it up)
 * - `robocall.dialed_48h_ago`   → backdates dialedAt 49h (completion sweep settles it)
 * - `sms.start_date_today`      → moves an SMS send's start date to today (completion reads in_progress)
 * - `sms.start_date_passed`     → moves it to yesterday (completion reads completed)
 * - `email.send_due_now`        → sets an email send's date to now - 1 min (the due sweep starts it)
 * - `email.sent_6m_ago`         → backdates its sent emails 6 min (the settle sweep can finish it)
 */
export const timeTravel = (
  client: AxiosInstance,
  outreachId: number,
  action:
    | 'robocall.send_due_now'
    | 'robocall.dialed_48h_ago'
    | 'sms.start_date_today'
    | 'sms.start_date_passed'
    | 'email.send_due_now'
    | 'email.sent_6m_ago',
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
  params?: Record<string, unknown>,
) => mockAction(client, campaignId, action, params)

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
 * Applies an admin action to an outreach row the caller owns using their own
 * session, bypassing the AdminOrM2MGuard. `cas.approve` books canvassers; `results.upload`
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

/**
 * Stamps cvValidationOverriddenAt on the caller's own TcrCompliance record, the
 * fixture stand-in for staff's override of the CV pre-submission gate (which
 * fetches the filing URL live and asks an LLM). Mock mode only; 404 elsewhere.
 */
export const overrideCvValidation = (client: AxiosInstance) =>
  client.post<void>('/v1/test-fixtures/vendor-mocks/cv-validation/override')

/**
 * Runs the caller's real 10DLC registration server-side against the vendor
 * mocks, leaving a Pro candidate at `tcr_approved` with a Peerly identity that
 * passes the P2P send gate. Mock mode only; 400 when the deploy is in live mode.
 */
export const applyProWin10DlcMock = async (
  client: AxiosInstance,
  userId: number,
): Promise<TestFixtureStateResponse> => {
  const { data } = await client.post<TestFixtureStateResponse>(
    `/v1/test-fixtures/users/${userId}/states/pro-win-10dlc-mock`,
  )
  return data
}

/**
 * Stands in for the people DB's email audience of a test campaign, since a
 * preview's database never feeds the imported-contact overlay. gp-api takes
 * SES mailbox simulator addresses only.
 */
export const seedEmailAudience = async (
  client: AxiosInstance,
  body: EmailAudienceFixtureRequest,
): Promise<EmailAudienceFixtureResponse> => {
  const { data } = await client.post<EmailAudienceFixtureResponse>(
    '/v1/test-fixtures/vendor-mocks/people-db/email-audience',
    body,
  )
  return data
}
