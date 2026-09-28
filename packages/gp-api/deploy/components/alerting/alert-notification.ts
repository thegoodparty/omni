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
 * The one thing every `message` in this repo silently assumes and none of them
 * can promise: that the rule's condition was actually met.
 *
 * `grafana.ts` provisions every rule `execErrState: 'Alerting'`, a deliberate
 * departure from Grafana's default of `Error`. Under that setting a query that
 * FAILS does not raise a self-describing `DatasourceError` — it transitions the
 * rule's own instance to Alerting, so the notification renders the rule's own
 * `message`. The result is a page asserting a specific customer-facing outage
 * on the strength of a query that never returned a number.
 *
 * That is not hypothetical and not rare. On 2026-09-25 the
 * `public-campaigns-lookup-error-ratio` rule paged with "More than 10% of the
 * campaign lookups ... returned a server error" while the route served 34x200
 * and 746x404 and zero 5xx: the ratio's numerator was empty, so a value above
 * the threshold was arithmetically impossible. The rule was holding
 * `rpc error: code = Unimplemented desc = unknown service logproto.Querier`
 * from Grafana Cloud's Loki query path, with an `activeAt` of 09-23T12:42:40Z
 * — two days before the page.
 *
 * The scale is estate-wide rather than per-rule. 57 rules carried an `Error`
 * annotation, clustered by `activeAt` on four dates (47 of them within
 * 09-23T12, matching a measured spike in
 * `grafanacloud_grafana_instance_alerting_rule_evaluation_failures_total:rate5m`
 * in the `grafanacloud-usage` datasource). So a single query-path failure
 * fires dozens of rules at once, each in the words of whatever it happens to
 * watch, which is how one infrastructure event becomes an estate's worth of
 * unrelated-looking outages.
 *
 * The reason is not lost — Grafana attaches it as an `Error` annotation — but
 * contact points render `summary` and `description`, so the reader never sees
 * it. Hence this line: the cheapest honest thing a notification can do is admit
 * which of the two things it cannot distinguish, and name the annotation that
 * settles it.
 *
 * Appended to every provisioned alert rather than written into each `message`,
 * for the same reason the environment tag is: it is true of every rule here,
 * the generated controller ones included, and an author cannot be expected to
 * remember a caveat about the provisioning layer.
 *
 * WHY NOT JUST SET `execErrState: 'Error'`. Because as a one-line change it
 * would trade a false page for silence. A `DatasourceError` instance is
 * independent of the rule's own: per Grafana's docs it carries
 * `alertname=DatasourceError`, `datasource_uid` and `rulename`, and existing
 * notification policies "may not apply" to it. Our tree's only route is
 * `environment != prod -> nowhere`, and Alertmanager reads a missing label as
 * the empty string, so a `DatasourceError` that does not inherit
 * `environment=prod` matches that route and is delivered nowhere at all. The
 * tree is hand-edited in Grafana Cloud rather than provisioned from here
 * (`checkAlertRouting` only warns), so that half cannot ship in this repo
 * alone. See docs/observability.md § When a rule fires because it could not run.
 */
const EVALUATION_CAVEAT =
  'If this fired, either the condition was met or the rule could not be ' +
  'evaluated — every rule here is provisioned `execErrState: Alerting`, so a ' +
  'failed or timed-out query fires it with this same text and no number behind ' +
  'it. Before acting on the wording above, confirm the rule returned a value: ' +
  'check the `Error` annotation on the alert instance in Grafana, which is set ' +
  'only in the second case and names the datasource that failed. A batch of ' +
  'unrelated alerts firing together is that case, not a coincidence.'

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

  // Caveat before the mention, so the group being paged stays the last thing in
  // the body rather than being buried under boilerplate.
  return [`${tag(environment)} ${message}`, EVALUATION_CAVEAT, mention]
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
