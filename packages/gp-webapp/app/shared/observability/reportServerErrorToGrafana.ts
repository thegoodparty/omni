import type { Instrumentation } from 'next'
import { isProductRoute } from 'app/shared/utils/isProductRoute'
import { deploymentEnvironment } from './deploymentEnvironment'

// The same Grafana Cloud OTLP gateway gp-api exports to (src/otel.ts). A log
// line written here lands in Loki as
// {service_name="gp-webapp-server", deployment_environment_name="<env>"},
// beside gp-api's own. Not `gp-webapp`: that is the browser app's name in
// Frontend Observability, whose streams share the label.
const OTLP_LOGS_URL =
  'https://otlp-gateway-prod-us-east-3.grafana.net/otlp/v1/logs'

const OTLP_SEVERITY_ERROR = 17

const attribute = (key: string, value: string | undefined) =>
  value === undefined ? [] : [{ key, value: { stringValue: value } }]

// One OTLP log line per server-side request error: render, route handler,
// server action or middleware. A direct POST rather than an OpenTelemetry SDK
// because this is the only thing gp-webapp's server exports, and an error is
// rare enough that batching would buy nothing.
//
// A no-op until GRAFANA_OTLP_AUTHORIZATION is set, so local runs and any
// environment without the token report nothing and fail nothing.
export const reportServerErrorToGrafana: Instrumentation.onRequestError =
  async (error, request, context) => {
    const authorization = process.env.GRAFANA_OTLP_AUTHORIZATION
    if (!authorization) return

    const path = request.path.split('?')[0]
    if (!isProductRoute(path)) return

    const reportable = error instanceof Error ? error : new Error(String(error))
    const digest =
      typeof error === 'object' && error !== null && 'digest' in error
        ? String(error.digest)
        : undefined

    const body = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              ...attribute('service.name', 'gp-webapp-server'),
              ...attribute(
                'deployment.environment.name',
                deploymentEnvironment(),
              ),
              ...attribute(
                'service.version',
                process.env.NEXT_PUBLIC_GIT_SHA || undefined,
              ),
            ],
          },
          scopeLogs: [
            {
              scope: { name: 'gp-webapp/onRequestError' },
              logRecords: [
                {
                  timeUnixNano: `${Date.now()}000000`,
                  severityNumber: OTLP_SEVERITY_ERROR,
                  severityText: 'ERROR',
                  body: {
                    stringValue: `${request.method} ${path} failed: ${reportable.message}`,
                  },
                  attributes: [
                    ...attribute('exception.type', reportable.name),
                    ...attribute('exception.message', reportable.message),
                    ...attribute('exception.stacktrace', reportable.stack),
                    ...attribute('error.digest', digest),
                    ...attribute('http.request.method', request.method),
                    ...attribute('url.path', path),
                    ...attribute('next.route_path', context.routePath),
                    ...attribute('next.route_type', context.routeType),
                    ...attribute('next.router_kind', context.routerKind),
                  ],
                },
              ],
            },
          ],
        },
      ],
    }

    try {
      await fetch(OTLP_LOGS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      })
    } catch {
      // Telemetry must never turn one failed request into two.
    }
  }
