/**
 * Which contact point a provisioned alert would actually be delivered to.
 *
 * WHY THIS EXISTS. Every alert in this repo is provisioned from code, and none
 * of the routing was. The notification policy tree lived only in Grafana Cloud,
 * hand-edited, and it contained this route:
 *
 *     alert_slug =~ ".*warning.*"   ->   receiver "dev-warnings"
 *
 * `dev-warnings` is a Slack channel created on 2026-03-19 with the description
 * "For grafana alerts that are being tested". Nothing was ever posted to it.
 * Two of the seventeen alert slugs match that pattern —
 * `win-peerly-warnings` and `win-outreach-paid-not-scheduled-warning` — so both
 * fired in production and notified nobody. Six firings in the seven days to
 * 2026-09-17, and by the channel's age plausibly since March.
 *
 * It produced no error anywhere. Grafana was not failing to deliver; it was
 * delivering exactly where it had been told. `alert-notification-delivery-
 * failing` measures send failures, so it could not have caught this either, and
 * a route that matches nothing dangerous today starts matching the moment
 * somebody names an alert with the word "warning" in it.
 *
 * So the tree is snapshotted in `alert-routing.policy.json` next to this file,
 * which makes routing reviewable in a diff, and these functions answer the
 * question the snapshot exists for: given the tree, where does each alert go.
 */

/**
 * A matcher as Grafana's provisioning API returns it: `[label, op, value]`.
 *
 * Typed as a plain array rather than a fixed-length tuple because that is what
 * the API actually sends and what a JSON import of the snapshot infers. A tuple
 * would only be honest if something validated the length, and `matches` below
 * has to tolerate a malformed one anyway.
 */
export type ObjectMatcher = readonly string[]

export interface PolicyRoute {
  receiver?: string
  object_matchers?: readonly ObjectMatcher[]
  routes?: readonly PolicyRoute[]
  /** When true, matching this route does not stop evaluation of its siblings. */
  continue?: boolean
}

export interface PolicyTree extends PolicyRoute {
  receiver: string
}

/**
 * An anchored matcher regex, or null if Grafana is holding a pattern that
 * JavaScript cannot compile.
 *
 * NEVER THROWS, and that is the whole point. The tree is hand-edited in Grafana
 * Cloud, so `=~ "["` is a realistic thing to find in it, and `new RegExp` on it
 * raises a `SyntaxError`. This module is called from a Pulumi deploy, outside
 * the try/catch that guards the fetch, so a throw here would abort the deploy —
 * the opposite of what the caller promises, which is to warn and never fail.
 *
 * A pattern that cannot be compiled is reported as not matching, the same
 * contract `matches` applies to an operator it does not model: an
 * uninterpretable matcher must not be able to manufacture a route.
 */
const anchored = (value: string) => {
  try {
    return new RegExp(`^(?:${value})$`)
  } catch {
    return null
  }
}

/**
 * Whether one matcher holds for a set of labels.
 *
 * A MISSING LABEL IS AN EMPTY STRING, which is Alertmanager's rule and not an
 * arbitrary choice: it is what makes `environment != prod` match an alert that
 * carries no `environment` label at all. Treating absence as "no match" instead
 * would silently route unlabelled alerts to the default receiver, which is the
 * opposite of what the live tree's only remaining route intends.
 */
const matches = (matcher: ObjectMatcher, labels: Record<string, string>) => {
  if (matcher.length !== 3) return false

  const [label, op, value] = matcher
  const actual = labels[label] ?? ''

  switch (op) {
    case '=':
      return actual === value
    case '!=':
      return actual !== value
    case '=~': {
      const pattern = anchored(value)
      return pattern !== null && pattern.test(actual)
    }
    case '!~': {
      const pattern = anchored(value)
      return pattern !== null && !pattern.test(actual)
    }
    default:
      // An operator we do not model. Reported as not matching, because the
      // caller treats "routes to the default" as the safe expectation and an
      // unknown operator should not be able to manufacture a false pass.
      return false
  }
}

/**
 * The receiver an alert with these labels lands on.
 *
 * FIRST MATCH WINS and the search is depth-first, which is Alertmanager's
 * semantics: a child route that matches replaces its parent's receiver, and the
 * first matching sibling ends the search unless it sets `continue`. Getting
 * this wrong in either direction would make the guard lie — too eager and it
 * reports misrouting that does not happen, too lax and it misses the case it
 * was written for.
 *
 * A MATCHING `continue` ROUTE IS STILL A DELIVERY, which is the subtle half.
 * Alertmanager's `Route.Match` appends the matched child and only falls back to
 * the node itself when nothing below it matched at all, so a `continue` child
 * with no matching sibling after it delivers to its own receiver, not to its
 * parent's. Falling back to the parent there would report a route as harmless
 * precisely when it is the only thing handling the alert.
 *
 * Simplification worth naming: Alertmanager delivers to *every* route a
 * `continue` chain matches, so its answer is a set. This returns the last one,
 * which is enough for the tree this guards (no `continue` routes at all today)
 * but would under-report a fan-out to several receivers. The snapshot test is
 * what would notice such a route being added.
 */
export const receiverFor = (
  tree: PolicyTree,
  labels: Record<string, string>,
): string => {
  const walk = (route: PolicyRoute, inherited: string): string => {
    const receiver = route.receiver || inherited
    let continued: string | undefined

    for (const child of route.routes ?? []) {
      const applies = (child.object_matchers ?? []).every((matcher) =>
        matches(matcher, labels),
      )
      if (!applies) continue

      const resolved = walk(child, receiver)
      if (!child.continue) return resolved
      continued = resolved
    }

    return continued ?? receiver
  }

  return walk(tree, tree.receiver)
}

/**
 * The receiver a production alert is supposed to reach.
 *
 * ONE COPY, exported, because the deploy-time check in `grafana.ts` and the
 * test suite both need it and two arrays kept in step by a comment is the
 * failure this whole file exists to prevent: add a receiver to the test's copy
 * only and the suite goes green while the deploy applies different membership,
 * or add it to the deploy's copy only and a real misrouting stops failing PRs.
 *
 * Two names, not one: where prod alerts go today, and where they go once the
 * alert filter is routed. Naming them is the point — adding a destination is a
 * reviewed change, rather than something that happens because a slug matched a
 * pattern nobody remembers writing.
 */
export const EXPECTED_PROD_RECEIVERS = [
  'dev-alerts',
  'gpbot-alert-filter',
] as const

export interface Misrouting {
  slug: string
  receiver: string
}

/**
 * Every alert that would be delivered somewhere other than an expected receiver.
 *
 * Takes slugs rather than whole alerts so it can be used against both the
 * hand-written global list and the generated per-controller rules without
 * either of them having to agree on a shape.
 */
export const misroutedAlerts = ({
  tree,
  slugs,
  environment,
  expected,
}: {
  tree: PolicyTree
  slugs: readonly string[]
  environment: string
  expected: readonly string[]
}): Misrouting[] =>
  slugs
    .map((slug) => ({
      slug,
      receiver: receiverFor(tree, { alert_slug: slug, environment }),
    }))
    .filter(({ receiver }) => !expected.includes(receiver))
