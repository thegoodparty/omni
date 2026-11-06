import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reportServerErrorToGrafana } from './reportServerErrorToGrafana'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const CONTEXT = {
  routerKind: 'App Router',
  routePath: '/dashboard/priorities',
  routeType: 'render',
  revalidateReason: undefined,
} as const

const report = (path = '/dashboard/priorities', error: unknown = new Error()) =>
  reportServerErrorToGrafana(
    error,
    { path, method: 'GET', headers: {} },
    CONTEXT,
  )

type OtlpAttribute = { key: string; value: { stringValue: string } }

const sentLog = () => {
  const init = fetchMock.mock.calls[0]?.[1] as {
    headers: Record<string, string>
    body: string
  }
  const resourceLog = JSON.parse(init.body).resourceLogs[0]
  const record = resourceLog.scopeLogs[0].logRecords[0]
  const asMap = (attributes: OtlpAttribute[]) =>
    Object.fromEntries(attributes.map((a) => [a.key, a.value.stringValue]))
  return {
    headers: init.headers,
    resource: asMap(resourceLog.resource.attributes),
    attributes: asMap(record.attributes),
    body: record.body.stringValue as string,
  }
}

describe('reportServerErrorToGrafana', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('GRAFANA_OTLP_AUTHORIZATION', 'Basic dGVzdDp0ZXN0')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_TARGET_ENV', 'production')
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('writes one log line under gp-webapp-server and its environment', async () => {
    await report('/dashboard/priorities', new Error('Connection closed'))

    expect(sentLog().resource['service.name']).toBe('gp-webapp-server')
    expect(sentLog().resource['deployment.environment.name']).toBe('prod')
    expect(sentLog().body).toBe(
      'GET /dashboard/priorities failed: Connection closed',
    )
  })

  it('carries the exception and the route it failed on', async () => {
    const error = Object.assign(new TypeError('boom'), { digest: '12345' })

    await report('/dashboard/priorities?tab=1', error)

    expect(sentLog().attributes).toMatchObject({
      'exception.type': 'TypeError',
      'exception.message': 'boom',
      'error.digest': '12345',
      'url.path': '/dashboard/priorities',
      'next.route_path': '/dashboard/priorities',
      'next.route_type': 'render',
    })
  })

  it('authenticates with the configured header value', async () => {
    await report()

    expect(sentLog().headers.authorization).toBe('Basic dGVzdDp0ZXN0')
  })

  it('reports nothing for a route outside the product', async () => {
    await report('/about')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports nothing until the token is configured', async () => {
    vi.stubEnv('GRAFANA_OTLP_AUTHORIZATION', '')

    await report()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('swallows a failed export rather than failing the request twice', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    await expect(report()).resolves.toBeUndefined()
  })
})
