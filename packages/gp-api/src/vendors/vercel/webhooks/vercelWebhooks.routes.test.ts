import { createHmac } from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import * as vercelAlertMetrics from './vercelAlert.metrics'
import { VercelWebhooksController } from './vercelWebhooks.controller'

const service = useTestService()

const ROUTE = '/v1/webhooks/vercel'

const sign = (payload: string, secret: string) =>
  createHmac('sha1', secret).update(payload).digest('hex')

// Post the exact bytes that were signed: the controller verifies `rawBody`.
const deliver = (event: unknown, signature?: string) => {
  const payload = JSON.stringify(event)
  return service.client.post(ROUTE, payload, {
    headers: {
      'content-type': 'application/json',
      'x-vercel-signature':
        signature ?? sign(payload, process.env.VERCEL_WEBHOOK_SECRET as string),
    },
  })
}

// The documented example, at the 300% threshold that fired on 2026-11-08.
const budgetReached = {
  id: '2qn7PZrx89yxY34vEZPD3',
  type: 'budget.reached',
  createdAt: 1759449600000,
  payload: {
    user: { id: null },
    team: { id: 'team_jkT8yZ3oE1u6xLo8h6dxfNc3' },
    budgetAmount: 1000,
    currentSpend: 3000,
    teamId: 'team_jkT8yZ3oE1u6xLo8h6dxfNc3',
    thresholdPercent: 300,
  },
}

const alertsTriggered = {
  id: 'evt_alerts_1',
  type: 'alerts.triggered',
  createdAt: 1759449600000,
  payload: {
    teamId: 'team_jkT8yZ3oE1u6xLo8h6dxfNc3',
    projectId: 'prj_123',
    projectSlug: 'gp-marketing',
    startedAt: 1759449600000,
    severity: 'high',
    links: { observability: 'https://vercel.com/goodparty/gp-marketing/o' },
    alerts: [{ title: 'Function invocations spike', metric: 'invocations' }],
  },
}

describe('POST /v1/webhooks/vercel', () => {
  let recordVercelAlert: ReturnType<typeof vi.spyOn>
  let logWarn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    recordVercelAlert = vi.spyOn(vercelAlertMetrics, 'recordVercelAlert')
    logWarn = vi.spyOn(
      service.app.get(VercelWebhooksController)['logger'],
      'warn',
    )
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('accepts a signed budget alert, counts it and logs one line', async () => {
    const result = await deliver(budgetReached)

    expect(result.status).toBe(200)
    expect(recordVercelAlert).toHaveBeenCalledExactlyOnceWith(
      'budget.reached',
      300,
    )
    expect(logWarn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        vercelEvent: 'budget.reached',
        thresholdPercent: 300,
        budgetAmount: 1000,
        currentSpend: 3000,
      }),
      'Vercel alert received',
    )
  })

  it('accepts a signed anomaly alert and logs its project', async () => {
    const result = await deliver(alertsTriggered)

    expect(result.status).toBe(200)
    expect(recordVercelAlert).toHaveBeenCalledExactlyOnceWith(
      'alerts.triggered',
    )
    expect(logWarn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        vercelEvent: 'alerts.triggered',
        vercelProject: 'gp-marketing',
        dashboardUrl: 'https://vercel.com/goodparty/gp-marketing/o',
      }),
      'Vercel alert received',
    )
  })

  it('rejects a body signed with another secret', async () => {
    const result = await deliver(
      budgetReached,
      sign(JSON.stringify(budgetReached), 'not-the-secret'),
    )

    expect(result.status).toBe(401)
    expect(recordVercelAlert).not.toHaveBeenCalled()
    expect(logWarn).not.toHaveBeenCalled()
  })

  it('rejects a delivery with no signature', async () => {
    const result = await service.client.post(
      ROUTE,
      JSON.stringify(budgetReached),
      { headers: { 'content-type': 'application/json' } },
    )

    expect(result.status).toBe(401)
    expect(recordVercelAlert).not.toHaveBeenCalled()
  })

  it('rejects a signed body that fails the schema, and still counts it', async () => {
    const result = await deliver({
      ...budgetReached,
      payload: { teamId: 'team_jkT8yZ3oE1u6xLo8h6dxfNc3' },
    })

    expect(result.status).toBe(400)
    expect(recordVercelAlert).toHaveBeenCalledExactlyOnceWith('unrecognized')
    expect(logWarn).not.toHaveBeenCalled()
  })

  it('rejects a body that is not JSON', async () => {
    const payload = '{"type":'
    const result = await service.client.post(ROUTE, payload, {
      // axios re-encodes a string it cannot parse as JSON, which would send
      // valid JSON and fail the signature instead.
      transformRequest: [(data: string) => data],
      headers: {
        'content-type': 'application/json',
        'x-vercel-signature': sign(
          payload,
          process.env.VERCEL_WEBHOOK_SECRET as string,
        ),
      },
    })

    expect(result.status).toBe(400)
    expect(recordVercelAlert).not.toHaveBeenCalled()
  })

  it('answers 503 when the secret is not configured', async () => {
    const payload = JSON.stringify(budgetReached)
    const signature = sign(payload, process.env.VERCEL_WEBHOOK_SECRET as string)
    vi.stubEnv('VERCEL_WEBHOOK_SECRET', '')

    const result = await deliver(budgetReached, signature)

    expect(result.status).toBe(503)
    expect(recordVercelAlert).not.toHaveBeenCalled()
  })
})
