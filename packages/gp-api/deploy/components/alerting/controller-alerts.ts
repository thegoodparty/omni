import { ControllerName, ROUTE_MAP } from '../../../src/generated/route-types'
import { Alert, SlackGroup } from './alerts.types'
import { ALERT_OWNERSHIP, SERVER_ERRORS_ONLY } from '../alerts'

const EXCLUDED_STATUS_CODES = [401, 403, 404, 409, 498]
const anyErrorFilter = [
  'response_statusCode >= 400',
  ...EXCLUDED_STATUS_CODES.map((code) => `response_statusCode != ${code}`),
].join(' and ')
const serverErrorFilter = 'response_statusCode >= 500'

export const controllerAlerts = (controller: ControllerName): Alert[] => {
  const slackGroupName = Object.entries(ALERT_OWNERSHIP).find(
    ([_, controllers]) => controllers.includes(controller),
  )?.[0]
  const serverErrorsOnly = SERVER_ERRORS_ONLY.includes(controller)
  const statusCodeFilter = serverErrorsOnly ? serverErrorFilter : anyErrorFilter
  const routes = ROUTE_MAP[controller]

  return routes.map((route) => {
    const routeBase = `{service_name="gp-api", deployment_environment_name="$ENV"} |= "Request completed" | json | request_endpoint = "${route.endpoint}"`
    const slug = route.endpoint.replace(/[/:]/g, '-').replace(' ', '-')

    return {
      slug: `${slug}-error-count`,
      name: `[${controller}] ${route.endpoint} - Errors detected`,
      type: 'log' as const,
      expr: `sum(count_over_time(${routeBase} | ${statusCodeFilter} [1h]))`,
      threshold: 0,
      for: '1m',
      message: [
        serverErrorsOnly
          ? `\`${route.endpoint}\` returned server errors in the last hour (status ≥ 500). 4xx responses are deliberately excluded on this controller — see SERVER_ERRORS_ONLY in alerts.ts.`
          : `\`${route.endpoint}\` returned unexpected error responses in the last hour (status ≥ 400, excluding 401/403/404/409/498).`,
        'Click *View in Grafana* to find the failing requests, then examine their logs and stack traces to understand why errors are occurring and ship fixes.',
      ].join('\n\n'),
      // slackGroupName comes from Object.entries find — disabled flag guards undefined case
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      notify: slackGroupName as SlackGroup,
      disabled: !slackGroupName,
    } satisfies Alert
  })
}
