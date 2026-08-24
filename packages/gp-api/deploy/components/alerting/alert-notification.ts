import { Alert, SlackGroup } from './alerts.types'

const SLACK_GROUP_IDS: Record<SlackGroup, string> = {
  'serve-bugs': 'S0AD54G9D3K',
  'win-bugs': 'S0AE3NTCXM3',
}

const tag = (environment: string) => `[${environment.toUpperCase()}]`

/**
 * Every environment provisions the same rules from the same definitions, and
 * a notification carries neither the rule's `environment` label nor its
 * folder. Without a tag the dev and prod pages for a route are identical down
 * to the group mention, and whoever is holding the pager cannot tell
 * production from dev without opening Grafana. That cost is not hypothetical:
 * it is what happened on the 2026-08-20 door-knocking page.
 *
 * Both fields carry the tag because the two are read at different moments —
 * `summary` titles the notification and is what someone scanning Slack sees,
 * `description` is the body they read once they open it. No custom notifier
 * template is provisioned here, so which of the two a given contact point
 * surfaces is Grafana's default to decide, and neither should be the one that
 * leaves the environment out.
 *
 * Tagging here rather than in each `message` covers the global alerts and the
 * generated controller alerts alike, and leaves an alert author nothing to
 * remember.
 */
export const buildAlertSummary = (alert: Alert, environment: string): string =>
  `${tag(environment)} ${alert.name}`

export const buildAlertDescription = (
  alert: Alert,
  environment: string,
): string => {
  const message = alert.message.replace(/\$ENV/g, environment)
  const mention = alert.notify
    ? `<!subteam^${SLACK_GROUP_IDS[alert.notify]}>`
    : ''

  return [`${tag(environment)} ${message}`, mention]
    .filter(Boolean)
    .join('\n\n')
}
