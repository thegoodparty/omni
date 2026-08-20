import { Alert, SlackGroup } from './alerts.types'

const SLACK_GROUP_IDS: Record<SlackGroup, string> = {
  'serve-bugs': 'S0AD54G9D3K',
  'win-bugs': 'S0AE3NTCXM3',
}

/**
 * The Slack body for one alert, in one environment.
 *
 * Every environment provisions the same rules from the same definitions, and
 * a notification carries neither the rule's `environment` label nor its
 * folder — so without the prefix below the dev and prod pages for a route are
 * byte-identical, group mention included, and whoever is holding the pager
 * cannot tell production from dev without opening Grafana first. That cost is
 * not hypothetical: it is what happened on the 2026-08-20 door-knocking page.
 *
 * Prefixing here rather than in each `message` covers the global alerts and
 * the generated controller alerts alike, and leaves an alert author nothing
 * to remember.
 */
export const buildAlertDescription = (
  alert: Alert,
  environment: string,
): string => {
  const message = alert.message.replace(/\$ENV/g, environment)
  const mention = alert.notify
    ? `<!subteam^${SLACK_GROUP_IDS[alert.notify]}>`
    : ''

  return [`[${environment.toUpperCase()}] ${message}`, mention]
    .filter(Boolean)
    .join('\n\n')
}
