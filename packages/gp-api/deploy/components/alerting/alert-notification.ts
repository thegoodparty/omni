import { Alert, KnownCause, SlackGroup } from './alerts.types'

/**
 * The annotation key the alert filter reads its registry from.
 *
 * Grafana hands a rule's annotations to a webhook contact point verbatim, so
 * putting the registry here means the filter always reads the causes that were
 * provisioned alongside the rule that fired. The alternative — the filter
 * keeping its own copy — goes stale the first time someone retunes a query
 * without thinking about a repo they do not work in, and goes stale silently,
 * which for a thing that decides what humans are not shown is the worst
 * failure mode available.
 */
export const KNOWN_CAUSES_ANNOTATION = 'known_causes'

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
  [tag(environment), alert.name, alert.summaryDetail].filter(Boolean).join(' ')

/**
 * The line that tells a reader the numbers above them measured nothing.
 *
 * WHY IT IS ON EVERY NOTIFICATION. `grafana.ts` provisions every rule with
 * `execErrState: 'Alerting'`, so a rule that cannot evaluate fires — which is
 * deliberate and stays, because a rule that goes quiet when its datasource is
 * unreachable reports "all clear" precisely when it has stopped looking. The
 * cost is that the page it sends is written from the rule's own `message`, and
 * that message describes the fault the rule looks for rather than the fact that
 * it failed to look. The two are indistinguishable in Slack apart from a state
 * reason of `Error` and values of `-1`, and nothing told anyone that.
 *
 * On 2026-09-28 Grafana Cloud's internal datasource-query service degraded for
 * 84 minutes and 190 of our 216 rules fired at once, each naming its own
 * subject. The prod memory page read "System memory utilization has exceeded
 * 90% for 5 minutes… If the service is at risk of OOM, consider restarting it"
 * while memory sat at 17%. That guidance, followed, restarts healthy
 * production — so the absence of this line is not merely noise, it points the
 * responder at a destructive action.
 *
 * Here rather than in each `message` for the same reason the environment tag is
 * here: it covers the hand-written global alerts and the generated controller
 * alerts alike, and leaves an alert author nothing to remember.
 *
 * Standing rather than conditional, because for most rules there is nothing
 * honest to condition on. Annotation templating sees `$labels` and `$values`
 * and never `grafana_state_reason`, which Grafana attaches after evaluation.
 * The route alerts are the exception and already use it: `whenRouteIsNamed` in
 * `route-alerts.ts` tests `$labels.request_endpoint`, which is absent exactly
 * when the rule failed to run, so those pages drop their route prose entirely.
 * A rule that raises a single unlabelled series — every global alert, including
 * the memory, health-probe and person-id pages of 2026-09-28 — has no such
 * label to test, and this is what those get. One line on a page that does not
 * need it is the cheaper half of that trade.
 */
export const EVALUATION_ERROR_NOTE =
  'If this page carries a state reason of `Error` and values of `-1`, the rule could not evaluate and nothing above was measured — every rule in the estate fires together when the query path breaks. Read *Alert rule evaluations are failing* first, and treat this page as unverified rather than acting on it.'

export const buildAlertDescription = (
  alert: Alert,
  environment: string,
): string => {
  const message = alert.message.replace(/\$ENV/g, environment)
  // `notify` takes one group or several. Normalising here rather than at each
  // author site keeps the single-group spelling, which most alerts use, from
  // having to become a one-element list.
  const groups = alert.notify
    ? [alert.notify].flat()
    : ([] as readonly SlackGroup[])

  const mention = groups
    .map((group) => `<!subteam^${SLACK_GROUP_IDS[group]}>`)
    .join(' ')

  return [`${tag(environment)} ${message}`, EVALUATION_ERROR_NOTE, mention]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Serialise an alert's known causes for the {@link KNOWN_CAUSES_ANNOTATION}.
 *
 * Returns nothing when the alert has none, so rules without a registry carry
 * no annotation at all rather than an empty one. That is not tidiness: the
 * filter treats a missing annotation as "nothing is known here, notify", and
 * an empty array would have to mean the same thing, so having one spelling
 * instead of two removes a way for the two sides to disagree.
 *
 * `$ENV` is substituted here exactly as it is in `expr` and `message`, because
 * evidence queries are written against the same placeholder and the filter
 * runs them as given. Doing it at provision time rather than in the filter is
 * what makes a dev rule's evidence read dev logs without the filter having to
 * work out which environment notified it.
 *
 * The output is compact JSON. Annotations ride along on every notification for
 * the rule, so this is a per-firing payload cost, not a one-off.
 */
export const buildKnownCausesAnnotation = (
  alert: Alert,
  environment: string,
): string | undefined => {
  if (!alert.knownCauses?.length) return undefined

  const resolved: KnownCause[] = alert.knownCauses.map((cause) => ({
    ...cause,
    ...(cause.evidence
      ? { evidence: cause.evidence.replace(/\$ENV/g, environment) }
      : {}),
  }))

  return JSON.stringify(resolved)
}
